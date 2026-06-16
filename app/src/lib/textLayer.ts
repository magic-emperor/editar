// Text-layer orchestrator: native (pdf.js) first, OCR (tesseract) fallback.
//
// Per-(doc,page) cache so scrolling a page out and back never re-extracts or, more
// importantly, re-OCRs (OCR is the slow path). The cache is keyed by docId, so when
// the document changes (new file or post-edit reopen ⇒ new docId) stale entries are
// dropped via clearTextLayerCache().

import { extractNativeText, closeTextDoc } from './textExtract'
import { ocrPage } from './ocr'
import type { PageTextLayer } from './types'

export type TextLayerStatus = 'loading' | 'ocr' | 'ready' | 'none'

const cache = new Map<string, PageTextLayer>()
const inflight = new Map<string, Promise<PageTextLayer>>()

const key = (docId: string, pageIndex: number) => `${docId}:${pageIndex}`

export function getCachedTextLayer(docId: string, pageIndex: number): PageTextLayer | undefined {
  return cache.get(key(docId, pageIndex))
}

/**
 * Resolve a page's text layer. Tries the native layer; if the page is image-only,
 * falls back to OCR (calling `onOcrStart` first so the UI can show "Recognizing…").
 * Results are cached and de-duplicated across concurrent callers.
 */
export function loadPageTextLayer(
  docId: string,
  bytes: Uint8Array,
  pageIndex: number,
  onOcrStart?: () => void,
): Promise<PageTextLayer> {
  const k = key(docId, pageIndex)
  const cached = cache.get(k)
  if (cached) return Promise.resolve(cached)
  const running = inflight.get(k)
  if (running) return running

  const task = (async (): Promise<PageTextLayer> => {
    const native = await extractNativeText(docId, bytes, pageIndex)
    if (native.source === 'native') {
      cache.set(k, native)
      return native
    }
    // Image-only page → OCR.
    onOcrStart?.()
    const ocr = await ocrPage(docId, pageIndex)
    // Keep page dimensions from the native pass when OCR produced none.
    const layer: PageTextLayer = {
      ...ocr,
      pageWidth:  ocr.pageWidth  || native.pageWidth,
      pageHeight: ocr.pageHeight || native.pageHeight,
    }
    cache.set(k, layer)
    return layer
  })().finally(() => inflight.delete(k))

  inflight.set(k, task)
  return task
}

/** All cached text across the document, in page order — used by find-in-page. */
export function allCachedText(docId: string, pageCount: number): PageTextLayer[] {
  const out: PageTextLayer[] = []
  for (let i = 0; i < pageCount; i++) {
    const l = cache.get(key(docId, i))
    if (l) out[i] = l
  }
  return out
}

/** Drop cache + pdf.js doc for a document (or everything). Call on file change. */
export function clearTextLayerCache(docId?: string): void {
  if (!docId) { cache.clear(); inflight.clear(); closeTextDoc(); return }
  for (const k of [...cache.keys()]) if (k.startsWith(`${docId}:`)) cache.delete(k)
  for (const k of [...inflight.keys()]) if (k.startsWith(`${docId}:`)) inflight.delete(k)
  closeTextDoc(docId)
}
