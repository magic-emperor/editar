import { useState, useCallback, type ChangeEvent } from 'react'
import { PDFDocument } from 'pdf-lib'
import { useFileStore } from '../../lib/fileStore'
import { preloadEngine } from '../../lib/pdfEngine'
import { PasswordModal } from '../DropZone/PasswordModal'
import styles from './ViewerPage.module.css'

type Mode = 'view' | 'annotate'

const META: Record<Mode, { label: string; note: string; icon: string }> = {
  view:     { label: 'Open & View',  note: 'Upload a PDF to view, navigate and read it in your browser.', icon: '📄' },
  annotate: { label: 'Annotate PDF', note: 'Upload a PDF to highlight, underline and add sticky notes.', icon: '✏️' },
}

async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    return doc.isEncrypted
  } catch {
    return false
  }
}

export function ViewerPage({ mode, onBack }: { mode: Mode; onBack: () => void }) {
  const { openFile } = useFileStore()
  const meta = META[mode]

  const [over,    setOver]    = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [pending, setPending] = useState<{ file: File; bytes: Uint8Array } | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF files are supported.'); return }
    setBusy(true)
    preloadEngine()
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (await isEncrypted(bytes)) { setPending({ file, bytes }); return }
      await openFile(file)
      // App routing: file is now set in store → viewer layout shows
    } catch {
      setError('Could not open this file. It may be damaged or an unsupported format.')
    } finally {
      setBusy(false)
    }
  }, [openFile])

  const handleUnlock = useCallback(async (password: string) => {
    if (!pending) return
    setBusy(true)
    try {
      await openFile(pending.file, password)
    } catch {
      setError('Could not open the file.')
    } finally {
      setPending(null); setBusy(false)
    }
  }, [pending, openFile])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>← Back to tools</button>
        <div className={styles.headerMeta}>
          <span className={styles.toolName}>{meta.label}</span>
          <span className={styles.toolNote}>{meta.note}</span>
        </div>
        <span className={styles.badge}>LOCAL</span>
      </header>

      <div className={styles.body}>
        <label
          className={`${styles.dropZone} ${over ? styles.dzOver : ''}`}
          onDragEnter={e => { e.preventDefault(); preloadEngine(); setOver(true) }}
          onDragOver={e => e.preventDefault()}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
          onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        >
          <input
            type="file" accept=".pdf,application/pdf"
            className={styles.fileInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
          />
          <div className={styles.dzInner}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className={styles.dzIcon}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            <p className={styles.dzPrimary}>{busy ? 'Opening…' : 'Drop your PDF here'}</p>
            <p className={styles.dzSub}>or click anywhere in this area to browse</p>
            {mode === 'annotate' && (
              <p className={styles.dzHint}>
                After loading, you'll get a dedicated annotation toolbar to highlight, underline and add notes.
              </p>
            )}
          </div>
        </label>

        {error && <p className={styles.errMsg} role="alert">{error}</p>}
      </div>

      {pending && (
        <PasswordModal
          fileName={pending.file.name}
          bytes={pending.bytes}
          onUnlock={handleUnlock}
          onCancel={() => { setPending(null) }}
        />
      )}
    </div>
  )
}
