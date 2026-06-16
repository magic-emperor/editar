// Local (in-browser) converter implementations. No uploads.
import { convertToImages, runOp } from '../pdfEngine'
import { loadPageTextLayer } from '../textLayer'
import { extractNativeText } from '../textExtract'
import { ocrPageParagraphs } from '../ocr'
import { cloudPdf2Docx } from './cloud'
import type { TextItem } from '../types'
import type { ConvertInput, ConvertOptions, ConvertResult } from './registry'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function fileBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer())
}

// Decode any browser-supported image, optionally resize, re-encode to target mime.
async function transcode(
  file: File,
  targetMime: string,
  quality: number,
  maxDim: number | null,
): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file)
  let w = bmp.width, h = bmp.height
  if (maxDim !== null && (w > maxDim || h > maxDim)) {
    const ratio = Math.min(maxDim / w, maxDim / h)
    w = Math.round(w * ratio)
    h = Math.round(h * ratio)
  }
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D context')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await canvas.convertToBlob({ type: targetMime, quality })
  return new Uint8Array(await blob.arrayBuffer())
}

// ── PDF → images (PNG/JPG), one file per page ──
export async function pdfToImages(input: ConvertInput, opts: ConvertOptions): Promise<ConvertResult> {
  const { docId, name } = input.pdf!
  const fmt  = opts.format === 'jpg' ? 'jpg' : 'png'
  const parts = await convertToImages(docId, fmt, opts.scale, opts.quality)
  const stem = name.replace(/\.pdf$/i, '')
  const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png'
  const pad  = String(parts.length).length
  return {
    files: parts.map((bytes, i) => ({
      name: `${stem}-p${String(i + 1).padStart(pad, '0')}.${fmt}`,
      bytes, mime,
    })),
  }
}

// ── PDF → text (.txt), native + OCR fallback per page ──
export async function pdfToText(input: ConvertInput): Promise<ConvertResult> {
  const { docId, bytes, name, pageCount } = input.pdf!
  const chunks: string[] = []
  for (let i = 0; i < pageCount; i++) {
    const layer = await loadPageTextLayer(docId, bytes, i)
    chunks.push(layer.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim())
  }
  const out = new TextEncoder().encode(chunks.join('\n\n'))
  return { files: [{ name: name.replace(/\.pdf$/i, '') + '.txt', bytes: out, mime: 'text/plain' }] }
}

// ── PDF → Markdown (.md) — one ## heading per page ──
export async function pdfToMarkdown(input: ConvertInput): Promise<ConvertResult> {
  const { docId, bytes, name, pageCount } = input.pdf!
  const parts: string[] = []
  for (let i = 0; i < pageCount; i++) {
    const layer = await loadPageTextLayer(docId, bytes, i)
    const text = layer.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim()
    parts.push(`## Page ${i + 1}\n\n${text || '*(empty page)*'}`)
  }
  const md = parts.join('\n\n---\n\n')
  const out = new TextEncoder().encode(md)
  return { files: [{ name: name.replace(/\.pdf$/i, '') + '.md', bytes: out, mime: 'text/markdown' }] }
}

// ── PDF → Excel (.xlsx) — one worksheet per page ──
export async function pdfToExcel(input: ConvertInput): Promise<ConvertResult> {
  const { docId, bytes, name, pageCount } = input.pdf!
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (let i = 0; i < pageCount; i++) {
    const layer = await loadPageTextLayer(docId, bytes, i)
    const rows = layer.items
      .map(it => it.str.trim())
      .filter(Boolean)
      .map(s => [s])
    const ws = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [['(empty page)']])
    XLSX.utils.book_append_sheet(wb, ws, `Page ${i + 1}`)
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { files: [{ name: name.replace(/\.pdf$/i, '') + '.xlsx', bytes: out, mime: XLSX_MIME }] }
}

// ── PDF → PowerPoint (.pptx) — one slide per page ──
export async function pdfToPowerPoint(input: ConvertInput): Promise<ConvertResult> {
  const { docId, bytes, name, pageCount } = input.pdf!
  const mod = await import('pptxgenjs')
  const PptxGenJS = (mod as unknown as { default: typeof import('pptxgenjs') }).default ?? mod
  const pptx = new (PptxGenJS as unknown as new () => {
    addSlide(): {
      addText(text: string, opts: Record<string, unknown>): void
    }
    write(opts: { outputType: string }): Promise<ArrayBuffer>
  })()
  for (let i = 0; i < pageCount; i++) {
    const layer = await loadPageTextLayer(docId, bytes, i)
    const text = layer.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim()
    const slide = pptx.addSlide()
    slide.addText(`Page ${i + 1}`, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 24, bold: true, color: '1c1917' })
    slide.addText(text || '(empty page)', { x: 0.5, y: 1.2, w: 9, h: 5.5, fontSize: 13, color: '444444', valign: 'top' })
  }
  const outBuf = await pptx.write({ outputType: 'arraybuffer' })
  const out = new Uint8Array(outBuf)
  const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  return { files: [{ name: name.replace(/\.pdf$/i, '') + '.pptx', bytes: out, mime: PPTX_MIME }] }
}

// ── Images → PDF (one page per image) ──
export async function imagesToPdf(input: ConvertInput, opts: ConvertOptions): Promise<ConvertResult> {
  const files = input.files ?? []
  if (files.length === 0) throw new Error('Add at least one image')
  const images = await Promise.all(files.map(async f => {
    // Resize path: need to transcode
    if (opts.maxDim !== null) {
      const mime = /jpe?g/i.test(f.type) ? 'image/jpeg' : 'image/png'
      return { bytes: await transcode(f, mime, 1, opts.maxDim), mime }
    }
    // No resize: keep native bytes for PNG/JPEG, transcode only WebP/other
    if (/png/i.test(f.type))   return { bytes: await fileBytes(f), mime: 'image/png' }
    if (/jpe?g/i.test(f.type)) return { bytes: await fileBytes(f), mime: 'image/jpeg' }
    return { bytes: await transcode(f, 'image/png', 1, null), mime: 'image/png' }
  }))
  const pdf = await runOp({ op: 'imagesToPdf', images })
  return { files: [{ name: 'combined.pdf', bytes: pdf, mime: 'application/pdf' }] }
}

// ── PDF → Word (.docx) — smart, OCR-aware, 100% local by default ──
//
// Routing:
//   • Scanned PDF (no native text layer)  → OCR every page into flowing paragraphs.
//   • Digital PDF + faithful opt-in (server) → pdf2docx on the local server.
//   • Digital PDF (default / server off)  → pdf.js text layer → paragraphs.
//
// The scanned path never uploads and never embeds a page image — it produces real,
// selectable, editable text. This is the fix for the "image inside Word" problem
// that pdf2docx exhibits on scanned input (pdf2docx has no OCR).
export async function pdfToWord(input: ConvertInput, opts: ConvertOptions): Promise<ConvertResult> {
  const { docId, bytes, name, pageCount } = input.pdf!
  const stem = name.replace(/\.pdf$/i, '')

  const scanned = await detectScanned(docId, bytes, pageCount, opts)

  // ── Scanned → local OCR into flowing paragraphs ──
  if (scanned) {
    const pages: string[][] = []
    for (let i = 0; i < pageCount; i++) {
      opts.onProgress?.(i, pageCount, `OCR page ${i + 1}/${pageCount}…`)
      pages.push(await ocrPageParagraphs(docId, i))
    }
    opts.onProgress?.(pageCount, pageCount, 'Building document…')
    const out = await buildDocx(pages)
    return {
      files: [{ name: `${stem}.docx`, bytes: out, mime: DOCX_MIME }],
      meta:  { scanned: true, route: 'ocr' },
    }
  }

  // ── Digital + faithful opt-in → local server (pdf2docx) ──
  if (opts.useServer) {
    try {
      const res = await cloudPdf2Docx(input, opts)
      return { ...res, meta: { scanned: false, route: 'faithful' } }
    } catch {
      // Server unreachable mid-run — fall through to local text extraction.
    }
  }

  // ── Digital (local) → pdf.js text layer → paragraphs ──
  const pages: string[][] = []
  for (let i = 0; i < pageCount; i++) {
    opts.onProgress?.(i, pageCount, `Reading page ${i + 1}/${pageCount}…`)
    const layer = await loadPageTextLayer(docId, bytes, i)
    const lines = groupItemsIntoLines(layer.items)
    pages.push(lines.map(line => line.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean))
  }
  opts.onProgress?.(pageCount, pageCount, 'Building document…')
  const out = await buildDocx(pages)
  return {
    files: [{ name: `${stem}.docx`, bytes: out, mime: DOCX_MIME }],
    meta:  { scanned: false, route: 'local-text' },
  }
}

// True when no page has a native (digital) text layer ⇒ the PDF is a scan.
// Uses pdf.js text extraction only (cheap); never triggers OCR here.
async function detectScanned(
  docId: string, bytes: Uint8Array, pageCount: number, opts: ConvertOptions,
): Promise<boolean> {
  for (let i = 0; i < pageCount; i++) {
    opts.onProgress?.(0, pageCount, `Analysing page ${i + 1}/${pageCount}…`)
    const layer = await extractNativeText(docId, bytes, i)
    if (layer.source === 'native') return false   // any real text layer ⇒ digital
  }
  return true
}

// Build a .docx from pages of paragraph strings, one Word paragraph per string,
// with a page break before each page after the first.
async function buildDocx(pages: string[][]): Promise<Uint8Array> {
  const { Document, Paragraph, TextRun, Packer } = await import('docx')
  const children: InstanceType<typeof Paragraph>[] = []

  pages.forEach((paragraphs, pageIndex) => {
    if (pageIndex > 0) children.push(new Paragraph({ pageBreakBefore: true, children: [] }))
    if (paragraphs.length === 0) {
      children.push(new Paragraph({ children: [new TextRun('')] }))
    } else {
      for (const text of paragraphs) {
        children.push(new Paragraph({ children: [new TextRun(text)] }))
      }
    }
  })

  const doc = new Document({ sections: [{ children }] })
  // toBlob (not toBuffer): toBuffer requests a Node Buffer from jszip, which throws
  // "nodebuffer is not supported by this platform" in the browser.
  const blob = await Packer.toBlob(doc)
  return new Uint8Array(await blob.arrayBuffer())
}

// Group TextItems into visual lines by proximity of their y-coordinate.
function groupItemsIntoLines(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const LINE_GAP = 8 // PDF points — items within this distance share a line
  const lines: TextItem[][] = []
  let cur: TextItem[] = [sorted[0]]
  let lineY = sorted[0].y
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]
    if (Math.abs(item.y - lineY) <= LINE_GAP) {
      cur.push(item)
    } else {
      lines.push(cur.sort((a, b) => a.x - b.x))
      cur = [item]
      lineY = item.y
    }
  }
  if (cur.length > 0) lines.push(cur.sort((a, b) => a.x - b.x))
  return lines
}

// ── Image ↔ image (PNG/JPG/WebP) ──
export async function imageToImage(input: ConvertInput, opts: ConvertOptions): Promise<ConvertResult> {
  const files = input.files ?? []
  if (files.length === 0) throw new Error('Add at least one image')
  const mime = opts.format === 'jpg' ? 'image/jpeg' : opts.format === 'webp' ? 'image/webp' : 'image/png'
  const out = await Promise.all(files.map(async f => ({
    name: f.name.replace(/\.[^.]+$/, '') + '.' + opts.format,
    bytes: await transcode(f, mime, opts.quality, opts.maxDim),
    mime,
  })))
  return { files: out }
}
