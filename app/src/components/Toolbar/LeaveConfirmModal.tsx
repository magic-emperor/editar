import { useEffect } from 'react'
import styles from './LeaveConfirmModal.module.css'

interface Props {
  onConfirm: () => void
  onCancel:  () => void
  title?: string
  message?: string
  confirmText?: string
}

export function LeaveConfirmModal({
  onConfirm,
  onCancel,
  title = 'Leave document?',
  message = 'Any unsaved changes will be lost if you leave this page.',
  confirmText = 'Leave document',
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.backdrop} onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="leave-modal-title">
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.iconWrap}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </div>

        <div className={styles.content}>
          <h2 id="leave-modal-title" className={styles.title}>{title}</h2>
          <p className={styles.desc}>{message}</p>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={onCancel}>
            Stay on page
          </button>
          <button className={styles.btnPrimary} onClick={onConfirm} autoFocus>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
