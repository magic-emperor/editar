// OCR fallback for image-only pages, via tesseract.js.
//
// All assets are self-hosted under /public/tesseract (worker, LSTM core, eng lang)
// so the zero-outbound guarantee holds at runtime. The page raster comes from the
// existing PDFium engine at 200 DPI (Phase 0: the minimum DPI that clears the 90%
// gate). tesseract.js manages its own worker, so OCR stays off the UI thread.
//
// Output is normalized to point space with a top-left origin (tesseract's native
// origin is already top-left), with per-word confidence preserved for Phase 3.

import { createWorker, OEM, PSM, type Worker as TWorker } from 'tesseract.js'
import { renderPage } from './pdfEngine'
import { OCR_SCALE } from './constants'
import type { TextItem, PageTextLayer } from './types'

const SELF_HOSTED_LANG_PATH = '/tesseract/lang'
const CDN_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast/'

let currentLang = localStorage.getItem('ocrLanguage') ?? 'eng'
let workerPromise: Promise<TWorker> | null = null

function langPath(lang: string): string {
  return lang === 'eng' ? SELF_HOSTED_LANG_PATH : CDN_LANG_PATH
}

async function getWorker(): Promise<TWorker> {
  if (workerPromise) return workerPromise
  const lang = currentLang
  workerPromise = (async () => {
    const w = await createWorker(lang, OEM.LSTM_ONLY, {
      workerPath: '/tesseract/worker.min.js',
      corePath:   '/tesseract/core',
      langPath:   langPath(lang),
    })
    // PSM 11 (sparse text): keeps word boxes without imposing a reading order —
    // Phase 0 proved geometric layout beats tesseract's column linearization.
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    return w
  })()
  return workerPromise
}

/** Switch OCR language. Terminates the current worker; next OCR call creates a new one. */
export async function setOcrLanguage(lang: string): Promise<void> {
  if (lang === currentLang) return
  currentLang = lang
  localStorage.setItem('ocrLanguage', lang)
  // Terminate existing worker so next getWorker() creates one with the new language
  if (workerPromise) {
    const w = await workerPromise.catch(() => null)
    if (w) await w.terminate().catch(() => {})
    workerPromise = null
  }
}

export function getOcrLanguage(): string { return currentLang }

// Separate worker for document-mode OCR (PDF → Word). Uses PSM.AUTO so tesseract
// applies full page segmentation + paragraph detection — the opposite of the
// sparse-text interactive worker, which is tuned for tables and word boxes.
// Kept distinct so the two PSM settings never clash on a shared worker.
let docWorkerPromise: Promise<TWorker> | null = null

async function getDocWorker(): Promise<TWorker> {
  if (docWorkerPromise) return docWorkerPromise
  const lang = currentLang
  docWorkerPromise = (async () => {
    const w = await createWorker(lang, OEM.LSTM_ONLY, {
      workerPath: '/tesseract/worker.min.js',
      corePath:   '/tesseract/core',
      langPath:   langPath(lang),
    })
    // PSM.AUTO (3): page segmentation without OSD (no osd.traineddata needed) —
    // produces a block→paragraph→line tree we use to rebuild flowing paragraphs.
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    return w
  })()
  return docWorkerPromise
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OCR: no 2D context')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/png' })
}

interface TWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

// tesseract v7 returns a block tree; flatten blocks→paragraphs→lines→words.
function flattenWords(blocks: unknown): TWord[] {
  const out: TWord[] = []
  for (const block of (blocks as any[] | null) ?? [])
    for (const para of block.paragraphs ?? [])
      for (const line of para.lines ?? [])
        for (const word of line.words ?? [])
          if (word?.text?.trim()) out.push(word as TWord)
  return out
}

/** OCR one page. `pageIndex` is 0-based. Renders @ 200 DPI via PDFium, recognizes, normalizes. */
export async function ocrPage(docId: string, pageIndex: number): Promise<PageTextLayer> {
  const bitmap = await renderPage(docId, pageIndex, OCR_SCALE).promise
  const bw = bitmap.width
  const bh = bitmap.height
  const blob = await bitmapToBlob(bitmap)

  const worker = await getWorker()
  const { data } = await worker.recognize(blob, {}, { blocks: true })
  const words = flattenWords((data as any).blocks)

  const items: TextItem[] = words.map(({ text, confidence, bbox }) => ({
    str: text,
    x: bbox.x0 / OCR_SCALE,
    y: bbox.y0 / OCR_SCALE,           // tesseract origin already top-left
    w: (bbox.x1 - bbox.x0) / OCR_SCALE,
    h: (bbox.y1 - bbox.y0) / OCR_SCALE,
    source: 'ocr',
    confidence,
  }))

  return {
    items,
    source: items.length > 0 ? 'ocr' : 'empty',
    pageWidth:  bw / OCR_SCALE,
    pageHeight: bh / OCR_SCALE,
  }
}

/**
 * OCR one page into flowing paragraphs (for PDF → Word). `pageIndex` is 0-based.
 * Each returned string is one paragraph: tesseract's lines within a paragraph are
 * joined with spaces so the text reflows in Word rather than freezing line breaks.
 */
export async function ocrPageParagraphs(docId: string, pageIndex: number): Promise<string[]> {
  const bitmap = await renderPage(docId, pageIndex, OCR_SCALE).promise
  const blob = await bitmapToBlob(bitmap)   // bitmapToBlob closes the bitmap

  const worker = await getDocWorker()
  const { data } = await worker.recognize(blob, {}, { blocks: true })

  const paragraphs: string[] = []
  for (const block of ((data as any).blocks as any[] | null) ?? []) {
    for (const para of block.paragraphs ?? []) {
      const lines: string[] = []
      for (const line of para.lines ?? []) {
        const words = (line.words ?? [])
          .map((w: any) => (w?.text ?? '').trim())
          .filter(Boolean)
        if (words.length) lines.push(words.join(' '))
      }
      const text = lines.join(' ').replace(/\s+/g, ' ').trim()
      if (text) paragraphs.push(text)
    }
  }
  return paragraphs
}

/** Terminate the tesseract workers. Call on app teardown (rarely needed). */
export async function terminateOcr(): Promise<void> {
  const tasks = []
  if (workerPromise) {
    tasks.push(workerPromise.then(w => w.terminate()).catch(() => {}))
    workerPromise = null
  }
  if (docWorkerPromise) {
    tasks.push(docWorkerPromise.then(w => w.terminate()).catch(() => {}))
    docWorkerPromise = null
  }
  await Promise.all(tasks)
}
