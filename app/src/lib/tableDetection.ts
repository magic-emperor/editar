// Table detection from PDF text coordinates — Phase 5.
//
// Ported directly from Phase 0's proven algorithm (03_table_structure.mjs and
// 04_scanned_table.mjs), which achieved 94.1% accuracy on finance tables via a
// running-balance arithmetic self-check, for both native and scanned PDFs.
//
// Input:  TextItem[] from loadPageTextLayer (top-left origin, PDF points)
// Output: DetectedTable[] — one entry per distinct table found on the page

import { OCR_LOW_CONFIDENCE } from './constants'
import type { TextItem, TableCell, TableRow, DetectedTable } from './types'

// Row-grouping tolerance in PDF points.
// Native pdf.js coordinates are very precise; 3pt matches Phase 0.
// OCR boxes are noisier so we use 5pt (≈10px at 200 DPI, same as Phase 0's Y_TOL_PX).
const Y_TOL_NATIVE = 3
const Y_TOL_OCR    = 5

// Minimum rows for a cluster to be considered a table (not just scattered text).
const MIN_TABLE_ROWS = 3

// A real table must have at least 2 columns. Single-column groups are paragraphs
// or captions, not tabular data.
const MIN_TABLE_COLS = 2

// Minimum consistent cell count across rows to qualify as a table.
// Mode of cell counts must appear in ≥ half the rows.
const MIN_CONSISTENCY = 0.4

const MONEY_TOL = 0.02  // rounding tolerance for the balance arithmetic check

// Phase 0's proven money regex (handles "(1,234.56)", "1234.56-", "$1,234.56").
const MONEY_RE = /^\(?-?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?-?$/

function parseMoney(tok: string): number | null {
  if (!MONEY_RE.test(tok)) return null
  const neg = tok.includes('(') || tok.trimEnd().endsWith('-')
  const n = Number(tok.replace(/[(),$\s-]/g, ''))
  if (!isFinite(n)) return null
  return neg ? -n : n
}

// Tesseract sometimes splits "1,234.56" into ["1,234", ".56"].
// Walk adjacent pairs and try to join them into a valid money token.
function glueAdjacentMoney(items: TextItem[]): TextItem[] {
  const out: TextItem[] = []
  let i = 0
  while (i < items.length) {
    if (i + 1 < items.length) {
      const joined = items[i].str + items[i + 1].str
      if (parseMoney(joined) !== null) {
        out.push({ ...items[i], str: joined, w: items[i].w + items[i + 1].w })
        i += 2
        continue
      }
    }
    out.push(items[i])
    i++
  }
  return out
}

// ── Pass 1: Y-bucketing ──────────────────────────────────────────────────────

interface RawRow { y: number; items: TextItem[] }

function bucketRows(items: TextItem[]): RawRow[] {
  if (items.length === 0) return []

  // Determine tolerance from source: if any item is OCR use the wider tolerance.
  const yTol = items.some(it => it.source === 'ocr') ? Y_TOL_OCR : Y_TOL_NATIVE

  const filtered = items.filter(it => it.str.trim() !== '')
  const gluedItems = glueAdjacentMoney(filtered)
  const sorted = [...gluedItems].sort((a, b) => a.y - b.y || a.x - b.x)

  const rows: RawRow[] = []
  for (const it of sorted) {
    const row = rows.find(r => Math.abs(r.y - it.y) <= yTol)
    if (row) {
      row.items.push(it)
    } else {
      rows.push({ y: it.y, items: [it] })
    }
  }

  // Sort cells left→right within each row
  for (const r of rows) r.items.sort((a, b) => a.x - b.x)

  return rows.sort((a, b) => a.y - b.y)
}

// ── Pass 2: X-interval column assignment ─────────────────────────────────────
//
// Problem with the naive x-gap approach: right-aligned or centred text in a
// column has a different left-edge (x) for each row, so "Main character" and
// "Sidekick 1" in the same column appear to be different columns.
//
// Fix: treat each cell as an interval [x, x+w] and MERGE overlapping/adjacent
// intervals across all rows. Merged intervals = actual columns. Gaps between
// merged intervals = column separators.  Cells are then assigned to the
// interval that contains their x (or nearest, for edge-cases).

// Minimum empty space between two intervals to treat them as separate columns.
const MIN_COL_GAP = 6  // PDF points (~8px at 96dpi)

interface ColInterval { left: number; right: number }

function medianOf(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

function inferColumnIntervals(rows: RawRow[]): ColInterval[] {
  // Single-cell rows are usually titles/footnotes/separators. A wide title like
  // "Table 7: year-end statement (£, thousands)" produces an interval that spans
  // the whole page and would merge all column intervals into one.
  // Fix: only use rows with ≥2 cells (and ≥ half the modal cell count) to build
  // column intervals. Every row still gets its cells assigned afterwards.
  const mode = modeOf(rows.map(r => r.items.length))
  const minCells = Math.max(2, Math.floor(mode * 0.5))
  const repRows = rows.filter(r => r.items.length >= minCells)
  const source  = repRows.length >= 2 ? repRows : rows

  const spans: [number, number][] = []
  for (const row of source) {
    for (const it of row.items) {
      const w = Math.max(it.w, 4)  // minimum 4pt width for items with w=0
      spans.push([it.x, it.x + w])
    }
  }
  if (spans.length === 0) return []
  spans.sort((a, b) => a[0] - b[0])

  const merged: ColInterval[] = [{ left: spans[0][0], right: spans[0][1] }]
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1]
    if (spans[i][0] <= last.right + MIN_COL_GAP) {
      last.right = Math.max(last.right, spans[i][1])
    } else {
      merged.push({ left: spans[i][0], right: spans[i][1] })
    }
  }
  return merged
}

function assignColIndex(x: number, cols: ColInterval[]): number {
  // Find the interval that contains x
  for (let i = 0; i < cols.length; i++) {
    if (x >= cols[i].left - 2 && x <= cols[i].right + 2) return i
  }
  // Fallback: nearest interval midpoint
  let best = 0, bestDist = Infinity
  for (let i = 0; i < cols.length; i++) {
    const mid = (cols[i].left + cols[i].right) / 2
    const d = Math.abs(x - mid)
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

// ── Table boundary detection ─────────────────────────────────────────────────

// How many times larger than the median row-to-row Y gap a gap must be to
// signal "this is a new table" rather than just a tall row or blank line within
// a table. 2.2× catches the blank paragraph between stacked tables while
// keeping merged-cell rows (which are ~1.5–1.8× taller) inside the same table.
const Y_GAP_BREAK_FACTOR = 2.2

// Group contiguous rows into tables by checking (a) cell-count consistency and
// (b) vertical gap size.  Two rows separated by more than Y_GAP_BREAK_FACTOR ×
// the median row pitch are assumed to belong to different tables.
function groupIntoTables(rows: RawRow[]): RawRow[][] {
  if (rows.length === 0) return []

  // Median Y step between consecutive rows — our proxy for "one row height".
  const ySteps = rows.slice(1).map((r, i) => r.y - rows[i].y).filter(d => d > 0)
  const medianStep = ySteps.length > 0 ? medianOf(ySteps) : 14
  const maxGap = medianStep * Y_GAP_BREAK_FACTOR

  const tables: RawRow[][] = []
  let current: RawRow[] = [rows[0]]

  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i]
    const prev = rows[i - 1]

    // Large vertical gap → start a fresh table segment
    if (row.y - prev.y > maxGap) {
      tables.push(current)
      current = [row]
      continue
    }

    current.push(row)

    // Re-check cell-count consistency once we have enough rows
    if (current.length >= MIN_TABLE_ROWS) {
      const counts = current.map(r => r.items.length)
      const mode = modeOf(counts)
      const consistency = counts.filter(c => Math.abs(c - mode) <= 1).length / counts.length
      if (consistency < MIN_CONSISTENCY) {
        tables.push(current.slice(0, -1))
        current = [row]
      }
    }
  }
  if (current.length > 0) tables.push(current)

  return tables.filter(t => {
    if (t.length < MIN_TABLE_ROWS) return false
    const mode = modeOf(t.map(r => r.items.length))
    return mode >= MIN_TABLE_COLS
  })
}

function modeOf(arr: number[]): number {
  const freq = new Map<number, number>()
  for (const v of arr) freq.set(v, (freq.get(v) ?? 0) + 1)
  let best = arr[0], bestCount = 0
  for (const [v, c] of freq) { if (c > bestCount) { best = v; bestCount = c } }
  return best
}

// ── Running-balance self-check ───────────────────────────────────────────────

function runBalanceCheck(
  tableRows: TableRow[],
): { passed: number; total: number; rate: number } | undefined {
  // Find rows with ≥2 money values
  const moneyRows = tableRows.map(row => {
    const money = row.cells
      .map(c => ({ v: parseMoney(c.str), x: c.x }))
      .filter((m): m is { v: number; x: number } => m.v !== null)
    return money.length >= 2 ? money : null
  }).filter((m): m is { v: number; x: number }[] => m !== null)

  if (moneyRows.length < 3) return undefined  // too few rows for a meaningful check

  let comparable = 0, passed = 0
  let prevBal: number | null = null

  for (const money of moneyRows) {
    const balance = money[money.length - 1].v
    const amount  = Math.abs(money[money.length - 2].v)
    if (prevBal !== null && amount > 0) {
      comparable++
      if (Math.abs(Math.abs(balance - prevBal) - amount) <= MONEY_TOL) passed++
    }
    prevBal = balance
  }

  if (comparable < 2) return undefined
  return { passed, total: comparable, rate: (passed / comparable) * 100 }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function detectTables(items: TextItem[], pageIndex: number): DetectedTable[] {
  const rawRows = bucketRows(items)
  const tableGroups = groupIntoTables(rawRows)

  return tableGroups.map(group => {
    const colIntervals = inferColumnIntervals(group)
    const colCount     = colIntervals.length
    // colBoundaries: left edge of each column interval — used by TableLayer to draw separators
    const colBoundaries = colIntervals.map(c => c.left)

    let rowIndex = 0
    const tableRows: TableRow[] = group.map(raw => {
      const cells: TableCell[] = raw.items.map(it => ({
        str:        it.str,
        colIndex:   assignColIndex(it.x, colIntervals),
        rowIndex,
        x:          it.x,
        y:          it.y,
        w:          it.w,
        h:          it.h,
        source:     it.source,
        confidence: it.confidence,
      }))
      return { rowIndex: rowIndex++, y: raw.y, cells }
    })

    const validation = runBalanceCheck(tableRows)
    return { rows: tableRows, colCount, colBoundaries, pageIndex, validation }
  })
}

// Re-export for use in validation badge rendering
export { OCR_LOW_CONFIDENCE }
