// The conversion matrix. Local pairs run in-browser; cloud pairs hit the
// local FastAPI server (server/main.py) and show a consent banner before upload.

import { pdfToImages, pdfToText, pdfToMarkdown, pdfToExcel, pdfToPowerPoint, pdfToWord, imagesToPdf, imageToImage } from './local'
import { cloudOffice2Pdf, cloudTranslatePdf } from './cloud'

export type FormatId = 'pdf' | 'png' | 'jpg' | 'webp' | 'txt' | 'docx' | 'xlsx' | 'pptx'

export interface ConvertInput {
  pdf?:   { docId: string; bytes: Uint8Array; name: string; pageCount: number }
  files?: File[]
}
export interface ConvertOptions {
  scale:      number              // render scale for PDF→image (≈ DPI/72)
  quality:    number              // 0..1 for lossy encoders
  format:     'png' | 'jpg' | 'webp'
  maxDim:     number | null       // max pixel dimension for resize (null = keep original)
  serverUrl:  string              // base URL of the local conversion server
  useServer?: boolean             // opt-in: route digital PDF→Word through the server (faithful layout)
  sourceLang?: string             // 'auto' or Argos ISO code — for Translate PDF
  targetLang?: string             // Argos ISO code — for Translate PDF
  onProgress?: (done: number, total: number, msg: string) => void
}
export interface ConvertResultFile { name: string; bytes: Uint8Array; mime: string }
export interface ConvertResult {
  files: ConvertResultFile[]
  meta?:  Record<string, unknown>  // optional per-converter metadata (e.g. { scanned: true })
}

export type OptionKey = 'scale' | 'quality' | 'imageFormat' | 'resize' | 'sourceLang' | 'targetLang' | 'ocrLanguage'

export interface Converter {
  id:      string
  label:   string
  kind:    'local' | 'cloud'
  source:  'pdf' | 'images'              // 'pdf' = open document; 'images' = file input
  accept?: string                        // file input accept
  options: OptionKey[]
  multi?:  boolean                       // accepts multiple input files
  note?:   string
  run?:    (input: ConvertInput, opts: ConvertOptions) => Promise<ConvertResult>
}

export const CONVERTERS: Converter[] = [
  // ── NEW: from the open PDF (local) — kept first / on top ──
  { id: 'pdf2md',   label: 'PDF → Markdown',      kind: 'local', source: 'pdf',
    options: ['ocrLanguage'], run: pdfToMarkdown,
    note: 'Extracts all text into clean Markdown with page headings. 100% in your browser.' },
  { id: 'pdf2xlsx', label: 'PDF → Excel (.xlsx)',  kind: 'local', source: 'pdf',
    options: ['ocrLanguage'], run: pdfToExcel,
    note: 'Text content as rows in an Excel workbook — one sheet per page. 100% local.' },
  { id: 'pdf2pptx', label: 'PDF → PowerPoint',    kind: 'local', source: 'pdf',
    options: ['ocrLanguage'], run: pdfToPowerPoint,
    note: 'One slide per PDF page with extracted text. 100% in your browser.' },

  // ── From the open PDF (local) ──
  { id: 'pdf2png', label: 'PDF → Images', kind: 'local', source: 'pdf',
    options: ['imageFormat', 'scale', 'quality'], run: pdfToImages,
    note: 'One image per page. Multiple pages download as a ZIP.' },
  { id: 'pdf2txt', label: 'PDF → Text (.txt)', kind: 'local', source: 'pdf',
    options: ['ocrLanguage'], run: pdfToText,
    note: 'Extracts text (OCR for scanned pages — may take a moment).' },

  // ── From image files (local) ──
  { id: 'img2pdf', label: 'Images → PDF', kind: 'local', source: 'images', multi: true,
    accept: 'image/*', options: ['resize'], run: imagesToPdf,
    note: 'Combines images into one PDF, a page per image.' },
  { id: 'img2img', label: 'Convert Images', kind: 'local', source: 'images', multi: true,
    accept: 'image/*', options: ['imageFormat', 'quality', 'resize'], run: imageToImage,
    note: 'Convert between PNG / JPG / WebP.' },

  // ── PDF → Word: smart, OCR-aware, 100% local by default (Phase 4c) ──
  { id: 'pdf2word', label: 'PDF → Word (.docx)', kind: 'local', source: 'pdf',
    options: ['ocrLanguage'], run: pdfToWord,
    note: 'Auto-detects scanned vs digital. Scanned pages are OCR’d to real, editable text — 100% in your browser.' },

  // ── Translate PDF (local server — free, offline via Argos Translate) ──
  { id: 'pdf2translated', label: 'Translate PDF', kind: 'cloud', source: 'pdf',
    options: ['sourceLang', 'targetLang'] as OptionKey[], run: cloudTranslatePdf,
    note: 'Translates all pages to another language — free, offline, no API cost. First use downloads a ~100MB model per language pair (one-time).' },

  // ── Office → PDF (local server — Phase 4b) ──
  { id: 'docx2pdf', label: 'Word → PDF', kind: 'cloud', source: 'images',
    accept: '.docx,.doc', options: [], run: cloudOffice2Pdf,
    note: 'Uses Microsoft Word (Windows) or LibreOffice. Local server only.' },
  { id: 'xlsx2pdf', label: 'Excel → PDF', kind: 'cloud', source: 'images',
    accept: '.xlsx,.xls', options: [], run: cloudOffice2Pdf,
    note: 'Uses LibreOffice headless. Local server only.' },
]
