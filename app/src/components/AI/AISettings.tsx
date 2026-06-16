import { useState } from 'react'
import { useAIStore } from '../../lib/aiStore'
import styles from './AI.module.css'

interface Props {
  onClose: () => void
}

export function AISettings({ onClose }: Props) {
  const { licenseKey, setLicenseKey } = useAIStore()
  const [draft, setDraft] = useState(licenseKey ?? '')
  const [saved, setSaved] = useState(false)

  function handleSave() {
    const trimmed = draft.trim()
    setLicenseKey(trimmed || null)
    setSaved(true)
    setTimeout(() => { setSaved(false); if (trimmed) onClose() }, 800)
  }

  function handleRemove() {
    setLicenseKey(null)
    setDraft('')
  }

  return (
    <div className={styles.settingsPanel}>
      <div className={styles.settingsHeader}>
        <span className={styles.settingsTitle}>AI Assist — License Key</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>
      <p className={styles.settingsNote}>
        Enter your Editar license key to unlock AI features.
        The key is stored locally in your browser — it is only sent to the
        AI server to verify your subscription.
      </p>
      <input
        className={styles.keyInput}
        type="password"
        placeholder="ld-xxxx-xxxx-xxxx"
        value={draft}
        onChange={e => { setDraft(e.target.value); setSaved(false) }}
        onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
        spellCheck={false}
        autoComplete="off"
      />
      <div className={styles.modalActions}>
        {licenseKey && (
          <button className={styles.btnDanger} onClick={handleRemove}>Remove key</button>
        )}
        <button className={styles.btnPrimary} onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save key'}
        </button>
      </div>
    </div>
  )
}
