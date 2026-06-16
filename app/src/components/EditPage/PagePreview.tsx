import { useCallback, useEffect, useRef, useState } from 'react'
import { renderPage } from '../../lib/pdfEngine'
import type { PageSize } from '../../lib/pdfEngine'
import styles from './PagePreview.module.css'

type BadgeKind = 'remove' | 'extract' | 'rotate'
type BadgeInfo = { kind: BadgeKind; label?: string } | null

interface PagePreviewProps {
  docId:       string
  pageSizes:   PageSize[]
  badge?:      (pageIndex: number) => BadgeInfo
  splitAfter?: Set<number>
}

const MAX_VIEWER_W = 760
const ZOOM_MIN = 50
const ZOOM_MAX = 300
const ZOOM_STEP = 50

interface PageSlotProps {
  docId:        string
  index:        number
  size:         PageSize
  fitWidth:     number
  zoom:         number
  badgeInfo:    BadgeInfo
  isSplitAfter: boolean
  registerEl:   (index: number, el: HTMLDivElement | null) => void
}

function PageSlot({ docId, index, size, fitWidth, zoom, badgeInfo, isSplitAfter, registerEl }: PageSlotProps) {
  const [ready, setReady] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elRef     = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const setRefs = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el
    registerEl(index, el)
  }, [index, registerEl])

  // Lazily mark this page "ready" once it nears the viewport, so distant pages
  // in a long PDF don't all decode at once.
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setReady(entry.isIntersecting),
      { rootMargin: '800px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!ready) return
    const scale = (fitWidth / (size.width * (96 / 72))) * (zoom / 100)
    const { promise, cancel } = renderPage(docId, index, scale)
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
  }, [ready, docId, index, size, fitWidth, zoom])

  return (
    <div ref={setRefs} className={styles.pageSlot} data-page-index={index}>
      <div className={styles.canvasBox}>
        <canvas ref={canvasRef} className={styles.canvas} aria-label={`Page ${index + 1}`} />
        {badgeInfo && (
          <span className={
            badgeInfo.kind === 'remove'  ? styles.badgeRemove  :
            badgeInfo.kind === 'extract' ? styles.badgeExtract : styles.badgeRotate
          }>
            {badgeInfo.label ?? (badgeInfo.kind === 'remove' ? '✕ Remove' : badgeInfo.kind === 'extract' ? '✓ Extract' : '↻ Rotate')}
          </span>
        )}
      </div>
      {isSplitAfter && <div className={styles.splitRibbon}>✂ Split after this page</div>}
    </div>
  )
}

export function PagePreview({ docId, pageSizes, badge, splitAfter }: PagePreviewProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [zoom, setZoom]           = useState(100)
  const [fitWidth, setFitWidth]   = useState(MAX_VIEWER_W)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const slotElsRef = useRef<Map<number, HTMLDivElement>>(new Map())

  const pageCount = pageSizes.length

  // Reset to first page (and zoom) whenever a new document is loaded
  useEffect(() => {
    setPageIndex(0)
    setZoom(100)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [docId])

  // Track the scroll container's width so pages can fit it
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setFitWidth(Math.min(MAX_VIEWER_W, el.clientWidth))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const registerEl = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) slotElsRef.current.set(index, el)
    else slotElsRef.current.delete(index)
  }, [])

  // Scroll-spy: whichever page occupies the most visible area becomes "current"
  // for the counter and Prev/Next buttons, without removing manual navigation.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const ratios = new Map<number, number>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const idx = Number((entry.target as HTMLElement).dataset.pageIndex)
        ratios.set(idx, entry.isIntersecting ? entry.intersectionRatio : 0)
      }
      let best = -1, bestRatio = 0
      for (const [idx, ratio] of ratios) {
        if (ratio > bestRatio) { bestRatio = ratio; best = idx }
      }
      if (best >= 0) setPageIndex(best)
    }, { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] })

    slotElsRef.current.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [docId, pageCount])

  const scrollToPage = (index: number) => {
    slotElsRef.current.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const zoomIn  = () => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))
  const zoomOut = () => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))

  return (
    <div className={styles.viewer}>
      <div className={styles.zoomBar}>
        <button className={styles.zoomBtn} onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
        <span className={styles.zoomValue}>{zoom}%</span>
        <button className={styles.zoomBtn} onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
      </div>

      <div ref={scrollRef} className={styles.canvasWrap}>
        {pageSizes.map((size, i) => (
          <PageSlot
            key={i}
            docId={docId}
            index={i}
            size={size}
            fitWidth={fitWidth}
            zoom={zoom}
            badgeInfo={badge ? badge(i) : null}
            isSplitAfter={splitAfter?.has(i) ?? false}
            registerEl={registerEl}
          />
        ))}
      </div>

      <div className={styles.nav}>
        <button className={styles.navBtn} disabled={pageIndex === 0} onClick={() => scrollToPage(Math.max(0, pageIndex - 1))}>
          ← Prev
        </button>
        <span className={styles.navCount}>Page {pageIndex + 1} / {pageCount}</span>
        <button className={styles.navBtn} disabled={pageIndex >= pageCount - 1} onClick={() => scrollToPage(Math.min(pageCount - 1, pageIndex + 1))}>
          Next →
        </button>
      </div>
    </div>
  )
}
