import { useAnnotationStore } from '../../lib/annotationStore'
import styles from './AnnotationPanel.module.css'

interface Props {
  onScrollToPage: (pageIndex: number) => void
  onClose:        () => void
}

const KIND_LABEL: Record<string, string> = {
  highlight:     'Highlight',
  underline:     'Underline',
  strikethrough: 'Strikethrough',
  note:          'Note',
}

export function AnnotationPanel({ onScrollToPage, onClose }: Props) {
  const { annotations, removeAnnotation } = useAnnotationStore()

  // Group annotations by page
  const byPage = annotations.reduce<Record<number, typeof annotations>>((acc, a) => {
    ;(acc[a.pageIndex] ??= []).push(a)
    return acc
  }, {})

  const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b)

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Annotations</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      <div className={styles.list}>
        {annotations.length === 0 && (
          <p className={styles.empty}>
            No annotations yet. Select text and choose a tool, or use the Note tool to pin a comment.
          </p>
        )}

        {pages.map(pageIndex => (
          <div key={pageIndex} className={styles.pageGroup}>
            <div className={styles.pageLabel}>Page {pageIndex + 1}</div>
            {byPage[pageIndex].map(ann => (
              <div
                key={ann.id}
                className={styles.item}
                onClick={() => onScrollToPage(pageIndex)}
              >
                <div
                  className={styles.swatch}
                  style={{ background: ann.color }}
                />
                <div className={styles.itemMeta}>
                  <div className={styles.itemKind}>{KIND_LABEL[ann.kind] ?? ann.kind}</div>
                  {ann.note && <div className={styles.itemNote}>{ann.note}</div>}
                </div>
                <button
                  className={styles.deleteBtn}
                  title="Delete annotation"
                  onClick={e => { e.stopPropagation(); removeAnnotation(ann.id) }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
