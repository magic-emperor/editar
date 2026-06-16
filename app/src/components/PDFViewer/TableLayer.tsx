import { useEffect, useState } from 'react'
import { loadPageTables } from '../../lib/tableCache'
import { OCR_LOW_CONFIDENCE } from '../../lib/constants'
import type { DetectedTable, TableRow } from '../../lib/types'
import styles from './TableLayer.module.css'

export interface TableSelection {
  pageIndex:  number
  tableIndex: number
  rowIndices: number[]
  table:      DetectedTable
}

// A table in the export basket (whole-table selection across pages)
export interface BasketEntry {
  pageIndex:  number
  tableIndex: number
  table:      DetectedTable
}

interface Props {
  docId:             string
  bytes:             Uint8Array
  pageIndex:         number
  zoom:              number
  ptToPx:            number
  active:            boolean
  selection:         TableSelection | null
  onSelect:          (sel: TableSelection | null) => void
  basket:            BasketEntry[]
  onBasketToggle:    (entry: BasketEntry, append: boolean) => void
}

export function TableLayer({
  docId, bytes, pageIndex, zoom, ptToPx, active, selection, onSelect, basket, onBasketToggle,
}: Props) {
  const [tables, setTables] = useState<DetectedTable[]>([])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadPageTables(docId, bytes, pageIndex)
      .then(t => { if (!cancelled) setTables(t) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [active, docId, bytes, pageIndex])

  if (!active || tables.length === 0) return null

  const scale = zoom * ptToPx

  function tableBounds(table: DetectedTable) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const row of table.rows) {
      for (const cell of row.cells) {
        minX = Math.min(minX, cell.x)
        minY = Math.min(minY, cell.y)
        maxX = Math.max(maxX, cell.x + cell.w)
        maxY = Math.max(maxY, cell.y + cell.h)
      }
    }
    return { minX, minY, maxX, maxY }
  }

  function rowHeight(row: TableRow, nextRow: TableRow | undefined): number {
    const cellH = Math.max(...row.cells.map(c => c.h), 0)
    if (cellH > 2) return cellH
    if (nextRow) return nextRow.y - row.y
    return 12
  }

  function isRowSelected(tableIndex: number, rowIndex: number): boolean {
    return (
      selection !== null &&
      selection.pageIndex  === pageIndex &&
      selection.tableIndex === tableIndex &&
      selection.rowIndices.includes(rowIndex)
    )
  }

  function isInBasket(tableIndex: number): boolean {
    return basket.some(e => e.pageIndex === pageIndex && e.tableIndex === tableIndex)
  }

  function handleRowClick(
    e: React.MouseEvent,
    tableIndex: number,
    rowIndex: number,
    table: DetectedTable,
  ) {
    e.stopPropagation()
    const cur = selection
    const sameTable = cur && cur.tableIndex === tableIndex && cur.pageIndex === pageIndex

    if (e.shiftKey && sameTable) {
      const min = Math.min(...cur.rowIndices, rowIndex)
      const max = Math.max(...cur.rowIndices, rowIndex)
      const range = Array.from({ length: max - min + 1 }, (_, i) => min + i)
      onSelect({ pageIndex, tableIndex, rowIndices: range, table })
    } else if ((e.ctrlKey || e.metaKey) && sameTable) {
      const already = cur.rowIndices.includes(rowIndex)
      const next = already
        ? cur.rowIndices.filter(r => r !== rowIndex)
        : [...cur.rowIndices, rowIndex].sort((a, b) => a - b)
      if (next.length === 0) onSelect(null)
      else onSelect({ pageIndex, tableIndex, rowIndices: next, table })
    } else if (sameTable && cur.rowIndices.length === 1 && cur.rowIndices[0] === rowIndex) {
      onSelect(null)
    } else {
      onSelect({ pageIndex, tableIndex, rowIndices: [rowIndex], table })
    }
  }

  function handleSelectTable(e: React.MouseEvent, ti: number, table: DetectedTable) {
    e.stopPropagation()
    const entry: BasketEntry = { pageIndex, tableIndex: ti, table }
    onBasketToggle(entry, e.shiftKey)
    // Also set row selection to all rows so toolbar appears
    const allRows = table.rows.map(r => r.rowIndex)
    onSelect({ pageIndex, tableIndex: ti, rowIndices: allRows, table })
  }

  return (
    <div className={styles.overlay} onClick={() => onSelect(null)}>
      {tables.map((table, ti) => {
        const b = tableBounds(table)
        if (!isFinite(b.minX)) return null

        const tableLeft   = b.minX   * scale
        const tableTop    = b.minY   * scale
        const tableWidth  = (b.maxX - b.minX) * scale
        const tableHeight = (b.maxY - b.minY) * scale

        const { validation } = table
        const validRate = validation ? validation.rate : null
        const inBasket = isInBasket(ti)

        return (
          <div
            key={ti}
            className={styles.table}
            style={{ left: tableLeft, top: tableTop, width: tableWidth, height: tableHeight }}
          >
            {/* Select-table button (top-left corner) */}
            <button
              className={inBasket ? styles.selectBtnActive : styles.selectBtn}
              onClick={e => handleSelectTable(e, ti, table)}
              title={inBasket ? 'Remove from export selection (Shift+click to add more)' : 'Select entire table (Shift+click to add to current selection)'}
            >
              {inBasket ? '☑ Selected' : '☐ Select'}
            </button>

            {/* Validation badge */}
            {validRate !== null && validRate > 0 && (
              <div className={validRate >= 90 ? styles.validBadge : styles.warnBadge}>
                {validRate >= 90 ? '✓' : '⚠'} {validRate.toFixed(0)}% balance match
              </div>
            )}

            {/* Column separators */}
            {table.colBoundaries.slice(1).map((cx, ci) => (
              <div
                key={`col${ci}`}
                className={styles.colSeparator}
                style={{ left: (cx - b.minX) * scale }}
              />
            ))}

            {/* Rows */}
            {table.rows.map((row, ri) => {
              const nextRow  = table.rows[ri + 1]
              const rh       = rowHeight(row, nextRow)
              const rowTop   = (row.y - b.minY) * scale
              const rowH     = rh * scale
              const selected = isRowSelected(ti, row.rowIndex)

              return (
                <div
                  key={`row${ri}`}
                  className={[
                    styles.row,
                    ri % 2 === 0 ? styles.rowEven : styles.rowOdd,
                    selected ? styles.rowSelected : '',
                  ].join(' ')}
                  style={{ top: rowTop, height: rowH, left: 0, width: '100%' }}
                  onClick={e => handleRowClick(e, ti, row.rowIndex, table)}
                >
                  {row.cells
                    .filter(c => c.source === 'ocr' && (c.confidence ?? 100) < OCR_LOW_CONFIDENCE)
                    .map((c, di) => (
                      <div
                        key={`dot${di}`}
                        className={styles.confDot}
                        style={{ left: (c.x - b.minX) * scale }}
                        title={`Low confidence: ${c.confidence?.toFixed(0)}%`}
                      />
                    ))}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
