import { useState } from 'react'
import { useAIStore } from '../../lib/aiStore'
import styles from './AI.module.css'

interface Props {
  docId:    string
  fileName: string
  onClose:  () => void
}

export function AIConsent({ docId, fileName, onClose }: Props) {
  const { consentDoc } = useAIStore()
  const [checked, setChecked] = useState(false)

  function handleConfirm() {
    if (!checked) return
    consentDoc(docId)
    onClose()
  }

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modal}>
        <h3 className={styles.modalTitle}>AI Assist — Data Notice</h3>
        <p className={styles.modalBody}>
          The text content of <strong>{fileName}</strong> will be sent to
          your configured AI provider to power AI features. No images or
          personal data outside the document text are transmitted.
        </p>
        <label className={styles.consentRow}>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
          />
          <span>I understand and consent for this document</span>
        </label>
        <div className={styles.modalActions}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button
            className={styles.btnPrimary}
            onClick={handleConfirm}
            disabled={!checked}
          >
            Enable AI for this document
          </button>
        </div>
      </div>
    </div>
  )
}
