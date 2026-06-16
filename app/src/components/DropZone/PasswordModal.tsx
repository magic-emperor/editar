import { useState, useRef, useEffect } from 'react'
import { validatePdfPassword } from '../../lib/textExtract'
import styles from './PasswordModal.module.css'

interface Props {
  fileName: string
  bytes:    Uint8Array
  onUnlock: (password: string) => void
  onCancel: () => void
}

export function PasswordModal({ fileName, bytes, onUnlock, onCancel }: Props) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit() {
    if (!password) { setError('Please enter a password.'); return }
    setBusy(true)
    setError(null)
    try {
      const ok = await validatePdfPassword(bytes, password)
      if (ok) {
        onUnlock(password)
      } else {
        setError('Incorrect password. Please try again.')
        inputRef.current?.select()
      }
    } catch {
      setError('Could not verify the password. The file may be damaged.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        <h2 className={styles.title}>Password Protected</h2>
        <p className={styles.desc}>
          <strong>{fileName}</strong> is encrypted. Enter the document password to open it.
        </p>
        <input
          ref={inputRef}
          className={styles.input}
          type="password"
          placeholder="Enter password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          autoComplete="current-password"
          disabled={busy}
        />
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={styles.btnPrimary}
            onClick={handleSubmit}
            disabled={busy || !password}
          >
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}
