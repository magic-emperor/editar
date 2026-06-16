import { useEffect, useRef, useState } from 'react'
import { useAnnotationStore } from '../../lib/annotationStore'
import type { Annotation, AnnotationRect } from '../../lib/annotationStore'
import styles from './AnnotationLayer.module.css'

interface Props {
  pageIndex: number
  scale:     number
  active:    boolean
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `${hex}${a}`
}

function rectStyle(r: AnnotationRect, kind: Annotation['kind'], color: string): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    left:  r.x,
    top:   r.y,
    width: r.w,
    height: r.h,
    pointerEvents: 'none',
  }
  switch (kind) {
    case 'highlight':
      return { ...base, background: hexWithAlpha(color, 0.35), mixBlendMode: 'multiply' }
    case 'underline':
      return { ...base, background: 'transparent', borderBottom: `2px solid ${color}` }
    case 'strikethrough':
      return { ...base, background: 'transparent', borderTop: `1.5px solid ${color}`, marginTop: `${r.h / 2}px` }
    default:
      return base
  }
}

export function AnnotationLayer({ pageIndex, scale, active }: Props) {
  const { annotations, activeTool, highlightColor, addAnnotation, updateAnnotation, removeAnnotation } =
    useAnnotationStore()
  const layerRef = useRef<HTMLDivElement>(null)
  const [openNote, setOpenNote] = useState<string | null>(null)  // annotation id
  const [noteDraft, setNoteDraft] = useState('')

  const pageAnnotations = annotations.filter(a => a.pageIndex === pageIndex)

  // Capture text selection for highlight / underline / strikethrough
  useEffect(() => {
    if (!active || !activeTool || activeTool === 'note') return
    const onMouseUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const layerEl = layerRef.current
      if (!layerEl) return
      const layerRect = layerEl.getBoundingClientRect()
      const rawRects = [...range.getClientRects()]
      const rects: AnnotationRect[] = rawRects
        .filter(r => r.width > 2 && r.height > 2 &&
          r.top < layerRect.bottom && r.bottom > layerRect.top &&
          r.left < layerRect.right && r.right > layerRect.left)
        .map(r => ({
          x: (r.left - layerRect.left) / scale,
          y: (r.top  - layerRect.top)  / scale,
          w: r.width  / scale,
          h: r.height / scale,
        }))
      sel.removeAllRanges()
      if (rects.length === 0) return
      addAnnotation({ kind: activeTool, pageIndex, rects, color: highlightColor })
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [active, activeTool, highlightColor, pageIndex, addAnnotation, scale])

  // Note tool: click on layer to place note
  function handleLayerClick(e: React.MouseEvent) {
    if (!active || activeTool !== 'note') return
    const layerEl = layerRef.current
    if (!layerEl) return
    const rect = layerEl.getBoundingClientRect()
    const x = (e.clientX - rect.left) / scale
    const y = (e.clientY - rect.top)  / scale
    addAnnotation({
      kind: 'note', pageIndex, rects: [], color: highlightColor,
      anchorPos: { x, y }, note: '',
    })
  }

  function openNoteEditor(id: string, note: string) {
    setOpenNote(id)
    setNoteDraft(note ?? '')
  }
  function saveNote() {
    if (openNote) updateAnnotation(openNote, { note: noteDraft })
    setOpenNote(null)
  }

  return (
    <div
      ref={layerRef}
      className={`${styles.layer} ${active && activeTool ? (activeTool === 'note' ? styles.noteMode : styles.annotating) : ''}`}
      style={{ position: 'absolute', inset: 0 }}
      onClick={handleLayerClick}
    >
      {pageAnnotations.map(ann => {
        if (ann.kind === 'note') {
          const x = (ann.anchorPos?.x ?? 0) * scale
          const y = (ann.anchorPos?.y ?? 0) * scale
          return (
            <div key={ann.id}>
              <div
                className={styles.noteIcon}
                style={{ left: x, top: y, color: ann.color }}
                onClick={ev => { ev.stopPropagation(); openNoteEditor(ann.id, ann.note ?? '') }}
                title={ann.note || 'Click to edit note'}
              >
                📌
              </div>
              {openNote === ann.id && (
                <div
                  className={styles.notePopover}
                  style={{ left: x + 24, top: y }}
                  onClick={e => e.stopPropagation()}
                >
                  <textarea
                    className={styles.noteTextarea}
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    placeholder="Add note…"
                    autoFocus
                  />
                  <div className={styles.noteActions}>
                    <button className={styles.noteBtn} onClick={() => { removeAnnotation(ann.id); setOpenNote(null) }}>
                      Delete
                    </button>
                    <button className={`${styles.noteBtn} ${styles.noteBtnPrimary}`} onClick={saveNote}>
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        }
        return ann.rects.map((r, ri) => (
          <div
            key={`${ann.id}-${ri}`}
            className={styles.annotRect}
            style={rectStyle(
              { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale },
              ann.kind,
              ann.color,
            )}
            title={`${ann.kind} — click to delete`}
            onClick={e => { e.stopPropagation(); if (!activeTool) removeAnnotation(ann.id) }}
          />
        ))
      })}
    </div>
  )
}
