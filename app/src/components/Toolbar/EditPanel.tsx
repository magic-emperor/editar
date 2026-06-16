import { useState } from 'react'
import { useEditStore, type EditTool } from '../../lib/editStore'
import { useFileStore } from '../../lib/fileStore'
import { runOp } from '../../lib/pdfEngine'
import styles from './EditPanel.module.css'

function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a   = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

const TOOLS: { id: EditTool; label: string; hint: string }[] = [
  { id: 'select',   label: 'Edit',      hint: 'Click any word to correct it.' },
  { id: 'text',     label: 'Add text',  hint: 'Click anywhere to type new text.' },
  { id: 'whiteout', label: 'White-out', hint: 'Drag a box to cover content.' },
]

export function EditPanel() {
  const { editMode, setEditMode, tool, setTool, edits, undo, redo, canUndo, canRedo, reset } = useEditStore()
  const { file, updateBytes } = useFileStore()
  const [running, setRunning] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  if (!file) return null

  if (!editMode) {
    return (
      <div className={styles.wrap}>
        <button className={styles.enterBtn} onClick={() => setEditMode(true)}>
          ✎ Edit text
        </button>
      </div>
    )
  }

  const apply = async (download: boolean) => {
    if (edits.length === 0) return
    setRunning(true)
    setError(null)
    try {
      const bytes = await runOp({ op: 'editPage', file: file.bytes, edits })
      updateBytes(bytes)                       // bake into the viewer (undo-tracked)
      if (download) downloadBytes(bytes, file.name.replace(/\.pdf$/i, '') + '-edited.pdf')
      reset()                                  // clear pending edits + exit edit mode
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setRunning(false)
    }
  }

  const activeHint = TOOLS.find(t => t.id === tool)?.hint

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Editing</span>
        <button className={styles.doneBtn} onClick={reset}>Done</button>
      </div>

      <div className={styles.tools}>
        {TOOLS.map(t => (
          <button key={t.id}
            className={`${styles.toolBtn} ${tool === t.id ? styles.toolActive : ''}`}
            onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{activeHint}</p>

      <div className={styles.editRow}>
        <span className={styles.count}>{edits.length} pending edit{edits.length === 1 ? '' : 's'}</span>
        <div className={styles.undoRedo}>
          <button onClick={undo} disabled={!canUndo} aria-label="Undo edit">↩</button>
          <button onClick={redo} disabled={!canRedo} aria-label="Redo edit">↪</button>
        </div>
      </div>

      <button className={styles.applyBtn} disabled={running || edits.length === 0} onClick={() => apply(false)}>
        {running ? 'Applying…' : 'Apply to document'}
      </button>
      <button className={styles.applyGhost} disabled={running || edits.length === 0} onClick={() => apply(true)}>
        Apply &amp; download
      </button>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
