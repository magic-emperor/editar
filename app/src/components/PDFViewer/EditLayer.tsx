import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import fontkit from '@pdf-lib/fontkit'
import { useEditStore } from '../../lib/editStore'
import { loadPageTextLayer, getCachedTextLayer } from '../../lib/textLayer'
import { getEmbeddedFontBytes, preloadPageFonts } from '../../lib/textExtract'
import { textColorAt } from '../../lib/pdfEngine'
import { classifyFamily } from '../../lib/fontClassify'
import { initEditSession, getPageModel, commitLineEdit, commitRunV2Edit, redactArea } from '../../lib/editEngine/editEngine'
import type { PageModel, EditLine } from '../../lib/editEngine/types'
// DISABLED (true-edit A6): IntelliFont's visual matcher (identify_from_buffer) returns
// wrong families for every Latin font tested — see phase0/PHASE0_REPORT.md §5
// ("Architecture constraint #2"). classifyFamily from the embedded font's own name table
// (below) is the documented workaround and needs no visual matching or wasm call.
// import { identifyFont } from '../../lib/intellifont'
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

// ─── Real text/background colour sampling (true-edit A5) ──────────────────────
//
// Replaces the hard-coded black text / white cover box with colours read from the
// already-rendered page canvas (post-A1, so the bytes are correct RGBA).

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const luminance = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255

// Accumulates per-channel samples and reduces them to a median RGB (0..1).
class ColorAccumulator {
  private readonly r: number[] = []; private readonly g: number[] = []; private readonly b: number[] = []
  add(r: number, g: number, b: number): void { this.r.push(r); this.g.push(g); this.b.push(b) }
  get count(): number { return this.r.length }
  medianRgb255(): [number, number, number] { return [median(this.r), median(this.g), median(this.b)] }
  medianRgb01(): RGB { const [r, g, b] = this.medianRgb255(); return [r / 255, g / 255, b / 255] }
}

type PixelAt = (gx: number, gy: number) => [number, number, number]

/**
 * Sample a word's real text colour and background colour from the rendered page canvas.
 * bg = median colour of a 1px ring just outside `box`; text colour = median of the
 * pixels inside `box` whose luminance differs from bg's by more than 40%. `box` is in
 * PDF points, top-left origin (same space as TextItem/EditRect).
 */
function sampleColors(
  canvas: HTMLCanvasElement, pageWidth: number, pageHeight: number, box: EditRect,
): { bg: RGB; color: RGB } | null {
  if (pageWidth <= 0 || pageHeight <= 0 || canvas.width <= 0 || canvas.height <= 0) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const sx = canvas.width  / pageWidth
  const sy = canvas.height / pageHeight
  const clampX = (v: number) => Math.max(0, Math.min(canvas.width  - 1, Math.round(v)))
  const clampY = (v: number) => Math.max(0, Math.min(canvas.height - 1, Math.round(v)))
  const left   = clampX(box.x * sx)
  const top    = clampY(box.y * sy)
  const right  = clampX((box.x + box.w) * sx)
  const bottom = clampY((box.y + box.h) * sy)
  // One extra pixel on each side so the "ring just outside the box" is in the same read.
  const rLeft = clampX(left - 1), rTop = clampY(top - 1)
  const rRight = clampX(right + 1), rBottom = clampY(bottom + 1)
  const rw = Math.max(1, rRight - rLeft + 1), rh = Math.max(1, rBottom - rTop + 1)

  let data: Uint8ClampedArray
  try { data = ctx.getImageData(rLeft, rTop, rw, rh).data } catch { return null }
  const at: PixelAt = (gx, gy) => {
    const i = ((gy - rTop) * rw + (gx - rLeft)) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }

  const ring = new ColorAccumulator()
  for (let gx = rLeft; gx <= rRight; gx++) { ring.add(...at(gx, rTop)); ring.add(...at(gx, rBottom)) }
  for (let gy = rTop + 1; gy < rBottom; gy++) { ring.add(...at(rLeft, gy)); ring.add(...at(rRight, gy)) }
  const [bgR, bgG, bgB] = ring.medianRgb255()
  const bg = ring.medianRgb01()
  const bgLum = luminance(bgR, bgG, bgB)

  // Anti-aliased edge pixels drag a plain median toward the background (black text read
  // as ~#383838), so keep only the strongest-contrast quarter of the ink pixels.
  const inkPx: { r: number; g: number; b: number; d: number }[] = []
  for (let gy = top; gy <= bottom; gy++) {
    for (let gx = left; gx <= right; gx++) {
      const [r, g, b] = at(gx, gy)
      const d = Math.abs(luminance(r, g, b) - bgLum)
      if (d > 0.4) inkPx.push({ r, g, b, d })
    }
  }
  inkPx.sort((a, b) => b.d - a.d)
  const ink = new ColorAccumulator()
  for (const q of inkPx.slice(0, Math.max(1, Math.ceil(inkPx.length * 0.25)))) ink.add(q.r, q.g, q.b)
  // No contrasting ink found in the box — fall back to black rather than guess.
  const color: RGB = ink.count > 0 ? ink.medianRgb01() : [0, 0, 0]

  return { bg, color }
}

// Real family name from the embedded font's own OpenType name table (true-edit A6),
// used instead of IntelliFont's visual matcher — see the DISABLED import note above.
// pdf.js font refs are sometimes garbled (e.g. "g_d0_f1"); the font's own binary always
// carries its real name (postscriptName / familyName), which classifyFamily can read
// just as well as a clean name. Cached per fontName (parsing is not free).
const nameTableCache = new Map<string, string | null>()
function realFontName(fontName: string, bytes: Uint8Array): string | null {
  if (nameTableCache.has(fontName)) return nameTableCache.get(fontName)!
  let name: string | null = null
  try {
    const font = fontkit.create(bytes)
    name = font.postscriptName || font.familyName || null
  } catch { /* not a font fontkit can parse — fall through to null */ }
  nameTableCache.set(fontName, name)
  return name
}

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
  initialBbox?: EditRect
  original: string
  value: string
  style: EditStyle
  initialStyle: EditStyle
  sourceId?: string
  baselineY?: number  // true-edit A3: real baseline from the source TextItem, top-origin points
  bg?: RGB  // true-edit A5: sampled background colour (replace only); undefined for 'add'
  initialCaret?: [number, number] // [startOffset, endOffset]
  engineLineId?: string
  engineRunObjIndex?: number  // object index of the specific run being edited (for commitRun)
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

// wordAt was previously used for single-word selection, replaced by full run selection (Sejda-style)
// function wordAt(text: string, off: number): [number, number] | null { ... }

export function EditLayer({ docId, bytes, pageIndex, zoom, ptToPx, active }: Props) {
  const { tool, edits, addEdit, updateEdit, removeEdit, engineReady, setEngineReady, bumpEngineRevision, setEditingEngineLineId, waveTrigger, waveOrigin, triggerWave } = useEditStore()
  const [layer,   setLayer]   = useState<PageTextLayer | null>(() => getCachedTextLayer(docId, pageIndex) ?? null)
  const [pageModel, setPageModel] = useState<PageModel | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [drag,    setDrag]    = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // Layer 1D: Hide the textarea until PDFium re-renders with the text hidden,
  // so the user never sees both original text and textarea simultaneously.
  const [renderReady, setRenderReady] = useState(true)

  const rootRef   = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const spanRefs  = useRef<(HTMLSpanElement | null)[]>([])
  const lineRefs  = useRef<(HTMLSpanElement | null)[]>([])
  const placedRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const opening   = useRef(false)
  const moving    = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; ob?: number; moved: boolean } | null>(null)
  const resizing  = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null)
  const movingEditor = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const suppressClick = useRef(false)
  // Wave animation — track previous tool to detect entering edit mode
  const prevTool = useRef<string>('')

  const scale = zoom * ptToPx

  // Broadcast the active engine line ID to the store so PageCanvas can hide the
  // original text objects while editing — the transparent textarea sits in their
  // place, making it look like direct PDF editing (Sejda approach).
  // Also bump revision so PageCanvas re-renders with the hide applied.
  useEffect(() => {
    const lineId = editing?.engineLineId ?? null
    setEditingEngineLineId(lineId)
    if (engineReady) bumpEngineRevision()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.engineLineId, engineReady])

  // Layer 1D: When an engine edit starts, delay showing the textarea until
  // PDFium has had time to re-render with the text hidden (render mode 3).
  // For non-engine edits, show immediately.
  useEffect(() => {
    if (!editing?.engineLineId) { setRenderReady(true); return }
    setRenderReady(false)
    const timer = setTimeout(() => setRenderReady(true), 80)
    return () => clearTimeout(timer)
  }, [editing?.engineLineId])

  // Initialize engine session when EditLayer mounts
  useEffect(() => {
    if (!active) return
    initEditSession(bytes)
      .then(() => {
        setEngineReady(true)
        return getPageModel(pageIndex)
      })
      .then(m => setPageModel(m))
      .catch(err => {
        console.warn('PDFium engine session init fallback:', err)
        setEngineReady(false)
      })
  }, [active, bytes, pageIndex, setEngineReady])

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

  // Wave animation — ripples outward from click origin (or top-to-bottom on load)
  useEffect(() => {
    if (!active || !rootRef.current) return
    const spans = Array.from(rootRef.current.querySelectorAll<HTMLSpanElement>(`.${styles.hitSpan}`))
    if (spans.length === 0) return

    const clickPt = waveOrigin
    spans.forEach((el) => {
      let delay = 0
      if (clickPt) {
        const rect = el.getBoundingClientRect()
        const spanX = rect.left + rect.width / 2
        const spanY = rect.top + rect.height / 2
        const dist = Math.hypot(spanX - clickPt.x, spanY - clickPt.y)
        delay = Math.round(dist * 0.4)
      } else {
        delay = Math.round(el.offsetTop * 0.3)
      }
      el.style.animationDelay = `${delay}ms`
      el.classList.remove(styles.waveIn)
      void el.offsetWidth
      el.classList.add(styles.waveIn)
      setTimeout(() => {
        el.classList.remove(styles.waveIn)
        el.style.animationDelay = ''
      }, 500 + delay)
    })
    prevTool.current = tool
  }, [waveTrigger, tool, pageModel, active, waveOrigin])

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

  // Render placed edits at the exact configured font size (WYSIWYG with export)
  useLayoutEffect(() => {
    for (const e of edits) {
      if (e.page !== pageIndex || e.kind === 'redact') continue
      const el = placedRefs.current.get(e.id)
      if (!el) continue
      const fullSizePx = e.style.size * scale
      el.style.fontSize = `${fullSizePx}px`
    }
  }, [edits, scale, pageIndex])

  // Track whether we've applied the initial caret position for the current editor session.
  // Reset to false whenever a new editing session opens (i.e. when editing?.original changes).
  const caretApplied = useRef(false)
  useLayoutEffect(() => {
    if (!editing) { caretApplied.current = false; return }
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Only set the caret once when the editor first opens — not on every value change.
    // Re-setting it on every keystroke causes the cursor to jump to position 0,
    // making text type in reverse order ("naziaf" instead of "faizan").
    if (!caretApplied.current) {
      caretApplied.current = true
      const [start, end] = editing.initialCaret ?? [el.value.length, el.value.length]
      el.setSelectionRange(start, end)
    }
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
      suppressClick.current = true
      commit()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // Smooth drag handling for active editor box (even when textarea is focused).
  // Must be above the early return so hooks are always called in the same order.
  useEffect(() => {
    const onWindowMove = (e: MouseEvent) => {
      if (movingEditor.current && editing) {
        const dx = (e.clientX - movingEditor.current.sx) / scale
        const dy = (e.clientY - movingEditor.current.sy) / scale
        setEditing(prev => prev ? {
          ...prev,
          bbox: { ...prev.bbox, x: movingEditor.current!.ox + dx, y: movingEditor.current!.oy + dy },
          baselineY: prev.baselineY !== undefined ? prev.baselineY + dy : undefined,
        } : null)
      }
    }
    const onWindowUp = () => {
      if (movingEditor.current) {
        movingEditor.current = null
      }
    }
    window.addEventListener('mousemove', onWindowMove)
    window.addEventListener('mouseup', onWindowUp)
    return () => {
      window.removeEventListener('mousemove', onWindowMove)
      window.removeEventListener('mouseup', onWindowUp)
    }
  }, [editing, scale])

  if (!active) return null

  const localPoint = (cx: number, cy: number) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: (cx - r.left) / scale, y: (cy - r.top) / scale }
  }

  const onDragHandleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!editing) return
    movingEditor.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: editing.bbox.x,
      oy: editing.bbox.y,
    }
  }

  const currentBbox = (id: string): EditRect => edits.find(e => e.id === id)?.bbox ?? { x: 0, y: 0, w: 0, h: 0 }

  const onSpanClick = async (e: React.MouseEvent, itemIndex: number) => {
    e.stopPropagation()
    // Engine is active — clicks are handled by onLineClick via the engine hit spans instead
    if (engineReady) return
    // If we just committed (clicked outside the editor onto a span), skip reopening
    if (suppressClick.current) { suppressClick.current = false; return }
    const item = layer?.items[itemIndex]
    const span = spanRefs.current[itemIndex]
    if (!item || !span) return

    // Note: if there was an open editor, the document mousedown handler
    // already called commit() and set suppressClick=true (we returned above).
    // No need to call commit() again here — it would be a no-op at best.

    const caret = caretFromPoint(e.clientX, e.clientY)
    const off = caret && span.contains(caret.node) ? caret.offset : 0

    // Check if user selected text via drag
    let selStart = off
    let selEnd = off
    const winSel = window.getSelection()
    if (winSel && !winSel.isCollapsed && span.contains(winSel.anchorNode)) {
      const s1 = winSel.anchorOffset
      const s2 = winSel.focusOffset
      selStart = Math.min(s1, s2)
      selEnd = Math.max(s1, s2)
    }

    const textToEdit = item.str
    const style = styleFromItem(item)

    // In-place text editing matching the exact canvas position
    // item.h is one glyph-height from pdf.js, but a text item can span multiple
    // visual lines (pdf.js concatenates the full text run). Estimate real height by
    // wrapping the text at the item width and counting soft-wrap lines.
    const lineCount = Math.max(1, (item.str.match(/\n/g) || []).length + 1)
    // Also estimate soft-wrap lines: average char width ≈ 0.55 × fontSize
    const avgCharW = style.size * 0.55
    const charsPerLine = avgCharW > 0 ? Math.max(1, Math.floor(item.w / avgCharW)) : 999
    const softLines = Math.ceil(item.str.length / charsPerLine)
    const totalLines = Math.max(lineCount, softLines)
    const bbox: EditRect = {
      x: item.x,
      y: item.y,
      w: Math.max(item.w, 40),
      h: Math.max(item.h * totalLines, style.size * 1.4),
    }

    // Reuse the document's own font so the edited text matches exactly.
    const embedded = await getEmbeddedFontBytes(docId, bytes, pageIndex, item.fontName)
    if (embedded && item.fontName) {
      style.embeddedFont = embedded
      registerPreviewFont(item.fontName, embedded)
      const realName = realFontName(item.fontName, embedded)
      if (realName) style.family = classifyFamily(realName).family
    }

    // Real text/background colour (true-edit A5)
    const canvas = rootRef.current!.parentElement?.querySelector('canvas') ?? null
    const sampled = canvas && layer ? sampleColors(canvas, layer.pageWidth, layer.pageHeight, bbox) : null
    let bg: RGB = [1, 1, 1]
    if (sampled) { style.color = sampled.color; bg = sampled.bg }
    if (item.source === 'native' && layer) {
      const exact = await textColorAt(docId, pageIndex, bbox.x + bbox.w / 2, layer.pageHeight - (item.baseline - style.size * 0.3)).catch(() => null)
      if (exact) style.color = exact
    }

    opening.current = true
    setEditing({
      kind: 'replace',
      bbox,
      original: textToEdit,
      value: textToEdit,
      style: { ...style },
      initialStyle: { ...style },
      baselineY: item.baseline,
      bg,
      initialCaret: [selStart, selEnd],
    })
  }

  const onRootMouseDown = (e: React.MouseEvent) => {
    if (editing || tool !== 'whiteout') return
    const p = localPoint(e.clientX, e.clientY)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onRootClick = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    if (editing) {
      commit()
      return
    }
    if (tool !== 'text' && tool !== 'select') return
    const p = localPoint(e.clientX, e.clientY)
    opening.current = true
    const initStyle = { ...DEFAULT_STYLE }
    setEditing({
      kind: 'add',
      bbox: { x: p.x, y: p.y, w: 200 / scale, h: 22 },
      original: '',
      value: '',
      style: initStyle,
      initialStyle: initStyle,
      initialCaret: [0, 0],
    })
  }
  const onRootMouseMove = (e: React.MouseEvent) => {
    if (movingEditor.current && editing) {
      const dx = (e.clientX - movingEditor.current.sx) / scale
      const dy = (e.clientY - movingEditor.current.sy) / scale
      setEditing({
        ...editing,
        bbox: { ...editing.bbox, x: movingEditor.current.ox + dx, y: movingEditor.current.oy + dy }
      })
      return
    }
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
      const ob = moving.current.ob
      updateEdit(moving.current.id, { bbox: { ...currentBbox(moving.current.id), x: moving.current.ox + dx, y: moving.current.oy + dy }, baselineY: ob !== undefined ? ob + dy : undefined } as Partial<EditOp>)
      return
    }
    if (drag) {
      const p = localPoint(e.clientX, e.clientY)
      setDrag({ ...drag, x1: p.x, y1: p.y })
    }
  }
  const onRootMouseUp = async () => {
    if (movingEditor.current) { movingEditor.current = null; return }
    if (resizing.current) { resizing.current = null; return }
    if (moving.current) { suppressClick.current = moving.current.moved; moving.current = null; return }
    if (!drag) return
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1)
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0)
    setDrag(null)
    if (w * scale > 6 && h * scale > 6) {
      if (engineReady) {
        try {
          const res = await redactArea(pageIndex, { left: x, top: y, right: x + w, bottom: y + h })
          setPageModel(res.model)
          bumpEngineRevision()
        } catch (err) {
          console.error('Redact failed:', err)
        }
      } else {
        addEdit({ id: uuid(), kind: 'redact', page: pageIndex, bbox: { x, y, w, h }, fill: [1, 1, 1] })
      }
    }
  }

  const onPlacedMouseDown = (e: React.MouseEvent, ed: EditOp) => {
    if (ed.kind === 'redact') return
    e.stopPropagation()
    moving.current = { id: ed.id, sx: e.clientX, sy: e.clientY, ox: ed.bbox.x, oy: ed.bbox.y, ob: ed.baselineY, moved: false }
  }
  const onPlacedClick = (e: React.MouseEvent, ed: EditOp) => {
    e.stopPropagation()
    if (suppressClick.current) { suppressClick.current = false; return }
    if (ed.kind === 'redact') return
    const caret = caretFromPoint(e.clientX, e.clientY)
    const off = caret ? Math.max(0, Math.min(ed.newText.length, caret.offset)) : ed.newText.length
    opening.current = true
    setEditing({
      kind: ed.kind,
      bbox: { ...ed.bbox },
      original: '',
      value: ed.newText,
      style: { ...ed.style },
      initialStyle: { ...ed.style },
      sourceId: ed.id,
      baselineY: ed.baselineY,
      bg: ed.kind === 'replace' ? ed.bg : undefined,
      initialCaret: [off, off],
    })
  }

  const handleStyleChange = (patch: Partial<EditStyle>) => {
    if (!editing) return
    const newStyle = { ...editing.style, ...patch }
    let newBbox = { ...editing.bbox }

    // If font size changed, scale width & height so the new size fits
    if (patch.size && patch.size !== editing.style.size && editing.style.size > 0) {
      const ratio = patch.size / editing.style.size
      newBbox = {
        ...newBbox,
        w: Math.max(newBbox.w * ratio, 40),
        h: Math.max(newBbox.h * ratio, patch.size * 1.2),
        y: editing.baselineY !== undefined ? editing.baselineY - patch.size * 0.95 : newBbox.y,
      }
    }

    setEditing({ ...editing, style: newStyle, bbox: newBbox })
  }

  const onLineClick = async (e: React.MouseEvent, line: EditLine, lineIdx: number) => {
    e.stopPropagation()
    if (suppressClick.current) { suppressClick.current = false; return }
    if (!line.editable) return

    // Trigger wave outward from this click location
    triggerWave({ x: e.clientX, y: e.clientY })

    const caret = caretFromPoint(e.clientX, e.clientY)
    const span  = lineRefs.current[lineIdx] ?? null
    const off   = caret && span && span.contains(caret.node) ? caret.offset : line.text.length

    // Target the specific run that was clicked (so formatting like italic applies to that unit without corrupting others)
    const pt = localPoint(e.clientX, e.clientY)
    const clickedRun = (line.runs && line.runs.length > 0)
      ? (line.runs.find(r => pt.x >= r.left - 2 && pt.x <= r.right + 2) || line.runs[0])
      : null

    const targetRun = clickedRun || {
      index: 0,
      text: line.text,
      left: line.left,
      top: line.top,
      right: line.right,
      bottom: line.bottom,
      baseline: line.baseline,
      fontSize: line.fontSize,
      color: [0, 0, 0, 255] as [number, number, number, number],
      fontName: '',
      isEmbedded: false,
      editable: true,
    }

    const fontName = targetRun.fontName || ''
    const classification = classifyFamily(fontName)
    const style: EditStyle = {
      size:      targetRun.fontSize || line.fontSize,
      color:     [targetRun.color[0] / 255, targetRun.color[1] / 255, targetRun.color[2] / 255],
      bold:      classification.bold,
      italic:    classification.italic,
      family:    classification.family,
      fontName:  fontName,
    }

    // Layer 1C: Load the PDF's own embedded font so the textarea renders
    // in the EXACT same font as the PDF text — true WYSIWYG editing.
    const embedded = await getEmbeddedFontBytes(docId, bytes, pageIndex, fontName)
    if (embedded && fontName) {
      style.embeddedFont = embedded
      registerPreviewFont(fontName, embedded)
      const realName = realFontName(fontName, embedded)
      if (realName) {
        const classified = classifyFamily(realName)
        style.family = classified.family
      }
    }

    const isMultiRun = line.runs.length > 1 && clickedRun
    const textToEdit = isMultiRun ? targetRun.text : line.text
    const bbox: EditRect = isMultiRun
      ? {
          x: targetRun.left,
          y: targetRun.top,
          w: Math.max(targetRun.right - targetRun.left + 4, 30),
          h: Math.max(targetRun.bottom - targetRun.top + 2, targetRun.fontSize * 1.2),
        }
      : {
          x: line.left,
          y: line.top,
          w: Math.max(line.right - line.left + 8, 40),
          h: Math.max(line.bottom - line.top + 4, line.fontSize * 1.2),
        }

    opening.current = true
    setEditing({
      kind:               'replace',
      bbox,
      initialBbox:        { ...bbox },
      original:           textToEdit,
      value:              textToEdit,
      style,
      initialStyle:       style,
      baselineY:          targetRun.baseline,
      bg:                 [1, 1, 1],
      initialCaret:       [Math.min(off, textToEdit.length), Math.min(off, textToEdit.length)],
      engineLineId:       line.id,
      engineRunObjIndex:  targetRun.index,
    })
  }

  const commit = async () => {
    if (!editing) return
    const t = editing.value

    const styleChanged = !editing.initialStyle ||
      editing.style.size !== editing.initialStyle.size ||
      editing.style.bold !== editing.initialStyle.bold ||
      editing.style.italic !== editing.initialStyle.italic ||
      editing.style.family !== editing.initialStyle.family ||
      editing.style.color[0] !== editing.initialStyle.color[0] ||
      editing.style.color[1] !== editing.initialStyle.color[1] ||
      editing.style.color[2] !== editing.initialStyle.color[2]

    if (engineReady && editing.engineLineId) {
      const posChanged = Boolean(
        editing.initialBbox && (
          Math.abs(editing.bbox.x - editing.initialBbox.x) > 1 ||
          Math.abs(editing.bbox.y - editing.initialBbox.y) > 1
        )
      )
      const newPos = posChanged ? { x: editing.bbox.x, y: editing.bbox.y } : undefined
      const initialPos = posChanged && editing.initialBbox ? { x: editing.initialBbox.x, y: editing.initialBbox.y } : undefined

      if (t !== editing.original || styleChanged || posChanged) {
        try {
          let res: { model: PageModel }
          if (editing.engineRunObjIndex !== undefined) {
            // V2: Remove original text object + create fresh one with new text, styles, and position.
            res = await commitRunV2Edit(
              pageIndex,
              editing.engineRunObjIndex,
              t,
              editing.style,
              newPos,
              initialPos
            )
          } else {
            // Fallback: line-level commit (single-run lines or legacy path)
            res = await commitLineEdit(pageIndex, editing.engineLineId, t)
          }
          setPageModel(res.model)
          bumpEngineRevision()
        } catch (err) {
          console.error('Engine commit failed:', err)
        }
      }
      setEditing(null)
      return
    }

    if (editing.sourceId) {
      if (t.trim() === '') removeEdit(editing.sourceId)
      else updateEdit(editing.sourceId, { newText: t, bbox: editing.bbox, style: editing.style, baselineY: editing.baselineY, bg: editing.bg } as Partial<EditOp>)
    } else if (editing.kind === 'replace') {
      if (t.trim() !== '' && (t !== editing.original || styleChanged))
        addEdit({ id: uuid(), kind: 'replace', page: pageIndex, bbox: editing.bbox, newText: t, style: editing.style, bg: editing.bg ?? [1, 1, 1], baselineY: editing.baselineY })
    } else if (t.trim() !== '') {
      addEdit({ id: uuid(), kind: 'add', page: pageIndex, bbox: editing.bbox, newText: t, style: editing.style, baselineY: editing.baselineY })
    }
    setEditing(null)
  }

  const deleteCurrentText = async () => {
    if (!editing) return
    if (editing.engineLineId) {
      try {
        const res = await redactArea(pageIndex, {
          left: editing.bbox.x,
          top: editing.bbox.y,
          right: editing.bbox.x + editing.bbox.w,
          bottom: editing.bbox.y + editing.bbox.h,
        })
        setPageModel(res.model)
        bumpEngineRevision()
      } catch (err) {
        console.error('Delete engine text failed:', err)
      }
    } else if (editing.sourceId) {
      removeEdit(editing.sourceId)
    }
    setEditing(null)
  }

  const previewFont = (s: EditStyle) => {
    // If user changed bold/italic or family from initial style, use fallback standard font
    // so toggling Bold or Italic renders immediately in the textarea!
    const styleModified = Boolean(
      editing?.initialStyle && (
        s.bold !== editing.initialStyle.bold ||
        s.italic !== editing.initialStyle.italic ||
        s.family !== editing.initialStyle.family
      )
    )
    const emb = !styleModified && s.embeddedFont && s.fontName ? previewFonts.get(s.fontName) : undefined
    return {
      fontFamily: emb || `edit-${s.family}, sans-serif`,
      fontWeight: s.bold ? 700 : 400,
      fontStyle:  s.italic ? 'italic' : 'normal',
      fontSize:   s.size * scale,
      color:      rgbCss(s.color),
      lineHeight: 1,
    } as const
  }
  const px = (r: EditRect) => ({ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale })

  // Folio-style: float toolbar ABOVE the text run (8px gap), flip below if too close to top
  const editorTop = editing ? editing.bbox.y * scale : 0
  const TOOLBAR_H = 44  // height of floating bar + gap
  const pagePixelWidth = (layer?.pageWidth ?? 999) * scale
  const CTRL_WIDTH = 320
  const controlsLeft = editing
    ? Math.min(editing.bbox.x * scale, Math.max(0, pagePixelWidth - CTRL_WIDTH))
    : 0
  const controlsPos = editing
    ? (editorTop > TOOLBAR_H
        ? { left: controlsLeft, top: editorTop - TOOLBAR_H }
        : { left: controlsLeft, top: editorTop + editing.bbox.h * scale + 8 })
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
      {/* Placed edits (free text, whiteouts, overlays) — always rendered so placed text is visible */}
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

      {/* When engine is ready: hit-test lines directly from the PDFium PageModel */}
      {(tool === 'select' || tool === 'text') && engineReady && pageModel?.lines.map((line, i) => (
        <span key={line.id} data-line={line.id}
          ref={el => { lineRefs.current[i] = el }}
          className={`${styles.hitSpan}${editing?.engineLineId === line.id ? ` ${styles.active}` : ''}`}
          style={{
            left: line.left * scale,
            top: line.top * scale,
            width: (line.right - line.left) * scale,
            height: (line.bottom - line.top) * scale,
            fontSize: line.fontSize * scale,
          }}
          onClick={ev => onLineClick(ev, line, i)}
        >{line.text}</span>
      ))}

      {/* Fallback to pdf.js text layer if engine is not ready */}
      {(tool === 'select' || tool === 'text') && !engineReady && layer?.items.map((it, i) => (
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
            onChange={handleStyleChange}
            position={controlsPos}
            onDelete={deleteCurrentText}
          />
          <div className={`${styles.editBox}${editing.engineLineId ? ` ${styles.editBoxEngine}` : ''}`} data-editui
            style={{
              left: editing.bbox.x * scale,
              top:  editing.bbox.y * scale,
              width:  Math.max(editing.bbox.w * scale, 40),
              height: Math.max(editing.bbox.h * scale, editing.style.size * scale * 1.3),
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle — works for all edits */}
            <div
              className={styles.dragHandle}
              data-editui
              onMouseDown={onDragHandleMouseDown}
              title="Drag to move"
            >⠿</div>
            <textarea
              ref={inputRef}
              data-editui
              className={`${styles.input}${editing.engineLineId ? ` ${styles.engineInput}` : ''}`}
              value={editing.value}
              spellCheck={false}
              onChange={e => setEditing({ ...editing, value: e.target.value })}
              onBlur={() => commit()}
              onKeyDown={e => {
                const mod = e.ctrlKey || e.metaKey
                if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setEditing({ ...editing, style: { ...editing.style, bold: !editing.style.bold } }) }
                else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); setEditing({ ...editing, style: { ...editing.style, italic: !editing.style.italic } }) }
                else if (e.key === 'Enter') { e.preventDefault(); commit() }
                else if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                else if (e.key === 'Delete') { e.preventDefault(); deleteCurrentText() }
                else if (e.key === 'Backspace' && (editing.value === '' || (inputRef.current && inputRef.current.selectionStart === 0 && inputRef.current.selectionEnd === editing.value.length))) { e.preventDefault(); deleteCurrentText() }
              }}
              style={{
                ...previewFont(editing.style),
                // Layer 1D: hide until PDFium re-renders with text hidden
                opacity: renderReady ? 1 : 0,
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
