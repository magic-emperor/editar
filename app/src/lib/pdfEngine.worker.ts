import { PDFiumLibrary } from '@hyzyla/pdfium'
import type { PDFiumDocument } from '@hyzyla/pdfium'
import { MAX_CONCURRENT_RENDERS } from './constants'
import { execOp } from './pdfOps'
import type { PdfOpRequest } from './pdfOps'

// ─── Protocol types (shared with pdfEngine.ts) ────────────────────────────────

export interface PageSize { width: number; height: number }

export type WorkerReq =
  | { id: string; type: 'open';         bytes: Uint8Array; password?: string }
  | { id: string; type: 'renderPage';   docId: string; pageIndex: number; scale: number }
  | { id: string; type: 'cancelRender'; targetId: string }
  | { id: string; type: 'op';           payload: PdfOpRequest }
  | { id: string; type: 'pdfToImages';  docId: string; scale: number; format: 'png' | 'jpg'; quality: number }
  | { id: string; type: 'close';        docId: string }
  | { id: string; type: 'textColorAt';  docId: string; pageIndex: number; x: number; y: number }

export type WorkerRes =
  | { id: string; ok: true;  type: 'open';      docId: string; pageCount: number; pageSizes: PageSize[] }
  | { id: string; ok: true;  type: 'renderPage'; bitmap: ImageBitmap }
  | { id: string; ok: true;  type: 'op';         bytes: Uint8Array }
  | { id: string; ok: true;  type: 'splitOp';    parts: Uint8Array[] }
  | { id: string; ok: true;  type: 'imagesOp';   parts: Uint8Array[] }
  | { id: string; ok: true;  type: 'close' }
  | { id: string; ok: true;  type: 'textColorAt'; rgb: [number, number, number] | null }
  | { id: string; ok: false; error: string }

// ─── PDFium init ──────────────────────────────────────────────────────────────

type Lib = Awaited<ReturnType<typeof PDFiumLibrary.init>>
let library: Lib | null = null
let initPromise: Promise<Lib> | null = null

function getLibrary(): Promise<Lib> {
  if (library) return Promise.resolve(library)
  if (!initPromise) {
    initPromise = PDFiumLibrary.init().then(lib => {
      library = lib
      return lib
    })
  }
  return initPromise
}

// ─── Document store ───────────────────────────────────────────────────────────

const docs = new Map<string, PDFiumDocument>()
let docSeq = 0

// ─── Render queue ─────────────────────────────────────────────────────────────

type RenderJob = { id: string; docId: string; pageIndex: number; scale: number }

const renderQueue: RenderJob[] = []
const cancelledIds  = new Set<string>()
let   activeRenders = 0

function drainQueue(): void {
  while (activeRenders < MAX_CONCURRENT_RENDERS && renderQueue.length > 0) {
    const job = renderQueue.shift()!
    if (cancelledIds.delete(job.id)) continue   // was cancelled before starting
    activeRenders++
    execRender(job).finally(() => {
      activeRenders--
      drainQueue()
    })
  }
}

async function execRender(job: RenderJob): Promise<void> {
  try {
    const doc = docs.get(job.docId)
    if (!doc) { post({ id: job.id, ok: false, error: `doc ${job.docId} not found` }); return }
    const page   = doc.getPage(job.pageIndex)
    const result = await page.render({ scale: job.scale, colorSpace: 'BGRA' })
    const bitmap = await bgraToImageBitmap(result.data, result.width, result.height)
    post({ id: job.id, ok: true, type: 'renderPage', bitmap }, [bitmap])
  } catch (e) {
    post({ id: job.id, ok: false, error: String(e) })
  }
}

// ─── BGRA → ImageBitmap ───────────────────────────────────────────────────────

// DISABLED (true-edit A1): @hyzyla/pdfium already sets REVERSE_BYTE_ORDER for
// colorSpace:'BGRA', so result.data arrives as RGBA already. Swapping here was
// a double-swap that produced the red/blue channel bug (verified: expected
// (219,235,250) at PDF point (300,635) in helv_test.pdf, got (250,235,219)).
// Kept for reference — do not reinstate without re-verifying against the PoC.
// function bgraToRgba(bgra: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
//   const rgba = new Uint8ClampedArray(bgra.length)
//   for (let i = 0; i < bgra.length; i += 4) {
//     rgba[i]     = bgra[i + 2]  // R ← B
//     rgba[i + 1] = bgra[i + 1]  // G
//     rgba[i + 2] = bgra[i]      // B ← R
//     rgba[i + 3] = bgra[i + 3]  // A
//   }
//   return rgba
// }

// result.data is already RGBA; wrap its bytes directly (copy, since the typed
// array must be Uint8ClampedArray<ArrayBuffer> for ImageData / createImageBitmap).
function rgbaView(rgba: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength) as ArrayBuffer)
}

async function bgraToImageBitmap(bgra: Uint8Array, width: number, height: number): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(rgbaView(bgra), width, height))
}

// Render every page of a loaded doc to encoded image bytes (PNG/JPEG) via OffscreenCanvas.
async function renderToImages(
  docId: string, scale: number, format: 'png' | 'jpg', quality: number,
): Promise<Uint8Array[]> {
  const doc = docs.get(docId)
  if (!doc) throw new Error(`doc ${docId} not found`)
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const count = doc.getPageCount()
  const parts: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const result = await doc.getPage(i).render({ scale, colorSpace: 'BGRA' })
    const canvas = new OffscreenCanvas(result.width, result.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2D context for image export')
    ctx.putImageData(new ImageData(rgbaView(result.data), result.width, result.height), 0, 0)
    const blob = await canvas.convertToBlob({ type: mime, quality })
    parts.push(new Uint8Array(await blob.arrayBuffer()))
  }
  return parts
}

// ─── Exact text fill colour (true-edit A5 fix) ──────────────────────────────────
// Reads the fill colour of the character at (x, y) — PDF points, BOTTOM-left origin —
// straight from the content stream via PDFium's text API. The typed @hyzyla/pdfium
// wrapper doesn't expose this, but the raw exports are on the page's module.
type RawPdfium = {
  HEAPU8: Uint8Array
  wasmExports: { malloc(n: number): number; free(p: number): void }
  _FPDFText_LoadPage(page: number): number
  _FPDFText_ClosePage(tp: number): void
  _FPDFText_GetCharIndexAtPos(tp: number, x: number, y: number, xTol: number, yTol: number): number
  _FPDFText_GetFillColor(tp: number, i: number, r: number, g: number, b: number, a: number): number
  _FPDF_ClosePage(page: number): void
}
function textColorAt(docId: string, pageIndex: number, x: number, y: number): [number, number, number] | null {
  const doc = docs.get(docId)
  if (!doc) return null
  const page = doc.getPage(pageIndex) as unknown as { module: RawPdfium; pageIdx: number }
  const M = page.module
  const tp = M._FPDFText_LoadPage(page.pageIdx)
  try {
    if (!tp) return null
    const idx = M._FPDFText_GetCharIndexAtPos(tp, x, y, 4, 4)
    if (idx < 0) return null
    const p = M.wasmExports.malloc(16)
    try {
      if (!M._FPDFText_GetFillColor(tp, idx, p, p + 4, p + 8, p + 12)) return null
      const c = new Uint32Array(M.HEAPU8.buffer, p, 3)
      return [c[0] / 255, c[1] / 255, c[2] / 255]
    } finally { M.wasmExports.free(p) }
  } finally {
    if (tp) M._FPDFText_ClosePage(tp)
    M._FPDF_ClosePage(page.pageIdx)
  }
}

// ─── postMessage wrapper ─────────────────────────────────────────────────────

function post(msg: WorkerRes, transfer: Transferable[] = []): void {
  // Worker's postMessage differs from Window.postMessage — suppress TS mismatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(self as any).postMessage(msg, transfer)
}

// ─── Message handler ─────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const req = e.data as WorkerReq

  // cancelRender is fire-and-forget — no response
  if (req.type === 'cancelRender') {
    cancelledIds.add(req.targetId)
    return
  }

  try {
    switch (req.type) {

      case 'open': {
        const lib  = await getLibrary()
        const doc  = await lib.loadDocument(req.bytes, req.password)
        const id   = String(++docSeq)
        docs.set(id, doc)
        const count     = doc.getPageCount()
        const pageSizes: PageSize[] = []
        for (let i = 0; i < count; i++) {
          const { originalWidth, originalHeight } = doc.getPage(i).getOriginalSize()
          pageSizes.push({ width: originalWidth, height: originalHeight })
        }
        post({ id: req.id, ok: true, type: 'open', docId: id, pageCount: count, pageSizes })
        break
      }

      case 'renderPage': {
        renderQueue.push({ id: req.id, docId: req.docId, pageIndex: req.pageIndex, scale: req.scale })
        drainQueue()
        break
      }

      case 'op': {
        const result = await execOp(req.payload)
        if (Array.isArray(result)) {
          // split — multiple PDF parts
          post({ id: req.id, ok: true, type: 'splitOp', parts: result },
               result.map(b => b.buffer as ArrayBuffer))
        } else {
          post({ id: req.id, ok: true, type: 'op', bytes: result },
               [result.buffer as ArrayBuffer])
        }
        break
      }

      case 'pdfToImages': {
        const parts = await renderToImages(req.docId, req.scale, req.format, req.quality)
        post({ id: req.id, ok: true, type: 'imagesOp', parts }, parts.map(p => p.buffer as ArrayBuffer))
        break
      }

      case 'textColorAt': {
        post({ id: req.id, ok: true, type: 'textColorAt', rgb: textColorAt(req.docId, req.pageIndex, req.x, req.y) })
        break
      }

      case 'close': {
        docs.get(req.docId)?.destroy()
        docs.delete(req.docId)
        post({ id: req.id, ok: true, type: 'close' })
        break
      }
    }
  } catch (e) {
    post({ id: req.id, ok: false, error: String(e) })
  }
}
