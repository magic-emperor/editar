import { useState } from 'react'
import { useAIStore } from '../../lib/aiStore'
import { cleanupTable, AIAuthError, AIRateLimitError } from '../../lib/aiClient'
import { getCachedTextLayer } from '../../lib/textLayer'
import type { TableSelection } from '../PDFViewer/TableLayer'
import styles from './AI.module.css'

interface Props {
  selection:  TableSelection
  docId:      string
  pageIndex:  number
}

export function TableCleanupPanel({ selection, docId, pageIndex }: Props) {
  const { licenseKey, aiServerUrl, tableCorrections, acceptTableCorrection } = useAIStore()
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [corrections, setCorrections] = useState<Record<string, string>>({})
  const [ran,         setRan]         = useState(false)

  async function handleCleanup() {
    if (!licenseKey) return
    setLoading(true)
    setError(null)

    const { table } = selection
    const rows: string[][] = table.rows.map(row =>
      row.cells.map(c => c.str),
    )

    const layer = getCachedTextLayer(docId, pageIndex)
    const pageContext = layer
      ? layer.items.slice(0, 30).map(i => i.str).join(' ')
      : ''

    try {
      const result = await cleanupTable(licenseKey, aiServerUrl, rows, pageContext)
      setCorrections(result)
      setRan(true)
    } catch (err) {
      setError(
        err instanceof AIAuthError      ? 'Invalid license key' :
        err instanceof AIRateLimitError ? 'Rate limit exceeded' :
        'AI server unavailable',
      )
    } finally {
      setLoading(false)
    }
  }

  const correctionEntries = Object.entries(corrections)

  return (
    <div className={styles.cleanupPanel}>
      {!ran && (
        <button
          className={styles.btnPrimary}
          onClick={handleCleanup}
          disabled={loading || !licenseKey}
        >
          {loading ? 'Analysing…' : 'Clean up with AI'}
        </button>
      )}

      {error && <p className={styles.errorMsg}>{error}</p>}

      {ran && correctionEntries.length === 0 && (
        <p className={styles.cleanupEmpty}>No corrections needed — table looks clean.</p>
      )}

      {correctionEntries.length > 0 && (
        <ul className={styles.correctionList}>
          {correctionEntries.map(([rc, suggestion]) => {
            const [r, c] = rc.split(':').map(Number)
            const already = tableCorrections[rc]
            return (
              <li key={rc} className={styles.correctionItem}>
                <span className={styles.correctionCoord}>Row {r + 1}, Col {c + 1}</span>
                <span className={styles.correctionArrow}>
                  '{selection.table.rows[r]?.cells[c]?.str ?? '?'}' → '{suggestion}'
                </span>
                {already ? (
                  <span className={styles.correctionAccepted}>✓ Accepted</span>
                ) : (
                  <>
                    <button className={styles.ocrAcceptBtn} onClick={() => acceptTableCorrection(rc, suggestion)}>Accept</button>
                    <button className={styles.ocrIgnoreBtn} onClick={() => {
                      const next = { ...corrections }
                      delete next[rc]
                      setCorrections(next)
                    }}>Ignore</button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {ran && (
        <button className={styles.btnSecondary} style={{ marginTop: 8 }} onClick={() => { setRan(false); setCorrections({}) }}>
          Run again
        </button>
      )}
    </div>
  )
}
