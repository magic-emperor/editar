import type { EditWorkerReq, EditWorkerRes } from './editEngine.worker'
import type { PageModel, CommitResult, EditLine } from './types'

let worker: Worker | null = null
const pending = new Map<string, { resolve: (val: any) => void; reject: (err: Error) => void }>()
let msgSeq = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./editEngine.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<EditWorkerRes>) => {
      const msg = e.data
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) {
        p.resolve(msg)
      } else {
        p.reject(new Error(msg.error))
      }
    }
    worker.onerror = (e) => {
      const err = new Error(e.message || 'Edit engine worker crashed')
      for (const p of pending.values()) p.reject(err)
      pending.clear()
      worker = null
    }
  }
  return worker
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

function send<T extends EditWorkerRes>(
  req: DistributiveOmit<EditWorkerReq, 'id'>,
  transfer: Transferable[] = []
): Promise<T> {
  const id = String(++msgSeq)
  const w = getWorker()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as any, reject })
    const full = { ...req, id } as EditWorkerReq
    transfer.length ? w.postMessage(full, transfer) : w.postMessage(full)
  })
}

// Singleton promise — prevents two EditLayers (from a 2-page PDF) from both
// sending 'init' to the worker, which would cause the second one to close the
// doc the first one just loaded (cleanupDoc race).
let _sessionInitPromise: Promise<void> | null = null

export async function initEditSession(bytes: Uint8Array): Promise<void> {
  if (!_sessionInitPromise) {
    _sessionInitPromise = send<{ type: 'init'; id: string; ok: true }>({ type: 'init', bytes }).then(() => {})
  }
  return _sessionInitPromise
}

export async function getPageModel(pageIndex: number): Promise<PageModel> {
  const res = await send<{ type: 'getPageModel'; id: string; ok: true; model: PageModel }>({
    type: 'getPageModel',
    pageIndex,
  })
  return res.model
}

export async function hitTest(pageIndex: number, x: number, y: number): Promise<EditLine | null> {
  const res = await send<{ type: 'hitTest'; id: string; ok: true; line: EditLine | null }>({
    type: 'hitTest',
    pageIndex,
    x,
    y,
  })
  return res.line
}

export async function commitRunEdit(
  pageIndex: number,
  objIndex: number,
  newText: string
): Promise<{ model: PageModel }> {
  const res = await send<{ type: 'commitRun'; id: string; ok: true; model: PageModel }>({
    type: 'commitRun',
    pageIndex,
    objIndex,
    newText,
  })
  return { model: res.model }
}

export async function commitRunV2Edit(
  pageIndex: number,
  objIndex: number,
  newText: string,
  style?: { size?: number; color?: [number, number, number]; family?: string; bold?: boolean; italic?: boolean },
  newPos?: { x: number; y: number },
  initialPos?: { x: number; y: number }
): Promise<{ model: PageModel }> {
  const res = await send<{ type: 'commitRunV2'; id: string; ok: true; model: PageModel }>({
    type: 'commitRunV2',
    pageIndex,
    objIndex,
    newText,
    style,
    newPos,
    initialPos,
  })
  return { model: res.model }
}

export async function commitLineEdit(
  pageIndex: number,
  lineId: string,
  newText: string
): Promise<{ result: CommitResult; model: PageModel }> {
  const res = await send<{
    type: 'commitLine'
    id: string
    ok: true
    result: CommitResult
    model: PageModel
  }>({
    type: 'commitLine',
    pageIndex,
    lineId,
    newText,
  })
  return { result: res.result, model: res.model }
}

export async function redactArea(
  pageIndex: number,
  rect: { left: number; top: number; right: number; bottom: number }
): Promise<{ success: boolean; model: PageModel }> {
  const res = await send<{
    type: 'redact'
    id: string
    ok: true
    success: boolean
    model: PageModel
  }>({
    type: 'redact',
    pageIndex,
    rect,
  })
  return { success: res.success, model: res.model }
}

export async function renderEnginePage(
  pageIndex: number,
  scale: number,
  hideLineId?: string
): Promise<ImageBitmap> {
  const res = await send<{ type: 'renderPage'; id: string; ok: true; bitmap: ImageBitmap }>({
    type: 'renderPage',
    pageIndex,
    scale,
    hideLineId,
  })
  return res.bitmap
}

export async function engineUndo(): Promise<void> {
  await send<{ type: 'undo'; id: string; ok: true }>({ type: 'undo' })
}

export async function engineRedo(): Promise<void> {
  await send<{ type: 'redo'; id: string; ok: true }>({ type: 'redo' })
}

export async function saveEngineDoc(): Promise<Uint8Array> {
  const res = await send<{ type: 'save'; id: string; ok: true; bytes: Uint8Array }>({ type: 'save' })
  return res.bytes
}

export async function closeEditSession(): Promise<void> {
  await send<{ type: 'close'; id: string; ok: true }>({ type: 'close' })
  // Reset singleton so next edit session (new PDF or re-open) re-inits cleanly
  _sessionInitPromise = null
}
