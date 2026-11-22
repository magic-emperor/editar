import { useState, useEffect, useRef } from 'react'
import type { EditTool } from '../../lib/editStore'
import { useEditStore } from '../../lib/editStore'
import { useAnnotationStore } from '../../lib/annotationStore'
import { DesignerCredit } from '../common/DesignerCredit'
import styles from './TopToolbar.module.css'

export interface TopToolbarProps {
  fileName?:      string
  tool:           EditTool
  editMode:       boolean
  engineReady:    boolean
  canUndo:        boolean
  canRedo:        boolean
  onTool:         (t: EditTool) => void
  onUndo:         () => void
  onRedo:         () => void
  onDownload:     () => void
  onEnterEdit:    () => void
  onOpenConvert?: () => void
  onBack?:        () => void
}

export function TopToolbar({
  fileName, tool, editMode, canUndo, canRedo,
  onTool, onUndo, onRedo, onDownload, onEnterEdit,
  onBack,
}: TopToolbarProps) {
  const { activeTool, setActiveTool } = useAnnotationStore()
  const { triggerWave } = useEditStore()
  const [annotateOpen, setAnnotateOpen] = useState(false)
  const [shapesOpen,   setShapesOpen]   = useState(false)
  const [allToolsOpen, setAllToolsOpen] = useState(false)
  const annotateRef = useRef<HTMLDivElement>(null)
  const shapesRef   = useRef<HTMLDivElement>(null)
  const allToolsRef = useRef<HTMLDivElement>(null)

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (annotateRef.current && !annotateRef.current.contains(e.target as Node)) setAnnotateOpen(false)
      if (shapesRef.current   && !shapesRef.current.contains(e.target as Node))   setShapesOpen(false)
      if (allToolsRef.current && !allToolsRef.current.contains(e.target as Node)) setAllToolsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleAnnotateSelect = (toolName: 'highlight' | 'underline' | 'strikethrough' | 'note') => {
    setActiveTool(toolName)
    setAnnotateOpen(false)
    // Exit text-edit mode when annotating
    onTool('select')
  }

  const isAnnotating = !!activeTool

  return (
    <div className={styles.container}>
      {/* ── ROW 1: Brand & File Header ── */}
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          {onBack && (
            <button
              className={styles.backBtn}
              onClick={onBack}
              title="Return to home screen"
              aria-label="Back to home"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              <span>Back</span>
            </button>
          )}

          <div
            className={styles.logoBadge}
            onClick={onBack}
            style={{ cursor: onBack ? 'pointer' : 'default' }}
            title={onBack ? 'Return to home screen' : undefined}
          >
            <img src="/EDITAR.png" alt="EDITAR" className={styles.logoImg} />
            <span className={styles.logoText}>EDITAR</span>
          </div>
          <span className={styles.fileName} title={fileName}>{fileName || 'Document.pdf'}</span>
          <span className={styles.pdfBadge}>PDF</span>
          <span className={styles.savedBadge}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3">
              {/* <polyline points="20 6 9 17 4 12"/> */}
            </svg>
            All changes saved...
          </span>
        </div>

        <DesignerCredit />

        <div className={styles.headerRight}>
          {/* All PDF Tools dropdown */}
          <div className={styles.dropdownWrap} ref={allToolsRef}>
            <button
              className={styles.allToolsBtn}
              onClick={() => setAllToolsOpen(o => !o)}
              title="All PDF tools"
            >
              All PDF tools
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {allToolsOpen && (
              <div className={`${styles.menuDropdown} ${styles.allToolsMenu}`}>
                <div className={styles.menuHeader}>PDF OPERATIONS</div>
                <div className={styles.menuItem}> Merge PDF (coming soon)</div>
                <div className={styles.menuItem}> Split PDF (coming soon)</div>
                <div className={styles.menuItem}> Compress PDF (coming soon)</div>
                <div className={styles.menuItem}> Rotate PDF (coming soon)</div>
                <div className={styles.menuItem}> Extract Pages (coming soon)</div>
                <div className={styles.menuItem}> Watermark (coming soon)</div>
              </div>
            )}
          </div>
          <span className={styles.helpLink}>Help</span>
          <div className={styles.avatar} title="User">FZ</div>
        </div>
      </div>

      {/* ── ROW 2: Tools Toolbar ── */}
      <div className={styles.toolsRow}>
        <div className={styles.cluster}>

          {/* Select cursor — deselects all tools */}
          <button
            className={`${styles.toolBtn} ${!editMode && !isAnnotating ? styles.toolActive : ''}`}
            onClick={() => { onTool('select'); setActiveTool(null) }}
            title="Select / navigate"
            aria-label="Select tool"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3l14 9-7 1-4 7z"/>
            </svg>
          </button>

          <div className={styles.divider}/>

          {/* T Text — edit existing PDF text or click to place free text */}
          <button
            className={`${styles.toolBtn} ${editMode && tool === 'select' && !isAnnotating ? styles.toolActive : ''}`}
            onClick={(e) => { onEnterEdit(); onTool('select'); setActiveTool(null); triggerWave({ x: e.clientX, y: e.clientY }) }}
            title="Text — click any text to edit, or click anywhere to add text"
          >
            <span className={styles.toolIcon}>T</span>
            <span className={styles.toolLabel}>Text</span>
          </button>

          {/* + Add Text */}
          <button
            className={`${styles.toolBtn} ${editMode && tool === 'text' ? styles.toolActive : ''}`}
            onClick={() => { onEnterEdit(); onTool('text'); setActiveTool(null) }}
            title="Add text — click anywhere on the page to insert free text"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span className={styles.toolLabel}>Add text</span>
          </button>

          {/* Whiteout */}
          <button
            className={`${styles.toolBtn} ${editMode && tool === 'whiteout' ? styles.toolActive : ''}`}
            onClick={() => { onEnterEdit(); onTool('whiteout'); setActiveTool(null) }}
            title="Whiteout — drag a rectangle to cover / redact content"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L3 14.67V21h6.33l10.06-10.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <span className={styles.toolLabel}>Whiteout</span>
          </button>

          {/* Annotate ▾ */}
          <div className={styles.dropdownWrap} ref={annotateRef}>
            <button
              className={`${styles.toolBtn} ${isAnnotating ? styles.toolActive : ''}`}
              onClick={() => { setAnnotateOpen(o => !o); setShapesOpen(false) }}
              title="Annotate — highlight, underline, strikethrough, draw"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <span className={styles.toolLabel}>Annotate</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {annotateOpen && (
              <div className={styles.menuDropdown}>
                {(['highlight','underline','strikethrough','note'] as const).map(t => (
                  <button
                    key={t}
                    className={`${styles.menuItem} ${activeTool === t ? styles.menuItemActive : ''}`}
                    onClick={() => handleAnnotateSelect(t)}
                  >
                    {t === 'highlight' ? '🟡 Highlight' :
                     t === 'underline' ? '＿ Underline' :
                     t === 'strikethrough' ? 'S̶ Strikethrough' : '📝 Note'}
                  </button>
                ))}
                {activeTool && (
                  <>
                    <div className={styles.menuDivider}/>
                    <button className={styles.menuItem} onClick={() => { setActiveTool(null); setAnnotateOpen(false) }}>
                      ✕ Clear annotation tool
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Shapes ▾ — only rectangle is functional; others shown as future */}
          <div className={styles.dropdownWrap} ref={shapesRef}>
            <button
              className={`${styles.toolBtn} ${editMode && tool === 'whiteout' && !isAnnotating ? styles.toolActive : ''}`}
              onClick={() => { setShapesOpen(o => !o); setAnnotateOpen(false) }}
              title="Shapes"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
              </svg>
              <span className={styles.toolLabel}>Shapes</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {shapesOpen && (
              <div className={styles.menuDropdown}>
                <button className={styles.menuItem} onClick={() => { onEnterEdit(); onTool('whiteout'); setShapesOpen(false) }}>
                  ▭ Rectangle (Whiteout)
                </button>
                <div className={styles.menuDivider}/>
                {/* <span className={styles.menuHint}>Circle, Line, Arrow — coming soon</span> */}
              </div>
            )}
          </div>

          <div className={styles.divider}/>

          {/* Undo */}
          <button
            className={styles.iconBtn}
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
            </svg>
            <span className={styles.toolLabel}>Undo</span>
          </button>

          {/* Redo */}
          <button
            className={styles.iconBtn}
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ transform: 'scaleX(-1)' }}>
              <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
            </svg>
            <span className={styles.toolLabel}>Redo</span>
          </button>
        </div>

        {/* Right cluster — Download */}
        <div className={styles.cluster}>
          <button className={styles.downloadBtn} onClick={onDownload} title="Download PDF">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
