import { useAIStore, type AIMode } from '../../lib/aiStore'
import { TableCleanupPanel } from './TableCleanupPanel'
import { SmartExtractPanel } from './SmartExtractPanel'
import type { TableSelection } from '../PDFViewer/TableLayer'
import styles from './AI.module.css'

interface Props {
  docId:         string
  pageCount:     number
  tableSelection: TableSelection | null
  onClose:       () => void
}

const TABS: { mode: AIMode; label: string }[] = [
  { mode: 'ocr',     label: 'OCR Correction' },
  { mode: 'table',   label: 'Table Clean-up' },
  { mode: 'extract', label: 'Smart Extract'  },
]

export function AIPanel({ docId, pageCount, tableSelection, onClose }: Props) {
  const { aiMode, setAiMode } = useAIStore()

  const activeMode = aiMode === 'off' ? 'ocr' : aiMode

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>✦ AI Assist</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close AI panel">✕</button>
      </div>

      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.mode}
            className={activeMode === t.mode ? styles.tabActive : styles.tab}
            onClick={() => setAiMode(t.mode)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeMode === 'ocr' && (
          <p className={styles.ocrHint}>
            Amber-underlined words on the document have low OCR confidence.
            Click any underlined word to ask AI for a correction.
          </p>
        )}

        {activeMode === 'table' && (
          tableSelection ? (
            <TableCleanupPanel
              selection={tableSelection}
              docId={docId}
              pageIndex={tableSelection.pageIndex}
            />
          ) : (
            <p className={styles.ocrHint}>
              Select a table (or individual rows) on any page, then click
              "Clean up with AI" here.
            </p>
          )
        )}

        {activeMode === 'extract' && (
          <SmartExtractPanel docId={docId} pageCount={pageCount} />
        )}
      </div>
    </div>
  )
}
