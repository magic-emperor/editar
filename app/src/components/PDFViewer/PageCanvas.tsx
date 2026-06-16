import { useEffect, useRef, useCallback, useState } from 'react'
import { renderPage } from '../../lib/pdfEngine'
import type { PageSize } from '../../lib/pdfEngine'
import { TextLayer, type SpanMatch } from './TextLayer'
import { EditLayer } from './EditLayer'
import { TableLayer, type TableSelection, type BasketEntry } from './TableLayer'
import { useEditStore } from '../../lib/editStore'
import { useAIStore } from '../../lib/aiStore'
import { useAnnotationStore } from '../../lib/annotationStore'
import { OCRCorrectionLayer } from '../AI/OCRCorrectionLayer'
import { AnnotationLayer } from './AnnotationLayer'
import { TranslationOverlay } from './TranslationOverlay'
import type { TranslationBlock, TranslationMeta } from '../../lib/translator'
import styles from './PageCanvas.module.css'

interface Props {
  docId:          string
  bytes:          Uint8Array
  pageIndex:      number
  pageSize:       PageSize
  zoom:           number        // controls CSS container dimensions
  renderScale:    number        // actual pixel scale (debounced from zoom)
  ptToPx:         number        // 96/72
  matches?:       SpanMatch[]   // find-in-page matches for this page
  tableMode?:          boolean
  tableSelection:      TableSelection | null
  onTableSelect:       (sel: TableSelection | null) => void
  tableBasket:         BasketEntry[]
  onTableBasketToggle: (entry: BasketEntry, append: boolean) => void
  translationBlocks?:  TranslationBlock[]
  translationMeta?:    TranslationMeta
}

export function PageCanvas({
  docId, bytes, pageIndex, pageSize, zoom, renderScale, ptToPx, matches,
  tableMode, tableSelection, onTableSelect, tableBasket, onTableBasketToggle,
  translationBlocks, translationMeta,
}: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cancelRef    = useRef<(() => void) | null>(null)
  const renderedAt   = useRef<number>(-1)
  const visible      = useRef(false)
  const [isVisible, setIsVisible] = useState(false)
  const { editMode }   = useEditStore()
  const { aiMode }     = useAIStore()
  const { activeTool } = useAnnotationStore()

  const cssW = Math.round(pageSize.width  * zoom * ptToPx)
  const cssH = Math.round(pageSize.height * zoom * ptToPx)

  // Keep latest renderScale accessible inside the IO callback (avoids re-creating the observer)
  const renderScaleRef = useRef(renderScale)
  useEffect(() => { renderScaleRef.current = renderScale }, [renderScale])

  const doRender = useCallback(() => {
    const scale = renderScaleRef.current
    if (!visible.current || renderedAt.current === scale) return
    cancelRef.current?.()
    const { promise, cancel } = renderPage(docId, pageIndex, scale)
    cancelRef.current = cancel
    promise.then(bitmap => {
      const canvas = canvasRef.current
      if (!canvas) { bitmap.close(); return }
      canvas.width  = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (ctx) { ctx.drawImage(bitmap, 0, 0) }
      bitmap.close()
      renderedAt.current = scale
    }).catch(() => {/* cancelled or worker error — already handled by engine */})
  }, [docId, pageIndex])

  // Re-render when scale changes and page is already visible
  useEffect(() => {
    if (visible.current) doRender()
  }, [renderScale, doRender])

  // Virtualization: render when in viewport ±600px, release when far away
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        visible.current = true
        setIsVisible(true)
        doRender()
      } else {
        visible.current = false
        setIsVisible(false)
        cancelRef.current?.()
        cancelRef.current = null
        const canvas = canvasRef.current
        if (canvas && canvas.width > 0) {
          canvas.width  = 0   // releases canvas backing store
          canvas.height = 0
          renderedAt.current = -1
        }
      }
    }, { rootMargin: '600px 0px', threshold: 0 })

    observer.observe(container)
    return () => observer.disconnect()
  }, [doRender])

  // Cancel in-flight render on unmount
  useEffect(() => () => { cancelRef.current?.() }, [])

  return (
    <div
      ref={containerRef}
      className={styles.wrapper}
      data-page={pageIndex}
      style={{ width: cssW, height: cssH }}
      aria-label={`Page ${pageIndex + 1}`}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={`Page ${pageIndex + 1}`}
      />
      {editMode ? (
        <EditLayer
          docId={docId}
          bytes={bytes}
          pageIndex={pageIndex}
          zoom={zoom}
          ptToPx={ptToPx}
          active={isVisible}
        />
      ) : (
        <TextLayer
          docId={docId}
          bytes={bytes}
          pageIndex={pageIndex}
          zoom={zoom}
          ptToPx={ptToPx}
          active={isVisible}
          matches={matches}
        />
      )}
      {tableMode && (
        <TableLayer
          docId={docId}
          bytes={bytes}
          pageIndex={pageIndex}
          zoom={zoom}
          ptToPx={ptToPx}
          active={isVisible}
          selection={tableSelection}
          onSelect={onTableSelect}
          basket={tableBasket}
          onBasketToggle={onTableBasketToggle}
        />
      )}
      {aiMode === 'ocr' && isVisible && (
        <OCRCorrectionLayer
          docId={docId}
          pageIndex={pageIndex}
          zoom={zoom}
          ptToPx={ptToPx}
        />
      )}
      <AnnotationLayer
        pageIndex={pageIndex}
        scale={zoom * ptToPx}
        active={isVisible && !!activeTool}
      />
      {translationBlocks && translationMeta && (
        <TranslationOverlay
          blocks={translationBlocks}
          meta={translationMeta}
          cssWidth={cssW}
          cssHeight={cssH}
        />
      )}
    </div>
  )
}
