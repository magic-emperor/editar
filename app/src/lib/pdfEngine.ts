import type { PageSize, WorkerReq, WorkerRes } from './pdfEngine.worker'
import type { PdfOpRequest } from './pdfOps'

// ─── Types ────────────────────────────────────────────────────────────────────

export type { PageSize }

export interface RenderHandle {
  promise: Promise<ImageBitmap>
  cancel:  () => void
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

type Pending = { resolve: (v: WorkerRes) => void; reject: (e: Error) => void }

let worker:  Worker | null = null
const pending = new Map<string, Pending>()
let   msgSeq  = 0

function makeWorker(): Worker {
  const w = new Worker(new URL('./pdfEngine.worker.ts', import.meta.url), { type: 'module' })

  w.onmessage = (e: MessageEvent<WorkerRes>) => {
    const msg = e.data
    const p   = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) {
      p.resolve(msg)
    } else {
      p.reject(new Error(msg.error))
    }
  }

  // Worker crash: reject all in-flight requests, clear the dead worker so the
  // next call spawns a fresh one ("This PDF appears to be damaged" in the UI).
  w.onerror = (e) => {
    const err = new Error(e.message ?? 'PDF engine crashed')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    worker = null
  }

  return w
}

function getWorker(): Worker {
  if (!worker) worker = makeWorker()
  return worker
}

// ─── Core RPC helper ─────────────────────────────────────────────────────────

// Plain Omit<Union, K> collapses a discriminated union to its shared keys only;
// this distributive form keeps each variant's own fields (bytes/payload/docId).
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

function send<T extends WorkerRes>(
  req:      DistributiveOmit<WorkerReq, 'id'>,
  transfer: Transferable[] = [],
): Promise<T> {
  const id = String(++msgSeq)
  const w  = getWorker()
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: WorkerRes) => void, reject })
    const full = { ...req, id } as WorkerReq
    transfer.length ? w.postMessage(full, transfer) : w.postMessage(full)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Warm-start: spawn the worker and download the module bundle.
 * WASM init is deferred until the first openDocument() call.
 * Call on dragenter/hover so the engine is usually ready by the time the user drops.
 */
export function preloadEngine(): void {
  getWorker()
}

/** Load PDF bytes into the engine. Returns a stable docId for subsequent calls. */
export async function openDocument(
  bytes:     Uint8Array,
  password?: string | null,
): Promise<{ docId: string; pageCount: number; pageSizes: PageSize[] }> {
  type R = Extract<WorkerRes, { type: 'open' }>
  const res = await send<R>({ type: 'open', bytes, ...(password ? { password } : {}) })
  return { docId: res.docId, pageCount: res.pageCount, pageSizes: res.pageSizes }
}

/**
 * Render one page. Returns a handle with a Promise and a cancel() function.
 * Call cancel() when the page scrolls out of view — the bitmap is discarded
 * if not yet delivered, so no wasted memory on the main thread.
 */
export function renderPage(
  docId:     string,
  pageIndex: number,
  scale:     number,
): RenderHandle {
  const id = String(++msgSeq)
  const w  = getWorker()

  const promise = new Promise<ImageBitmap>((resolve, reject) => {
    pending.set(id, {
      resolve: (msg) => resolve((msg as Extract<WorkerRes, { type: 'renderPage' }>).bitmap),
      reject,
    })
    w.postMessage({ type: 'renderPage', id, docId, pageIndex, scale } as WorkerReq)
  })

  const cancel = () => {
    if (!pending.has(id)) return
    pending.delete(id)                      // ignore any late response
    worker?.postMessage({                   // ask worker to skip queued job
      type: 'cancelRender',
      targetId: id,
      id: `x-${id}`,                       // not registered, worker never responds
    } as WorkerReq)
  }

  return { promise, cancel }
}

/** Execute a PDF commodity operation (all ops except split). Returns new PDF bytes. */
export async function runOp(payload: Exclude<PdfOpRequest, { op: 'split' }>): Promise<Uint8Array> {
  type R = Extract<WorkerRes, { type: 'op' }>
  const res = await send<R>({ type: 'op', payload })
  return res.bytes
}

/** Split a PDF after the given page indices. Returns one Uint8Array per output part. */
export async function splitDocument(
  file:            Uint8Array,
  splitAfterPages: number[],
): Promise<Uint8Array[]> {
  type R = Extract<WorkerRes, { type: 'splitOp' }>
  const res = await send<R>({ type: 'op', payload: { op: 'split', file, splitAfterPages } })
  return res.parts
}

/** Render every page of an open document to encoded image bytes (PNG/JPEG). */
export async function convertToImages(
  docId:   string,
  format:  'png' | 'jpg',
  scale:   number,
  quality: number,
): Promise<Uint8Array[]> {
  type R = Extract<WorkerRes, { type: 'imagesOp' }>
  const res = await send<R>({ type: 'pdfToImages', docId, scale, format, quality })
  return res.parts
}

/** Release the document from the worker's memory. Call when the user closes the file. */
export async function closeDocument(docId: string): Promise<void> {
  await send({ type: 'close', docId })
}
