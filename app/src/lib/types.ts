// Shared text-layer types (Phase 2).
//
// A TextItem is one selectable unit of text on a page, expressed in **PDF point
// space with a top-left origin** (y grows downward) — already y-flipped from the
// PDF's native bottom-left origin so the DOM overlay can position it directly by
// scaling with the current zoom. One item ≈ one word (OCR) or one text run (native).

export interface TextItem {
  str:        string   // the text content
  x:          number   // left edge, PDF points, from page left
  y:          number   // top edge, PDF points, from page top (already flipped)
  w:          number   // width in PDF points
  h:          number   // height (≈ font size) in PDF points
  fontName?:  string   // native font ref (pdf.js) — used by Phase 3 font matching
  source:     'native' | 'ocr'
  confidence?: number  // 0–100, OCR only; undefined for native (treated as certain)
}

// Result of extracting a page's text layer.
export interface PageTextLayer {
  items:     TextItem[]
  source:    'native' | 'ocr' | 'empty'  // 'empty' = no text found at all
  pageWidth:  number  // page width in PDF points (for overlay scaling)
  pageHeight: number  // page height in PDF points
}

// ─── Phase 5: Live Tables ──────────────────────────────────────────────────────

export interface TableCell {
  str:         string
  colIndex:    number
  rowIndex:    number
  x:           number   // PDF points, top-left origin
  y:           number
  w:           number
  h:           number
  source:      'native' | 'ocr'
  confidence?: number   // OCR only
}

export interface TableRow {
  rowIndex: number
  y:        number   // representative y of the row (PDF points)
  cells:    TableCell[]
}

export interface DetectedTable {
  rows:          TableRow[]
  colCount:      number
  colBoundaries: number[]   // x positions (PDF points) where each column starts
  pageIndex:     number
  // Populated when the table appears to be a finance table (≥2 money columns).
  // rate = fraction of rows where |balance[i] − balance[i−1]| == amount[i].
  validation?: { passed: number; total: number; rate: number }
}

// ─── Phase 6: AI Assist ────────────────────────────────────────────────────────

export interface ExtractionResult {
  dates:             string[]
  amounts:           string[]
  names:             string[]
  reference_numbers: string[]
  key_totals:        string[]
}

// ─── Phase 3: editing ──────────────────────────────────────────────────────────

export type RGB = [number, number, number]            // each channel 0..1
export type FontFamily =
  | 'sans' | 'serif' | 'mono'              // DejaVu (broad coverage, good base-14 substitutes)
  | 'roboto' | 'ptserif' | 'robotomono'    // extra picks for closer visual matches

// All edit geometry is in PDF point space with a top-left origin (Phase 2 convention);
// the worker y-flips back to PDF's bottom-left origin when writing to the document.
export interface EditRect { x: number; y: number; w: number; h: number }

export interface EditStyle {
  size:     number       // font size in points
  color:    RGB          // text colour
  bold:     boolean
  italic:   boolean
  family:   FontFamily   // resolved fallback family (name-based; IntelliFont may sharpen later)
  fontName?: string      // original pdf.js font ref — key for embedded-font reuse
  embeddedFont?: Uint8Array  // the document's own font bytes (pdf.js), reused for a pixel-faithful redraw
}

// A pending edit. `id` is a client-generated key for list/undo bookkeeping.
export type EditOp =
  | { id: string; kind: 'replace'; page: number; bbox: EditRect; newText: string; style: EditStyle; bg: RGB }
  | { id: string; kind: 'add';     page: number; bbox: EditRect; newText: string; style: EditStyle }
  | { id: string; kind: 'redact';  page: number; bbox: EditRect; fill: RGB }
