import { useState, useEffect, useCallback } from 'react'
import { useEditStore, type EditTool } from '../../lib/editStore'
import { useFileStore } from '../../lib/fileStore'
import { runOp } from '../../lib/pdfEngine'
import { saveEngineDoc, closeEditSession, engineUndo, engineRedo } from '../../lib/editEngine/editEngine'
import { TopToolbar } from './TopToolbar'
import { BottomEditBar } from './BottomEditBar'
import { LeaveConfirmModal } from './LeaveConfirmModal'

function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a   = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

interface EditPanelProps {
  onOpenConvert?: () => void
}

export function EditPanel({ onOpenConvert }: EditPanelProps) {
  const { editMode, setEditMode, tool, setTool, edits, undo, redo, canUndo, canRedo, reset, engineReady, bumpEngineRevision } = useEditStore()
  const { file, updateBytes, undoSteps, clear: clearFile } = useFileStore()
  const [running, setRunning] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leaveReason, setLeaveReason] = useState<'back' | 'reload'>('back')

  const handleBackRequest = () => {
    setLeaveReason('back')
    setShowLeaveConfirm(true)
  }

  const handleConfirmLeave = async () => {
    try {
      if (engineReady) {
        await closeEditSession().catch(() => {})
      }
    } finally {
      setShowLeaveConfirm(false)
      if (leaveReason === 'reload') {
        window.location.reload()
      } else {
        reset()
        clearFile()
      }
    }
  }

  const handleDownload = () => {
    if (!file) return
    const name = file.name.replace(/\.pdf$/i, '') + '-edited.pdf'
    downloadBytes(file.bytes, name)
  }

  const apply = async () => {
    if (!file) return
    setRunning(true)
    setError(null)
    try {
      let bytes: Uint8Array
      if (engineReady) {
        bytes = await saveEngineDoc()
        await closeEditSession()
      } else {
        if (edits.length === 0) return
        bytes = await runOp({ op: 'editPage', file: file.bytes, edits })
      }
      updateBytes(bytes)
      setApplied(true)
      reset()
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setRunning(false)
    }
  }

  const handleUndo = useCallback(async () => {
    if (engineReady) {
      try { await engineUndo(); bumpEngineRevision() } catch (e) { console.error(e) }
    } else { undo() }
  }, [engineReady, bumpEngineRevision, undo])

  const handleRedo = useCallback(async () => {
    if (engineReady) {
      try { await engineRedo(); bumpEngineRevision() } catch (e) { console.error(e) }
    } else { redo() }
  }, [engineReady, bumpEngineRevision, redo])

  // Global keyboard shortcuts:
  // - Ctrl+Z: Undo
  // - Ctrl+Y or Ctrl+Shift+Z: Redo
  // - F5, Ctrl+R: Prompt with leave confirmation modal
  // - Beforeunload: Browser refresh/close guard
  useEffect(() => {
    if (!file) return

    const onKeyDown = (e: KeyboardEvent) => {
      // Intercept reload keys: F5 or Ctrl+R / Cmd+R
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        setLeaveReason('reload')
        setShowLeaveConfirm(true)
        return
      }

      const activeEl = document.activeElement
      const isTextInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable
      )

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          if (e.shiftKey) {
            // Ctrl+Shift+Z => Redo
            e.preventDefault()
            handleRedo()
          } else {
            // Ctrl+Z => Undo
            if (!isTextInput) {
              e.preventDefault()
              handleUndo()
            }
          }
        } else if (k === 'y') {
          // Ctrl+Y => Redo
          if (!isTextInput) {
            e.preventDefault()
            handleRedo()
          }
        }
      }
    }

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [file, handleUndo, handleRedo])

  if (!file) return null

  const handleEnterEdit = () => {
    if (!editMode) setEditMode(true)
  }

  return (
    <>
      {/* Folio-style top header + toolbar */}
      <TopToolbar
        fileName={file.name}
        tool={tool}
        editMode={editMode}
        engineReady={engineReady}
        canUndo={engineReady ? true : canUndo}
        canRedo={engineReady ? true : canRedo}
        onTool={(t: EditTool) => { setTool(t) }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDownload={handleDownload}
        onEnterEdit={handleEnterEdit}
        onOpenConvert={onOpenConvert}
        onBack={handleBackRequest}
      />

      {/* Confirmation modal before leaving or reloading page */}
      {showLeaveConfirm && (
        <LeaveConfirmModal
          title={leaveReason === 'reload' ? 'Reload document?' : 'Leave document?'}
          message={
            leaveReason === 'reload'
              ? 'Any unsaved changes will be lost if you refresh this page.'
              : 'Any unsaved changes will be lost if you return to the home screen.'
          }
          confirmText={leaveReason === 'reload' ? 'Reload page' : 'Leave document'}
          onConfirm={handleConfirmLeave}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}

      {/* Folio-style bottom bar */}
      {editMode && (
        <BottomEditBar
          editCount={edits.length}
          engineReady={engineReady}
          running={running}
          applied={applied || undoSteps > 0}
          onApply={apply}
          onDownload={handleDownload}
        />
      )}

      {error && (
        <div style={{
          position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)',
          background: '#c0392b', color: '#fff', padding: '8px 16px', borderRadius: 6,
          fontSize: 13, zIndex: 200
        }}>{error}</div>
      )}
    </>
  )
}
