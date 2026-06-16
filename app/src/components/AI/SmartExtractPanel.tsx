import { useState } from 'react'
import { useAIStore } from '../../lib/aiStore'
import { extractFromDocument, AIAuthError, AIRateLimitError } from '../../lib/aiClient'
import { getCachedTextLayer } from '../../lib/textLayer'
import type { ExtractionResult } from '../../lib/types'
import styles from './AI.module.css'

interface Props {
  docId:      string
  pageCount:  number
}

const LABELS: Record<keyof ExtractionResult, string> = {
  dates:             'Dates',
  amounts:           'Amounts',
  names:             'Names',
  reference_numbers: 'Reference Numbers',
  key_totals:        'Key Totals',
}

export function SmartExtractPanel({ docId, pageCount }: Props) {
  const { licenseKey, aiServerUrl, extractions, setExtractions } = useAIStore()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleExtract() {
    if (!licenseKey) return
    setLoading(true)
    setError(null)

    // Collect all cached text layers
    const parts: string[] = []
    for (let i = 0; i < pageCount; i++) {
      const layer = getCachedTextLayer(docId, i)
      if (layer) parts.push(layer.items.map(it => it.str).join(' '))
    }
    const text = parts.join('\n\n')

    try {
      const result = await extractFromDocument(licenseKey, aiServerUrl, text, pageCount)
      setExtractions(result)
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

  function copyAll() {
    if (!extractions) return
    navigator.clipboard.writeText(JSON.stringify(extractions, null, 2))
  }

  function downloadCsv() {
    if (!extractions) return
    const rows: string[] = ['Category,Value']
    for (const [key, values] of Object.entries(extractions) as [keyof ExtractionResult, string[]][]) {
      const label = LABELS[key]
      for (const v of values) {
        rows.push(`"${label}","${v.replace(/"/g, '""')}"`)
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'extraction.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.extractPanel}>
      <div className={styles.extractActions}>
        <button
          className={styles.btnPrimary}
          onClick={handleExtract}
          disabled={loading || !licenseKey}
        >
          {loading ? 'Extracting…' : extractions ? 'Re-extract' : 'Extract from document'}
        </button>
        {extractions && (
          <>
            <button className={styles.btnSecondary} onClick={copyAll}>Copy all as JSON</button>
            <button className={styles.btnSecondary} onClick={downloadCsv}>Download CSV</button>
          </>
        )}
      </div>

      {error && <p className={styles.errorMsg}>{error}</p>}

      {!extractions && !loading && !error && (
        <p className={styles.extractHint}>
          Scans all loaded pages and returns structured data: dates, amounts, names,
          reference numbers, and key totals.
        </p>
      )}

      {extractions && (
        <div className={styles.extractGroups}>
          {(Object.keys(LABELS) as (keyof ExtractionResult)[]).map(key => {
            const values = extractions[key]
            if (values.length === 0) return null
            return (
              <div key={key} className={styles.extractGroup}>
                <h4 className={styles.extractGroupTitle}>{LABELS[key]}</h4>
                <ul className={styles.extractList}>
                  {values.map((v, i) => (
                    <li key={i} className={styles.extractItem}>
                      <span>{v}</span>
                      <button
                        className={styles.copyBtn}
                        onClick={() => navigator.clipboard.writeText(v)}
                        title="Copy"
                      >
                        Copy
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
