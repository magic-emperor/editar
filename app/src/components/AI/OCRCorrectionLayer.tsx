import { useEffect, useState, useRef } from 'react'
import { getCachedTextLayer } from '../../lib/textLayer'
import { useAIStore } from '../../lib/aiStore'
import { correctOCRWord, AIAuthError, AIRateLimitError } from '../../lib/aiClient'
import { OCR_LOW_CONFIDENCE } from '../../lib/constants'
import type { TextItem } from '../../lib/types'
import styles from './AI.module.css'

interface Props {
  docId:     string
  pageIndex: number
  zoom:      number
  ptToPx:    number
}

interface PopoverState {
  itemKey:     string
  word:        string
  suggestion:  string | null
  loading:     boolean
  error:       string | null
  x:           number
  y:           number
}

export function OCRCorrectionLayer({ docId, pageIndex, zoom, ptToPx }: Props) {
  const { licenseKey, aiServerUrl, corrections, acceptCorrection } = useAIStore()
  const [items, setItems]     = useState<TextItem[]>([])
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const overlayRef            = useRef<HTMLDivElement>(null)

  const scale = zoom * ptToPx

  useEffect(() => {
    const layer = getCachedTextLayer(docId, pageIndex)
    if (layer) {
      setItems(layer.items.filter(it => it.source === 'ocr' && (it.confidence ?? 100) < OCR_LOW_CONFIDENCE))
    }
  }, [docId, pageIndex, zoom])

  async function handleWordClick(e: React.MouseEvent, it: TextItem, idx: number) {
    e.stopPropagation()
    const itemKey = `${pageIndex}:${idx}`
    const x = it.x * scale
    const y = (it.y + it.h) * scale + 4

    setPopover({ itemKey, word: it.str, suggestion: null, loading: true, error: null, x, y })

    // Context: up to 40 chars before/after
    const allItems = getCachedTextLayer(docId, pageIndex)?.items ?? []
    const ctxBefore = allItems.slice(Math.max(0, idx - 5), idx).map(i => i.str).join(' ')
    const ctxAfter  = allItems.slice(idx + 1, idx + 6).map(i => i.str).join(' ')

    try {
      const suggestion = await correctOCRWord(
        licenseKey!, aiServerUrl, it.str, ctxBefore, ctxAfter, it.confidence ?? 50,
      )
      setPopover(prev => prev?.itemKey === itemKey ? { ...prev, suggestion, loading: false } : prev)
    } catch (err) {
      const msg = err instanceof AIAuthError      ? 'Invalid license key'
                : err instanceof AIRateLimitError ? 'Rate limit exceeded'
                : 'AI server unavailable'
      setPopover(prev => prev?.itemKey === itemKey ? { ...prev, error: msg, loading: false } : prev)
    }
  }

  function handleAccept() {
    if (!popover?.suggestion) return
    acceptCorrection(popover.itemKey, popover.suggestion)
    setPopover(null)
  }

  if (items.length === 0) return null

  return (
    <div ref={overlayRef} className={styles.ocrOverlay} onClick={() => setPopover(null)}>
      {items.map((it, idx) => {
        const itemKey = `${pageIndex}:${idx}`
        const accepted = corrections.get(itemKey)
        return (
          <span
            key={idx}
            className={accepted ? styles.ocrCorrected : styles.ocrUnderline}
            style={{
              position: 'absolute',
              left:     it.x   * scale,
              top:      it.y   * scale,
              width:    Math.max(it.w, 6) * scale,
              height:   it.h   * scale,
              fontSize: it.h   * scale,
            }}
            onClick={e => handleWordClick(e, it, idx)}
            title={accepted ? `Corrected: ${accepted}` : `Low confidence (${it.confidence?.toFixed(0)}%) — click to correct`}
          >
            {accepted ?? ''}
          </span>
        )
      })}

      {popover && (
        <div
          className={styles.ocrPopover}
          style={{ left: popover.x, top: popover.y }}
          onClick={e => e.stopPropagation()}
        >
          {popover.loading && <span className={styles.ocrLoading}>Checking…</span>}
          {popover.error   && <span className={styles.ocrError}>{popover.error}</span>}
          {popover.suggestion !== null && !popover.loading && (
            <>
              <span className={styles.ocrSuggLabel}>AI suggests:</span>
              <strong className={styles.ocrSuggWord}>{popover.suggestion}</strong>
              <button className={styles.ocrAcceptBtn} onClick={handleAccept}>Accept</button>
              <button className={styles.ocrIgnoreBtn} onClick={() => setPopover(null)}>Ignore</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
