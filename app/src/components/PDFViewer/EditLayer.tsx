import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditStore } from '../../lib/editStore'
import { loadPageTextLayer, getCachedTextLayer } from '../../lib/textLayer'
import { getEmbeddedFontBytes, preloadPageFonts } from '../../lib/textExtract'
import { classifyFamily } from '../../lib/fontClassify'
import { identifyFont } from '../../lib/intellifont'
import type { EditOp, EditRect, EditStyle, PageTextLayer, RGB, TextItem } from '../../lib/types'
import { EditControls } from './EditControls'
import styles from './EditLayer.module.css'

interface Props {
  docId:     string
  bytes:     Uint8Array
  pageIndex: number
  zoom:      number
  ptToPx:    number
  active:    boolean
}

const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `e${Date.now()}-${Math.random().toString(36).slice(2)}`)

const rgbCss = ([r, g, b]: RGB) => `rgb(${r * 255},${g * 255},${b * 255})`

function styleFromItem(it: TextItem): EditStyle {
  const { family, bold, italic } = classifyFamily(it.fontName)
  return { size: it.h, color: [0, 0, 0], bold, italic, family, fontName: it.fontName }
}
const DEFAULT_STYLE: EditStyle = { size: 12, color: [0, 0, 0], bold: false, italic: false, family: 'sans' }

// Preview FontFaces registered from the document's own font bytes, so the live editor
// preview renders in the real font (WYSIWYG with the exported result). Keyed by fontName.
const previewFonts = new Map<string, string>()
function registerPreviewFont(fontName: string, bytes: Uint8Array): string {
  const existing = previewFonts.get(fontName)
  if (existing) return existing
  const family = `emb_${fontName.replace(/[^a-z0-9_]/gi, '_')}`
  try {
    const ff = new FontFace(family, bytes as unknown as BufferSource)
    document.fonts.add(ff)
    ff.load().catch(() => {})
    previewFonts.set(fontName, family)
    return family
  } catch { return '' }
}

interface Editing {
  kind: 'replace' | 'add'
  bbox: EditRect
  original: string
  value: string
  style: EditStyle
  sourceId?: string
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  return null
}

function wordAt(text: string, off: number): [number, number] | null {
  const isW = (c: string | undefined) => c !== undefined && !/\s/.test(c)
  let s = off, e = off
  while (s > 0 && isW(text[s - 1])) s--
  while (e < text.length && isW(text[e])) e++
  if (s < e) return [s, e]
  let r = off
  while (r < text.length && !isW(text[r])) r++
  if (r < text.length) { let e2 = r; while (e2 < text.length && isW(text[e2])) e2++; return [r, e2] }
  let l = off
  while (l > 0 && !isW(text[l - 1])) l--
  if (l > 0) { let s2 = l; while (s2 > 0 && isW(text[s2 - 1])) s2--; return [s2, l] }
  return null
}

export function EditLayer({ docId, bytes, pageIndex, zoom, ptToPx, active }: Props) {
  const { tool, edits, addEdit, updateEdit, removeEdit } = useEditStore()
  const [layer,   setLayer]   = useState<PageTextLayer | null>(() => getCachedTextLayer(docId, pageIndex) ?? null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [drag,    setDrag]    = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const rootRef   = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const spanRefs  = useRef<(HTMLSpanElement | null)[]>([])
  const placedRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const opening   = useRef(false)
  const moving    = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const resizing  = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null)
  const suppressClick = useRef(false)

  const scale = zoom * ptToPx

  useEffect(() => {
    if (!active || layer) return
    let cancelled = false
    loadPageTextLayer(docId, bytes, pageIndex).then(l => { if (!cancelled) setLayer(l) }).catch(() => {})
    return () => { cancelled = true }
  }, [active, docId, bytes, pageIndex, layer])

  // Warm the page's embedded fonts so word-clicks attach the real font instantly.
  useEffect(() => {
    if (active) preloadPageFonts(docId, bytes, pageIndex)
  }, [active, docId, bytes, pageIndex])

  // Fit hit spans to real width so caret/word geometry lines up.
  useLayoutEffect(() => {
    if (!active || !layer || tool !== 'select') return
    layer.items.forEach((it, i) => {
      const el = spanRefs.current[i]
      if (!el) return
      el.style.transform = ''
      const natural = el.scrollWidth
      const target  = it.w * scale
      if (natural > 0 && target > 0) el.style.transform = `scaleX(${target / natural})`
    })
  }, [active, layer, scale, tool])

  // Shrink placed-preview text to its box width (matches the export's shrink-to-fit; no overlap).
  useLayoutEffect(() => {
    for (const e of edits) {
      if (e.page !== pageIndex || e.kind === 'redact') continue
      const el = placedRefs.current.get(e.id)
      if (!el) continue
      el.style.transform = ''
      const natural = el.scrollWidth
      const target  = e.bbox.w * scale
      if (natural > target && natural > 0) el.style.transform = `scaleX(${target / natural})`
    }
  }, [edits, scale, pageIndex])

  useLayoutEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    requestAnimationFrame(() => { opening.current = false })
  }, [editing])

  // Commit when clicking anywhere outside the editor UI (not via blur — native
  // <select>/color inputs steal focus and would spuriously commit on blur).
  useEffect(() => {
    if (!editing) return
    const onDown = (ev: MouseEvent) => {
      if (opening.current) return
      const t = ev.target as HTMLElement | null
      if (t && t.closest('[data-editui]')) return
      commit()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  if (!active) return null

  const localPoint = (cx: number, cy: number) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: (cx - r.left) / scale, y: (cy - r.top) / scale }
  }
  const currentBbox = (id: string): EditRect => edits.find(e => e.id === id)?.bbox ?? { x: 0, y: 0, w: 0, h: 0 }

  const onSpanClick = async (e: React.MouseEvent, itemIndex: number) => {
    e.stopPropagation()
    const item = layer?.items[itemIndex]
    const span = spanRefs.current[itemIndex]
    const node = span?.firstChild
    if (!item || !span || !node) return
    const caret = caretFromPoint(e.clientX, e.clientY)
    const off = caret && span.contains(caret.node) ? caret.offset : 0
    const w = wordAt(item.str, off)
    if (!w) return
    const [ws, we] = w
    const range = document.createRange()
    range.setStart(node, ws); range.setEnd(node, we)
    const rect = range.getBoundingClientRect()
    const base = rootRef.current!.getBoundingClientRect()
    const bbox: EditRect = {
      x: (rect.left - base.left) / scale,
      y: (rect.top - base.top) / scale,
      w: rect.width / scale,
      h: rect.height / scale,
    }
    const word = item.str.slice(ws, we)
    const style = styleFromItem(item)
    // Reuse the document's own font so the edited word matches exactly.
    const embedded = await getEmbeddedFontBytes(docId, bytes, pageIndex, item.fontName)
    if (embedded && item.fontName) {
      style.embeddedFont = embedded
      registerPreviewFont(item.fontName, embedded)
      // Upgrade font family classification with IntelliFont (decodes garbled font names)
      const match = await identifyFont(item.fontName, embedded)
      if (match) style.family = classifyFamily(match.family).family
    }
    opening.current = true
    setEditing({ kind: 'replace', bbox, original: word, value: word, style })
  }

  const onRootMouseDown = (e: React.MouseEvent) => {
    if (editing || tool !== 'whiteout') return
    const p = localPoint(e.clientX, e.clientY)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onRootClick = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    if (editing || tool !== 'text') return
    const p = localPoint(e.clientX, e.clientY)
    opening.current = true
    setEditing({ kind: 'add', bbox: { x: p.x, y: p.y, w: 240 / scale, h: 16 }, original: '', value: '', style: { ...DEFAULT_STYLE } })
  }
  const onRootMouseMove = (e: React.MouseEvent) => {
    if (resizing.current && editing) {
      const w = resizing.current.ow + (e.clientX - resizing.current.sx) / scale
      const h = resizing.current.oh + (e.clientY - resizing.current.sy) / scale
      setEditing({ ...editing, bbox: { ...editing.bbox, w: Math.max(w, 8), h: Math.max(h, editing.style.size * 0.8) } })
      return
    }
    if (moving.current) {
      const dx = (e.clientX - moving.current.sx) / scale
      const dy = (e.clientY - moving.current.sy) / scale
      if (Math.abs(e.clientX - moving.current.sx) > 3 || Math.abs(e.clientY - moving.current.sy) > 3) moving.current.moved = true
      updateEdit(moving.current.id, { bbox: { ...currentBbox(moving.current.id), x: moving.current.ox + dx, y: moving.current.oy + dy } } as Partial<EditOp>)
      return
    }
    if (drag) {
      const p = localPoint(e.clientX, e.clientY)
      setDrag({ ...drag, x1: p.x, y1: p.y })
    }
  }
  const onRootMouseUp = () => {
    if (resizing.current) { resizing.current = null; return }
    if (moving.current) { suppressClick.current = moving.current.moved; moving.current = null; return }
    if (!drag) return
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1)
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0)
    setDrag(null)
    if (w * scale > 6 && h * scale > 6)
      addEdit({ id: uuid(), kind: 'redact', page: pageIndex, bbox: { x, y, w, h }, fill: [1, 1, 1] })
  }

  const onPlacedMouseDown = (e: React.MouseEvent, ed: EditOp) => {
    if (ed.kind === 'redact') return
    e.stopPropagation()
    moving.current = { id: ed.id, sx: e.clientX, sy: e.clientY, ox: ed.bbox.x, oy: ed.bbox.y, moved: false }
  }
  const onPlacedClick = (e: React.MouseEvent, ed: EditOp) => {
    e.stopPropagation()
    if (suppressClick.current) { suppressClick.current = false; return }
    if (ed.kind === 'redact') return
    opening.current = true
    setEditing({ kind: ed.kind, bbox: { ...ed.bbox }, original: '', value: ed.newText, style: { ...ed.style }, sourceId: ed.id })
  }

  const commit = () => {
    if (!editing) return
    const t = editing.value
    if (editing.sourceId) {
      if (t.trim() === '') removeEdit(editing.sourceId)
      else updateEdit(editing.sourceId, { newText: t, bbox: editing.bbox, style: editing.style } as Partial<EditOp>)
    } else if (editing.kind === 'replace') {
      if (t.trim() !== '' && t !== editing.original)
        addEdit({ id: uuid(), kind: 'replace', page: pageIndex, bbox: editing.bbox, newText: t, style: editing.style, bg: [1, 1, 1] })
    } else if (t.trim() !== '') {
      addEdit({ id: uuid(), kind: 'add', page: pageIndex, bbox: editing.bbox, newText: t, style: editing.style })
    }
    setEditing(null)
  }
  const removeEditing = () => {
    if (editing?.sourceId) removeEdit(editing.sourceId)
    setEditing(null)
  }

  const previewFont = (s: EditStyle) => {
    // Prefer the document's own font (registered as a FontFace) for true WYSIWYG; the
    // embedded face already carries its weight/slant, so don't synthesize bold/italic.
    const emb = s.embeddedFont && s.fontName ? previewFonts.get(s.fontName) : undefined
    return {
      fontFamily: emb || `edit-${s.family}`,
      fontWeight: emb ? 400 : (s.bold ? 700 : 400),
      fontStyle:  emb ? 'normal' : (s.italic ? 'italic' : 'normal'),
      fontSize:   s.size * scale,
      color:      rgbCss(s.color),
      lineHeight: 1,
    } as const
  }
  const px = (r: EditRect) => ({ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale })

  const editorTop = editing ? editing.bbox.y * scale : 0
  // Float the controls clear of the editor box AND its top-right × (remove) button.
  // Clamp left so the ~290px bar never overflows the right edge of the page.
  const pagePixelWidth = (layer?.pageWidth ?? 999) * scale
  const CTRL_WIDTH = 290
  const controlsLeft = editing
    ? Math.min(editing.bbox.x * scale, Math.max(0, pagePixelWidth - CTRL_WIDTH))
    : 0
  const controlsPos = editing
    ? (editorTop > 46
        ? { left: controlsLeft, top: editorTop - 44 }
        : { left: controlsLeft, top: editorTop + editing.bbox.h * scale + 16})
    : {}

  return (
    <div
      ref={rootRef}
      className={`${styles.layer} ${styles[tool]}`}
      onMouseDown={onRootMouseDown}
      onClick={onRootClick}
      onMouseMove={onRootMouseMove}
      onMouseUp={onRootMouseUp}
      onMouseLeave={() => { if (moving.current || drag || resizing.current) onRootMouseUp() }}
    >
      {edits.filter(e => e.page === pageIndex && e.id !== editing?.sourceId).map(e => {
        if (e.kind === 'redact')
          return <div key={e.id} className={styles.redact} style={{ ...px(e.bbox), background: rgbCss(e.fill) }} />
        const isReplace = e.kind === 'replace'
        return (
          <div key={e.id} className={styles.placed}
            style={{ ...px(e.bbox), background: isReplace ? rgbCss((e as Extract<EditOp, { kind: 'replace' }>).bg) : 'transparent' }}
            onMouseDown={ev => onPlacedMouseDown(ev, e)}
            onClick={ev => onPlacedClick(ev, e)}
            title="Drag to move · click to edit">
            <span ref={el => { if (el) placedRefs.current.set(e.id, el); else placedRefs.current.delete(e.id) }}
              style={previewFont(e.style)}>{e.newText}</span>
          </div>
        )
      })}

      {tool === 'select' && layer?.items.map((it, i) => (
        <span key={i} data-item={i}
          ref={el => { spanRefs.current[i] = el }}
          className={styles.hitSpan}
          style={{ left: it.x * scale, top: it.y * scale, height: it.h * scale, fontSize: it.h * scale }}
          onClick={ev => onSpanClick(ev, i)}
        >{it.str}</span>
      ))}

      {drag && (
        <div className={styles.dragBox} style={{
          left:  Math.min(drag.x0, drag.x1) * scale,
          top:   Math.min(drag.y0, drag.y1) * scale,
          width:  Math.abs(drag.x1 - drag.x0) * scale,
          height: Math.abs(drag.y1 - drag.y0) * scale,
        }} />
      )}

      {editing && (
        <>
          <EditControls
            style={editing.style}
            onChange={patch => setEditing({ ...editing, style: { ...editing.style, ...patch } })}
            position={controlsPos}
          />
          <div className={styles.editBox} data-editui
            style={{
              left: editing.bbox.x * scale,
              top:  editing.bbox.y * scale,
              width:  Math.max(editing.bbox.w * scale, 40),
              height: Math.max(editing.bbox.h * scale, editing.style.size * scale * 1.3),
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <textarea
              ref={inputRef}
              className={styles.input}
              value={editing.value}
              spellCheck={false}
              onChange={e => setEditing({ ...editing, value: e.target.value })}
              onKeyDown={e => {
                const mod = e.ctrlKey || e.metaKey
                if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setEditing({ ...editing, style: { ...editing.style, bold: !editing.style.bold } }) }
                else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); setEditing({ ...editing, style: { ...editing.style, italic: !editing.style.italic } }) }
                else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
                else if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
              }}
              style={previewFont(editing.style)}
            />
            <button className={styles.removeBtn} title="Remove" onClick={removeEditing}>×</button>
            <div className={styles.resizeHandle} title="Resize"
              onMouseDown={e => {
                e.stopPropagation()
                resizing.current = { sx: e.clientX, sy: e.clientY, ow: editing.bbox.w, oh: editing.bbox.h }
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
