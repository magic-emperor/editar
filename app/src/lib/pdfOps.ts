import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { resolveFont } from './fontResolver'
import type { EditOp } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type WatermarkPos =
  | 'top-left' | 'top-right' | 'center'
  | 'bottom-left' | 'bottom-right' | 'diagonal'

export type PdfOpRequest =
  | { op: 'merge'; files: Uint8Array[] }
  | { op: 'split'; file: Uint8Array; splitAfterPages: number[] }
  | { op: 'extract'; file: Uint8Array; pages: number[] }
  | { op: 'remove'; file: Uint8Array; pages: number[] }
  | { op: 'reorder'; file: Uint8Array; newOrder: number[] }
  | { op: 'rotate'; file: Uint8Array; pageIndex: number; rotateDegrees: 90 | 180 | 270 }
  | { op: 'compress'; file: Uint8Array }
  | { op: 'watermark'; file: Uint8Array; text: string; opacity: number; position: WatermarkPos }
  | { op: 'pageNumbers'; file: Uint8Array; startAt: number; position: 'bottom-center' | 'bottom-right' }
  | { op: 'editPage'; file: Uint8Array; edits: EditOp[] }
  | { op: 'imagesToPdf'; images: { bytes: Uint8Array; mime: string }[] }

// Single-result ops return Uint8Array; split returns Uint8Array[]
export async function execOp(req: PdfOpRequest): Promise<Uint8Array | Uint8Array[]> {
  switch (req.op) {
    case 'merge':       return mergePDFs(req.files)
    case 'split':       return splitPDF(req.file, req.splitAfterPages)
    case 'extract':     return extractPages(req.file, req.pages)
    case 'remove':      return removePages(req.file, req.pages)
    case 'reorder':     return reorderPages(req.file, req.newOrder)
    case 'rotate':      return rotatePage(req.file, req.pageIndex, req.rotateDegrees)
    case 'compress':    return compressPDF(req.file)
    case 'watermark':   return addWatermark(req.file, req.text, req.opacity, req.position)
    case 'pageNumbers': return addPageNumbers(req.file, req.startAt, req.position)
    case 'editPage':    return editPage(req.file, req.edits)
    case 'imagesToPdf': return imagesToPdf(req.images)
  }
}

// ─── Guards ───────────────────────────────────────────────────────────────────

function assertUnencrypted(doc: PDFDocument, op: string): void {
  if (doc.isEncrypted) throw new Error(
    `Cannot ${op} a password-protected PDF. Remove the password in your original PDF application first.`
  )
}

// ─── Operations ───────────────────────────────────────────────────────────────

async function mergePDFs(files: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()
  for (const bytes of files) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    assertUnencrypted(src, 'merge')
    const count = src.getPageCount()
    const copied = await merged.copyPages(src, range(count))
    for (const p of copied) merged.addPage(p)
  }
  return save(merged)
}

// splitAfterPages: 0-based indices after which a split occurs.
// e.g. [2] on a 5-page doc → parts [0-2] and [3-4]
async function splitPDF(file: Uint8Array, splitAfterPages: number[]): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(file, { ignoreEncryption: true })
  assertUnencrypted(src, 'split')
  const count = src.getPageCount()
  const breakpoints = [0, ...splitAfterPages.map(p => p + 1), count]
  const parts: Uint8Array[] = []
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const start = breakpoints[i]
    const end   = breakpoints[i + 1]
    if (start >= end) continue
    const part = await PDFDocument.create()
    const copied = await part.copyPages(src, range(end - start, start))
    for (const p of copied) part.addPage(p)
    parts.push(await save(part))
  }
  return parts
}

async function extractPages(file: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(file, { ignoreEncryption: true })
  assertUnencrypted(src, 'extract pages')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, pages)
  for (const p of copied) out.addPage(p)
  return save(out)
}

async function removePages(file: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(file, { ignoreEncryption: true })
  assertUnencrypted(src, 'remove pages')
  // Copy only the pages we KEEP into a fresh document — always faster than
  // calling removePage() N times then serializing the mutated original.
  const removeSet = new Set(pages)
  const keepIndices = Array.from({ length: src.getPageCount() }, (_, i) => i)
    .filter(i => !removeSet.has(i))
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, keepIndices)
  for (const p of copied) out.addPage(p)
  return save(out)
}

async function reorderPages(file: Uint8Array, newOrder: number[]): Promise<Uint8Array> {
  const src   = await PDFDocument.load(file, { ignoreEncryption: true })
  assertUnencrypted(src, 'reorder pages')
  const count = src.getPageCount()
  if (newOrder.length < count)
    throw new Error(
      `List all ${count} pages — you only listed ${newOrder.length}. ` +
      `Example: "${range(count).map(i => i + 1).join(', ')}"`,
    )
  for (const i of newOrder) {
    if (i < 0 || i >= count)
      throw new Error(`Page ${i + 1} does not exist — document has ${count} page${count === 1 ? '' : 's'}`)
  }
  const out    = await PDFDocument.create()
  const copied = await out.copyPages(src, newOrder)
  for (const p of copied) out.addPage(p)
  return save(out)
}

async function rotatePage(
  file: Uint8Array,
  pageIndex: number,
  rotateDegrees: 90 | 180 | 270,
): Promise<Uint8Array> {
  const doc   = await PDFDocument.load(file)
  assertUnencrypted(doc, 'rotate')
  const count = doc.getPageCount()
  if (pageIndex < 0 || pageIndex >= count)
    throw new Error(`Page ${pageIndex + 1} does not exist — this document has ${count} page${count === 1 ? '' : 's'}`)
  doc.getPage(pageIndex).setRotation(degrees(rotateDegrees))
  return save(doc)
}

async function compressPDF(file: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(file)
  assertUnencrypted(doc, 'compress')
  return save(doc, true)
}

async function addWatermark(
  file: Uint8Array,
  text: string,
  opacity: number,
  position: WatermarkPos,
): Promise<Uint8Array> {
  const doc  = await PDFDocument.load(file)
  assertUnencrypted(doc, 'watermark')
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    const fontSize  = Math.round(Math.min(width, height) * 0.08)
    const textWidth = font.widthOfTextAtSize(text, fontSize)
    const margin    = Math.round(Math.min(width, height) * 0.07)

    let x: number, y: number, angleDeg = 0

    if (position === 'diagonal') {
      // Angle follows the page's own diagonal so it scales to any page size
      angleDeg = Math.atan2(height, width) * (180 / Math.PI)
      const rad = angleDeg * (Math.PI / 180)
      // Compute origin so the text's visual centre lands at the page centre
      x = width  / 2 - (textWidth / 2) * Math.cos(rad) + (fontSize / 2) * Math.sin(rad)
      y = height / 2 - (textWidth / 2) * Math.sin(rad) - (fontSize / 2) * Math.cos(rad)
    } else {
      switch (position) {
        case 'top-left':    x = margin;                     y = height - fontSize - margin; break
        case 'top-right':   x = width - textWidth - margin; y = height - fontSize - margin; break
        case 'bottom-left': x = margin;                     y = margin; break
        case 'bottom-right':x = width - textWidth - margin; y = margin; break
        default:            x = (width - textWidth) / 2;   y = (height - fontSize) / 2 // center
      }
    }

    page.drawText(text, {
      x, y,
      size:   fontSize,
      font,
      color:  rgb(0, 0, 0),  // black so opacity slider is clearly visible
      opacity,
      rotate: degrees(angleDeg),
    })
  }
  return save(doc)
}

async function addPageNumbers(
  file: Uint8Array,
  startAt: number,
  position: 'bottom-center' | 'bottom-right',
): Promise<Uint8Array> {
  const doc    = await PDFDocument.load(file)
  assertUnencrypted(doc, 'add page numbers')
  const font   = await doc.embedFont(StandardFonts.Helvetica)
  const margin = 28
  const size   = 11
  doc.getPages().forEach((page, i) => {
    const { width } = page.getSize()
    const label = String(startAt + i)
    const tw    = font.widthOfTextAtSize(label, size)
    page.drawText(label, {
      x:    position === 'bottom-center' ? (width - tw) / 2 : width - tw - margin,
      y:    margin,
      size,
      font,
      color: rgb(0, 0, 0),
    })
  })
  return save(doc)
}

// Apply pending edits by redact-and-redraw. Edit geometry is in point space with a
// top-left origin; pdf-lib uses a bottom-left origin, so y is flipped per page.
async function editPage(file: Uint8Array, edits: EditOp[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(file)
  assertUnencrypted(doc, 'edit')
  doc.registerFontkit(fontkit)
  const pages = doc.getPages()
  const fontCache = new Map<string, PDFFont>()

  for (const e of edits) {
    const page = pages[e.page]
    if (!page) continue
    const ph = page.getSize().height
    const { x, y, w, h } = e.bbox

    if (e.kind === 'redact') {
      page.drawRectangle({ x, y: ph - (y + h), width: w, height: h, color: rgb(...e.fill) })
      continue
    }

    // replace: cover the original first
    if (e.kind === 'replace') {
      page.drawRectangle({ x, y: ph - (y + h), width: w, height: h, color: rgb(...e.bg) })
    }

    const font = await resolveFont(doc, e.style, e.newText, fontCache)
    let size = e.style.size
    // For a replace, shrink to fit the original box width so it never bleeds into neighbours.
    if (e.kind === 'replace' && e.newText.length > 0) {
      const tw = font.widthOfTextAtSize(e.newText, size)
      if (tw > w && tw > 0) size = size * (w / tw)
    }
    // Baseline ~0.8 of the cap height below the box top (leaves room for descenders).
    const baselineFromTop = y + size * 0.8
    page.drawText(e.newText, {
      x: x + size * 0.04,
      y: ph - baselineFromTop,
      size,
      font,
      color: rgb(...e.style.color),
    })
  }

  return save(doc)
}

// Combine images into a PDF, one page per image (page sized to the image).
// Only PNG/JPEG reach here — other formats are transcoded to PNG on the main thread first.
async function imagesToPdf(images: { bytes: Uint8Array; mime: string }[]): Promise<Uint8Array> {
  if (images.length === 0) throw new Error('No images to combine')
  const doc = await PDFDocument.create()
  for (const img of images) {
    const embed = img.mime.includes('png') ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes)
    const page = doc.addPage([embed.width, embed.height])
    page.drawImage(embed, { x: 0, y: 0, width: embed.width, height: embed.height })
  }
  return save(doc)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function range(length: number, offset = 0): number[] {
  return Array.from({ length }, (_, i) => offset + i)
}

async function save(doc: PDFDocument, useObjectStreams = false): Promise<Uint8Array> {
  // .slice() ensures the returned Uint8Array owns its buffer (safe to transfer)
  return (await doc.save({ useObjectStreams })).slice()
}
