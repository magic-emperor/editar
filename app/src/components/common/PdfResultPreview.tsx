import { useEffect, useState } from 'react'
import { openDocument, closeDocument, renderPage } from '../../lib/pdfEngine'
import styles from './PdfResultPreview.module.css'

interface Props {
  bytes: Uint8Array
  fileName?: string
}

export function PdfResultPreview({ bytes, fileName }: Props) {
  const [docId,     setDocId]     = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [imgUrl,    setImgUrl]    = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [lightbox,  setLightbox]  = useState(false)

  // 1. Open document in PDFium worker
  useEffect(() => {
    let cancelled = false
    let openedId: string | null = null

    setLoading(true)
    setError(null)
    setPageIndex(0)

    openDocument(bytes)
      .then(({ docId: id, pageCount: count }) => {
        if (cancelled) {
          closeDocument(id).catch(() => {})
          return
        }
        openedId = id
        setDocId(id)
        setPageCount(count)
      })
      .catch(e => {
        if (!cancelled) {
          setError(String(e).replace(/^Error:\s*/, ''))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (openedId) closeDocument(openedId).catch(() => {})
    }
  }, [bytes])

  // 2. Render page whenever docId or pageIndex changes
  useEffect(() => {
    if (!docId) return
    let cancelled = false
    setLoading(true)

    const { promise, cancel } = renderPage(docId, pageIndex, 1.5)
    promise
      .then(bmp => {
        if (cancelled) { bmp.close(); return }
        const canvas = document.createElement('canvas')
        canvas.width  = bmp.width
        canvas.height = bmp.height
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(bmp, 0, 0)
        bmp.close()
        if (!cancelled) {
          setImgUrl(canvas.toDataURL('image/png'))
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(String(err).replace(/^Error:\s*/, ''))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      cancel()
    }
  }, [docId, pageIndex])

  if (error) {
    return <div className={styles.errorBox}>Preview unavailable: {error}</div>
  }

  return (
    <div className={styles.container}>
      {loading && !imgUrl && (
        <div className={styles.loadingBox}>
          <div className={styles.spinner} />
          <span>Rendering preview…</span>
        </div>
      )}

      {imgUrl && (
        <div className={styles.imageWrap}>
          <img
            src={imgUrl}
            alt={fileName ? `${fileName} page ${pageIndex + 1}` : `Page ${pageIndex + 1}`}
            className={styles.pdfPageImg}
            onClick={() => setLightbox(true)}
            title="Click to view full size"
          />
        </div>
      )}

      {pageCount > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            disabled={pageIndex <= 0}
            onClick={() => setPageIndex(p => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span className={styles.pageLabel}>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <button
            className={styles.pageBtn}
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex(p => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightbox && imgUrl && (
        <div className={styles.lightbox} onClick={() => setLightbox(false)}>
          <div className={styles.lightboxContent} onClick={e => e.stopPropagation()}>
            <img
              src={imgUrl}
              className={styles.lightboxImg}
              alt={fileName ? `${fileName} page ${pageIndex + 1}` : `Page ${pageIndex + 1}`}
            />
            <button className={styles.lightboxClose} onClick={() => setLightbox(false)} aria-label="Close preview">
              ✕
            </button>
            {pageCount > 1 && (
              <div className={styles.lightboxPagination}>
                <button
                  className={styles.pageBtn}
                  disabled={pageIndex <= 0}
                  onClick={() => setPageIndex(p => Math.max(0, p - 1))}
                >
                  ← Prev
                </button>
                <span className={styles.lightboxPageLabel}>
                  Page {pageIndex + 1} of {pageCount}
                </span>
                <button
                  className={styles.pageBtn}
                  disabled={pageIndex >= pageCount - 1}
                  onClick={() => setPageIndex(p => Math.min(pageCount - 1, p + 1))}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
