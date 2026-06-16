import { useState } from 'react'
import * as XLSX from 'xlsx'
import type { TableSelection } from './TableLayer'
import styles from './TableToolbar.module.css'

interface Props {
  selection:    TableSelection
  fileName:     string
  onDeselect:   () => void
  onSelectAll:  () => void
  aiEnabled?:   boolean
  onAICleanup?: () => void
}

function cellsForSelection(sel: TableSelection): string[][] {
  const rowSet = new Set(sel.rowIndices)
  const rows = sel.table.rows.filter(r => rowSet.has(r.rowIndex))
  const colCount = sel.table.colCount

  return rows.map(row => {
    const out: string[] = Array(colCount).fill('')
    for (const cell of row.cells) {
      if (cell.colIndex < colCount) out[cell.colIndex] = cell.str
    }
    return out
  })
}

function allCellsForTable(sel: TableSelection): string[][] {
  const colCount = sel.table.colCount
  return sel.table.rows
    .filter(row => colCount <= 1 || row.cells.length > 1)   // skip title/caption rows
    .map(row => {
      const out: string[] = Array(colCount).fill('')
      for (const cell of row.cells) {
        if (cell.colIndex < colCount) out[cell.colIndex] = cell.str
      }
      return out
    })
}

function toTsv(cells: string[][]): string {
  return cells.map(row => row.join('\t')).join('\n')
}

function toCsv(cells: string[][]): string {
  return cells.map(row =>
    row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')
  ).join('\n')
}

function dl(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

function stem(fileName: string) {
  return fileName.replace(/\.pdf$/i, '')
}

export function TableToolbar({ selection, fileName, onDeselect, onSelectAll, aiEnabled, onAICleanup }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const { table, rowIndices } = selection

  const flash = (key: string) => {
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  const isAllSelected = rowIndices.length === table.rows.length

  const copyCells = async () => {
    await navigator.clipboard.writeText(toTsv(cellsForSelection(selection))).catch(() => {})
    flash('cells')
  }

  const copyCsv = async () => {
    await navigator.clipboard.writeText(toCsv(cellsForSelection(selection))).catch(() => {})
    flash('csv')
  }

  const exportCsv = () => {
    const name = `${stem(fileName)}-table-${selection.tableIndex + 1}.csv`
    dl(toCsv(allCellsForTable(selection)), name, 'text/csv')
    flash('exportCsv')
  }

  const exportXlsx = () => {
    const data = allCellsForTable(selection)
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Table ${selection.tableIndex + 1}`)
    XLSX.writeFile(wb, `${stem(fileName)}-table-${selection.tableIndex + 1}.xlsx`)
    flash('exportXlsx')
  }

  const { validation } = table
  const rowCount = rowIndices.length
  const label = isAllSelected
    ? `All ${rowCount} rows`
    : `${rowCount} row${rowCount !== 1 ? 's' : ''}`

  return (
    <div className={styles.bar}>
      <span className={styles.selLabel}>{label} selected</span>

      {!isAllSelected && (
        <button className={styles.btn} onClick={onSelectAll}>Select all</button>
      )}

      <button className={styles.btn} onClick={copyCells}>
        {copiedKey === 'cells' ? '✓ Copied' : 'Copy cells'}
      </button>
      <button className={styles.btn} onClick={copyCsv}>
        {copiedKey === 'csv' ? '✓ Copied' : 'Copy as CSV'}
      </button>

      <span className={styles.separator} />

      <button className={styles.btn} onClick={exportCsv}>
        {copiedKey === 'exportCsv' ? '✓ Downloading…' : 'Export CSV'}
      </button>
      <button className={styles.btn} onClick={exportXlsx}>
        {copiedKey === 'exportXlsx' ? '✓ Downloading…' : 'Export Excel'}
      </button>

      {aiEnabled && onAICleanup && (
        <>
          <span className={styles.separator} />
          <button className={styles.btn} onClick={onAICleanup} title="Send table to AI for OCR correction">
            ✦ Clean up with AI
          </button>
        </>
      )}

      {validation && validation.rate > 0 && (
        <span
          className={validation.rate >= 90 ? styles.validPill : styles.warnPill}
          title="Running-balance check: verifies that debits/credits add up row by row (like a bank statement)"
        >
          {validation.rate >= 90 ? '✓' : '⚠'}{' '}
          {validation.rate.toFixed(0)}% balance match
        </span>
      )}

      <button className={styles.deselBtn} onClick={onDeselect} aria-label="Deselect">×</button>
    </div>
  )
}
