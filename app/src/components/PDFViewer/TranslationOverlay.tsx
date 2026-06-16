import type { TranslationBlock, TranslationMeta } from '../../lib/translator'
import styles from './TranslationOverlay.module.css'

interface Props {
  blocks:    TranslationBlock[]
  meta:      TranslationMeta
  cssWidth:  number   // container width in CSS px
  cssHeight: number   // container height in CSS px
}

export function TranslationOverlay({ blocks, meta, cssWidth, cssHeight }: Props) {
  if (!blocks.length || !meta.page_width || !meta.page_height) return null

  const scaleX = cssWidth  / meta.page_width
  const scaleY = cssHeight / meta.page_height

  return (
    <div className={styles.layer} aria-hidden="true">
      {blocks.map((block, i) => {
        const [x0, y0, x1, y1] = block.bbox
        const boxH   = (y1 - y0) * scaleY
        const fontSize = Math.max(7, Math.min(boxH * 0.82, 13))

        return (
          <div
            key={i}
            className={styles.block}
            style={{
              left:     x0 * scaleX,
              top:      y0 * scaleY,
              width:    (x1 - x0) * scaleX,
              height:   boxH,
              fontSize,
            }}
            title={block.text}
          >
            {block.translated}
          </div>
        )
      })}
    </div>
  )
}
