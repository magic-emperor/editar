import { init } from '@embedpdf/pdfium'
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'

let PInstance: any = null
let MInstance: any = null
// Promise lock — prevents concurrent callers from both running init() when
// the first call is still awaiting the WASM fetch. Without this, a 2-page PDF
// renders two EditLayers that both call getPdfium() before PInstance is set,
// causing PDFiumExt_Init() to run twice on two separate module instances,
// which corrupts the WASM function table → "table index is out of bounds".
let _initPromise: Promise<{ P: any; M: any }> | null = null

export async function getPdfium() {
  if (PInstance && MInstance) {
    return { P: PInstance, M: MInstance }
  }
  if (!_initPromise) {
    _initPromise = (async () => {
      const response = await fetch(wasmUrl)
      const wasmBinary = await response.arrayBuffer()
      const P = await init({ wasmBinary })
      P.PDFiumExt_Init()
      const M = P.pdfium
      PInstance = P
      MInstance = M
      return { P, M }
    })()
  }
  return _initPromise
}

export function malloc(M: any, size: number): number {
  // Browser build: M._malloc(); Node/CJS build: M.wasmExports.malloc()
  return M._malloc ? M._malloc(size) : M.wasmExports.malloc(size)
}

export function free(M: any, ptr: number): void {
  if (M._free) M._free(ptr)
  else M.wasmExports.free(ptr)
}

/**
 * Write a JS string into WASM heap memory as UTF-16 LE, with NUL terminator.
 * ptr must point to at least (text.length + 1) * 2 bytes of allocated space.
 * We do NOT use M.stringToUTF16 because it prepends a BOM and reverses byte
 * order on some Emscripten builds, producing garbled text like "?ipatsaf".
 */
export function writeUtf16Le(M: any, ptr: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    M.HEAPU8[ptr + i * 2]     = code & 0xFF
    M.HEAPU8[ptr + i * 2 + 1] = (code >> 8) & 0xFF
  }
  // NUL terminator
  M.HEAPU8[ptr + text.length * 2]     = 0
  M.HEAPU8[ptr + text.length * 2 + 1] = 0
}

export function getObjText(P: any, M: any, obj: any, textPage: any): string {
  const n = P.FPDFTextObj_GetText(obj, textPage, 0, 0)
  if (n <= 0) return ''
  const p = malloc(M, n)
  P.FPDFTextObj_GetText(obj, textPage, p, n)
  const s = M.UTF16ToString(p)
  free(M, p)
  return s
}

export function getObjBounds(P: any, M: any, obj: any): { left: number; bottom: number; right: number; top: number } {
  const p = malloc(M, 16)
  P.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)
  const f = new Float32Array(M.HEAPU8.buffer, p, 4)
  const r = [...f].map(v => +v.toFixed(2))
  free(M, p)
  return { left: r[0], bottom: r[1], right: r[2], top: r[3] }
}

export function saveDocToBytes(P: any, M: any, doc: any): Uint8Array {
  const w = P.PDFiumExt_OpenFileWriter()
  P.PDFiumExt_SaveAsCopy(doc, w)
  const size = P.PDFiumExt_GetFileWriterSize(w)
  const op = malloc(M, size)
  P.PDFiumExt_GetFileWriterData(w, op, size)
  const res = new Uint8Array(M.HEAPU8.slice(op, op + size))
  free(M, op)
  P.PDFiumExt_CloseFileWriter(w)
  return res
}
