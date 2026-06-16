// Native text-layer extraction via pdf.js.
//
// pdf.js is used ONLY as a text-position extractor — it never renders a page
// (PDFium does all rendering). This sidesteps the Phase 0 finding that pdf.js
// renders JBIG2 scans blank: for an image-only page pdf.js simply finds no text
// layer, which the orchestrator treats as "needs OCR".
//
// Runs on the main thread but pdf.js spawns its own worker, so parsing stays off
// the UI thread. Output is normalized to point space with a top-left origin.

import * as pdfjsLib from 'pdfjs-dist'
import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import type { TextItem, PageTextLayer } from './types'
import { EMPTY_TEXT_THRESHOLD } from './constants'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl

// Single-document cache (the viewer shows one document at a time). The loading
// task owns destroy(); the proxy itself doesn't expose it in the v6 types.
let cache: { docId: string; task: PDFDocumentLoadingTask; doc: PDFDocumentProxy } | null = null

// Passwords for encrypted documents — keyed by docId, cleared on doc close.
const passwords = new Map<string, string>()

/** Store the password for an encrypted document so pdfjs can decrypt it. */
export function registerDocPassword(docId: string, password: string | null): void {
  if (password) passwords.set(docId, password)
  else passwords.delete(docId)
}

/** Validate a password against encrypted PDF bytes. Returns true if correct. */
export async function validatePdfPassword(bytes: Uint8Array, password: string): Promise<boolean> {
  try {
    const task = pdfjsLib.getDocument({ data: bytes.slice(), password })
    await task.promise
    task.destroy()
    return true
  } catch (e: unknown) {
    const msg = String(e)
    // pdfjs throws PasswordException for wrong/missing password
    if (msg.includes('PasswordException') || msg.toLowerCase().includes('password')) return false
    throw e
  }
}

async function getDoc(docId: string, bytes: Uint8Array): Promise<PDFDocumentProxy> {
  if (cache && cache.docId === docId) return cache.doc
  if (cache) { cache.task.destroy(); cache = null }
  // .slice() — pdf.js may transfer/detach the buffer; never touch fileStore's copy.
  // standardFontDataUrl: self-hosted standard-14 font metrics so pdf.js computes
  // accurate glyph widths for non-embedded fonts (keeps selection/highlight aligned).
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    password: passwords.get(docId),
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  const doc  = await task.promise
  cache = { docId, task, doc }
  return doc
}

/** Extract the native text layer for one page. `pageIndex` is 0-based. */
export async function extractNativeText(
  docId: string,
  bytes: Uint8Array,
  pageIndex: number,
): Promise<PageTextLayer> {
  const doc      = await getDoc(docId, bytes)
  const page     = await doc.getPage(pageIndex + 1)   // pdf.js pages are 1-based
  const viewport = page.getViewport({ scale: 1 })     // scale 1 ⇒ dimensions in PDF points
  const pageWidth  = viewport.width
  const pageHeight = viewport.height

  const content = await page.getTextContent()
  const items: TextItem[] = []
  let charCount = 0

  for (const raw of content.items) {
    if (!('str' in raw)) continue                     // skip marked-content items
    const str = raw.str
    if (str.trim() === '') continue
    charCount += str.trim().length

    // transform = [a, b, c, d, e, f]; e=x, f=y baseline in PDF points (bottom-left origin).
    const tx = raw.transform as number[]
    const x  = tx[4]
    const yBaseline = tx[5]
    const h  = raw.height || Math.hypot(tx[1], tx[3])  // run height ≈ font size
    const w  = raw.width
    // Flip to top-left origin: top of glyph ≈ baseline − ascent ≈ (H − yBaseline) − h
    const y  = pageHeight - yBaseline - h

    items.push({ str, x, y, w, h, fontName: raw.fontName, source: 'native' })
  }

  const source: PageTextLayer['source'] = charCount < EMPTY_TEXT_THRESHOLD ? 'empty' : 'native'
  return { items: source === 'empty' ? [] : items, source, pageWidth, pageHeight }
}

// ─── Embedded font reuse (Phase 3.1) ────────────────────────────────────────────
//
// pdf.js sanitises each embedded font into a browser-usable OpenType and exposes the
// bytes via page.commonObjs.get(fontName).data — but only once the page's fonts have
// loaded (during getOperatorList), so we run that once per page and cache the result.

const opListDone = new Set<string>()          // `${docId}:${pageIndex}`
const fontBytes  = new Map<string, Uint8Array | null>()  // `${docId}:${fontName}`

async function ensureFontsLoaded(docId: string, bytes: Uint8Array, pageIndex: number): Promise<void> {
  const key = `${docId}:${pageIndex}`
  if (opListDone.has(key)) return
  const doc  = await getDoc(docId, bytes)
  const page = await doc.getPage(pageIndex + 1)
  await page.getOperatorList()                 // resolves fonts into commonObjs
  opListDone.add(key)
}

/** Warm the page's fonts so getEmbeddedFontBytes is instant on click. */
export async function preloadPageFonts(docId: string, bytes: Uint8Array, pageIndex: number): Promise<void> {
  try { await ensureFontsLoaded(docId, bytes, pageIndex) } catch { /* non-fatal */ }
}

/** The document's own font bytes for a pdf.js fontName (e.g. "g_d0_f1"), or null. */
export async function getEmbeddedFontBytes(
  docId: string, bytes: Uint8Array, pageIndex: number, fontName?: string,
): Promise<Uint8Array | null> {
  if (!fontName) return null
  const ck = `${docId}:${fontName}`
  if (fontBytes.has(ck)) return fontBytes.get(ck)!
  try {
    await ensureFontsLoaded(docId, bytes, pageIndex)
    const doc  = await getDoc(docId, bytes)
    const page = await doc.getPage(pageIndex + 1)
    const objs = page.commonObjs as { has(id: string): boolean; get(id: string): unknown }
    if (!objs.has(fontName)) { fontBytes.set(ck, null); return null }
    const fontObj = objs.get(fontName) as { data?: Uint8Array } | null
    const data = fontObj?.data
    const out = data && data.length > 4 ? new Uint8Array(data) : null  // copy out of pdf.js memory
    fontBytes.set(ck, out)
    return out
  } catch { fontBytes.set(ck, null); return null }
}

/** Drop the cached pdf.js document. Call when the file closes/changes. */
export function closeTextDoc(docId?: string): void {
  if (!cache) return
  if (docId && cache.docId !== docId) return
  passwords.delete(cache.docId)
  cache.task.destroy()
  cache = null
  opListDone.clear()
  fontBytes.clear()
}
