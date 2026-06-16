import { useEffect, useRef } from 'react'
import { renderPage } from '../../lib/pdfEngine'
import type { PageSize } from '../../lib/pdfEngine'
import type { AffectedPages } from '../../lib/fileStore'
import { THUMB_SCALE } from '../../lib/constants'
import styles from './ThumbnailStrip.module.css'

interface ThumbnailProps {
  docId:       string
  pageIndex:   number
  pageSize:    PageSize
  active:      boolean
  marker:      'remove' | 'extract' | undefined
  onClick:     () => void
}

function Thumbnail({ docId, pageIndex, pageSize, active, marker, onClick }: ThumbnailProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLButtonElement>(null)
  const rendered     = useRef(false)
  const cancelRef    = useRef<(() => void) | null>(null)

  const thumbH = Math.round(pageSize.height * THUMB_SCALE)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Render once when first visible — thumbnails are kept for the session
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || rendered.current) return
      rendered.current = true
      observer.disconnect()

      const { promise, cancel } = renderPage(docId, pageIndex, THUMB_SCALE)
      cancelRef.current = cancel
      promise.then(bitmap => {
        const canvas = canvasRef.current
        if (!canvas) { bitmap.close(); return }
        canvas.width  = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(bitmap, 0, 0)
        bitmap.close()
      }).catch(() => {})
    }, { rootMargin: '300px 0px' })

    observer.observe(container)
    return () => { observer.disconnect(); cancelRef.current?.() }
  }, [docId, pageIndex])

  const itemClass = [
    styles.item,
    active  ? styles.active        : '',
    marker === 'remove'  ? styles.markedRemove  : '',
    marker === 'extract' ? styles.markedExtract : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      ref={containerRef}
      className={itemClass}
      onClick={onClick}
      aria-label={`Go to page ${pageIndex + 1}`}
      aria-current={active ? 'page' : undefined}
    >
      <div className={styles.canvasWrapper} style={{ height: thumbH }}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
        {marker && (
          <span className={marker === 'remove' ? styles.badgeRemove : styles.badgeExtract}
                aria-hidden>
            {marker === 'remove' ? '✕' : '✓'}
          </span>
        )}
      </div>
      <span className={styles.label}>{pageIndex + 1}</span>
    </button>
  )
}

interface StripProps {
  docId:         string
  pageSizes:     PageSize[]
  currentPage:   number
  onPageClick:   (index: number) => void
  affectedPages: AffectedPages | null
}

export function ThumbnailStrip({ docId, pageSizes, currentPage, onPageClick, affectedPages }: StripProps) {
  return (
    <aside className={styles.strip} aria-label="Page thumbnails">
      {pageSizes.map((size, i) => {
        const isAffected = affectedPages?.indices.includes(i) ?? false
        return (
          <Thumbnail
            key={i}
            docId={docId}
            pageIndex={i}
            pageSize={size}
            active={i === currentPage}
            marker={isAffected ? affectedPages!.marker : undefined}
            onClick={() => onPageClick(i)}
          />
        )
      })}
    </aside>
  )
}
