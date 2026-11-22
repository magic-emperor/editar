import styles from './BottomEditBar.module.css'

interface Props {
  editCount: number
  engineReady: boolean
  running: boolean
  applied: boolean
  onApply: () => void
  onDownload: () => void
}

export function BottomEditBar({ editCount, engineReady, running, applied, onApply, onDownload }: Props) {
  const hasEdits = engineReady || editCount > 0

  const centerText = applied
    ? '✓ Document updated'
    : engineReady
      ? `${editCount > 0 ? editCount + ' edit' + (editCount !== 1 ? 's' : '') + ' made' : 'Click any text to edit'}`
      : editCount > 0
        ? `${editCount} pending edit${editCount !== 1 ? 's' : ''}`
        : 'Click any text to edit'

  return (
    <div className={styles.bar}>
      <span className={styles.privacy}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        100% local — your PDF never leaves this device
      </span>

      <span className={styles.center}>{centerText}</span>

      <div className={styles.actions}>
        {applied && (
          <button className={styles.downloadBtn} onClick={onDownload}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download PDF
          </button>
        )}
        <button
          className={`${styles.applyBtn} ${!hasEdits ? styles.applyDisabled : ''}`}
          onClick={onApply}
          disabled={running || !hasEdits}
        >
          {running ? (
            <span className={styles.spinner} />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
          {running ? 'Applying…' : 'Apply to Document'}
        </button>
      </div>
    </div>
  )
}
