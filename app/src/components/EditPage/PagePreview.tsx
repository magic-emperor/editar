import { useEffect, useRef, useState } from 'react'
import { renderPage } from '../../lib/pdfEngine'
import type { PageSize } from '../../lib/pdfEngine'
import styles from './PagePreview.module.css'

type BadgeKind = 'remove' | 'extract' | 'rotate'

interface PagePreviewProps {
  docId:       string
  pageSizes:   PageSize[]
  badge?:      (pageIndex: number) => { kind: BadgeKind; label?: string } | null
  splitAfter?: Set<number>
}

const MAX_VIEWER_W = 760
const ZOOM_MIN = 50
const ZOOM_MAX = 300
const ZOOM_STEP = 50

export function PagePreview({ docId, pageSizes, badge, splitAfter }: PagePreviewProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [zoom, setZoom] = useState(100)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)
  const cancelRef  = useRef<(() => void) | null>(null)
  const fitWRef    = useRef(MAX_VIEWER_W)

  // Reset to first page (and zoom) whenever a new document is loaded
  useEffect(() => { setPageIndex(0); setZoom(100) }, [docId])

  const pageCount = pageSizes.length
  const size      = pageSizes[pageIndex]

  useEffect(() => {
    if (!size || !canvasRef.current) return
    const targetW = Math.min(MAX_VIEWER_W, wrapRef.current?.clientWidth ?? MAX_VIEWER_W)
    fitWRef.current = targetW
    const scale = (targetW / (size.width * (96 / 72))) * (zoom / 100)
    const { promise, cancel } = renderPage(docId, pageIndex, scale)
    cancelRef.current = cancel
    promise.then(bitmap => {
      const canvas = canvasRef.current
      if (!canvas) { bitmap.close(); return }
      canvas.width  = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      bitmap.close()
    }).catch(() => {})
    return () => cancel()
  }, [docId, pageIndex, size, zoom])

  const zoomIn  = () => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))
  const zoomOut = () => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))

  const currentBadge = badge ? badge(pageIndex) : null
  const isSplitAfter = splitAfter?.has(pageIndex) ?? false

  return (
    <div className={styles.viewer}>
      <div className={styles.zoomBar}>
        <button className={styles.zoomBtn} onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
        <span className={styles.zoomValue}>{zoom}%</span>
        <button className={styles.zoomBtn} onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
      </div>

      <div ref={wrapRef} className={styles.canvasWrap}>
        <canvas ref={canvasRef} className={styles.canvas} aria-label={`Page ${pageIndex + 1}`} />
        {currentBadge && (
          <span className={
            currentBadge.kind === 'remove'  ? styles.badgeRemove  :
            currentBadge.kind === 'extract' ? styles.badgeExtract : styles.badgeRotate
          }>
            {currentBadge.label ?? (currentBadge.kind === 'remove' ? '✕ Remove' : currentBadge.kind === 'extract' ? '✓ Extract' : '↻ Rotate')}
          </span>
        )}
      </div>

      {isSplitAfter && <div className={styles.splitRibbon}>✂ Split after this page</div>}

      <div className={styles.nav}>
        <button className={styles.navBtn} disabled={pageIndex === 0} onClick={() => setPageIndex(i => Math.max(0, i - 1))}>
          ← Prev
        </button>
        <span className={styles.navCount}>Page {pageIndex + 1} / {pageCount}</span>
        <button className={styles.navBtn} disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex(i => Math.min(pageCount - 1, i + 1))}>
          Next →
        </button>
      </div>
    </div>
  )
}
