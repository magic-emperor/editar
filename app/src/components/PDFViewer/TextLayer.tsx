import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  loadPageTextLayer,
  getCachedTextLayer,
  type TextLayerStatus,
} from '../../lib/textLayer'
import type { PageTextLayer } from '../../lib/types'
import styles from './TextLayer.module.css'

// A find-in-page match expressed against a rendered span (item index + char range),
// so the highlight box is measured from real glyph geometry rather than approximated.
export interface SpanMatch { item: number; start: number; len: number; active: boolean }

interface Rect { left: number; top: number; width: number; height: number; active: boolean }

interface Props {
  docId:     string
  bytes:     Uint8Array
  pageIndex: number
  zoom:      number
  ptToPx:    number
  active:    boolean         // page is on-screen → load + render spans
  matches?:  SpanMatch[]     // find-in-page matches for this page
}

export function TextLayer({ docId, bytes, pageIndex, zoom, ptToPx, active, matches }: Props) {
  const [layer,  setLayer]  = useState<PageTextLayer | null>(
    () => getCachedTextLayer(docId, pageIndex) ?? null,
  )
  const [status, setStatus] = useState<TextLayerStatus>(layer ? 'ready' : 'loading')
  const [rects,  setRects]  = useState<Rect[]>([])
  const layerRef = useRef<HTMLDivElement>(null)
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([])

  // Load the text layer once the page is visible (native → OCR fallback).
  useEffect(() => {
    if (!active || layer) return
    let cancelled = false
    setStatus('loading')
    loadPageTextLayer(docId, bytes, pageIndex, () => { if (!cancelled) setStatus('ocr') })
      .then(l => {
        if (cancelled) return
        setLayer(l)
        setStatus(l.items.length ? 'ready' : 'none')
      })
      .catch(() => { if (!cancelled) setStatus('none') })
    return () => { cancelled = true }
  }, [active, docId, bytes, pageIndex, layer])

  const scale = zoom * ptToPx

  // Layout pass (runs after spans mount): (1) stretch each span horizontally to its
  // real width so glyph geometry is correct, then (2) measure highlight rects from
  // the live DOM via Range — pixel-perfect, transform-aware.
  useLayoutEffect(() => {
    if (!active || !layer) { setRects([]); return }

    layer.items.forEach((it, i) => {
      const el = spanRefs.current[i]
      if (!el) return
      el.style.transform = ''
      const natural = el.scrollWidth
      const target  = it.w * scale
      if (natural > 0 && target > 0) el.style.transform = `scaleX(${target / natural})`
    })

    if (!matches || matches.length === 0) { setRects([]); return }
    const layerEl = layerRef.current
    if (!layerEl) { setRects([]); return }
    const base = layerEl.getBoundingClientRect()
    const out: Rect[] = []
    for (const m of matches) {
      const span = spanRefs.current[m.item]
      const node = span?.firstChild
      if (!span || !node) continue
      const range = document.createRange()
      try { range.setStart(node, m.start); range.setEnd(node, m.start + m.len) }
      catch { continue }
      for (const r of range.getClientRects())
        out.push({ left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height, active: m.active })
    }
    setRects(out)
  }, [active, layer, scale, matches])

  // Keep loaded data in state, but drop the DOM when off-screen (saves nodes on long docs).
  if (!active) return null

  return (
    <div ref={layerRef} className={styles.layer}>
      {status === 'ocr' && <div className={styles.badge}>Recognizing text…</div>}

      {rects.map((r, i) => (
        <div
          key={`h${i}`}
          className={`${styles.highlight} ${r.active ? styles.highlightActive : ''}`}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}

      {layer?.items.map((it, i) => (
        <span
          key={i}
          ref={el => { spanRefs.current[i] = el }}
          className={styles.span}
          data-confidence={it.confidence ?? ''}
          style={{
            left:     it.x * scale,
            top:      it.y * scale,
            height:   it.h * scale,
            fontSize: it.h * scale,
          }}
        >
          {it.str}
        </span>
      ))}
    </div>
  )
}
