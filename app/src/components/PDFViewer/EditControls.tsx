import { useEffect, useState, type CSSProperties } from 'react'
import type { EditStyle, FontFamily, RGB } from '../../lib/types'
import { FAMILY_LABELS } from '../../lib/fontClassify'
import styles from './EditControls.module.css'

function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
}
const clampSize = (n: number) => Math.min(400, Math.max(2, n))

interface Props {
  style:    EditStyle
  onChange: (patch: Partial<EditStyle>) => void
  position: CSSProperties
}

export function EditControls({ style, onChange, position }: Props) {
  // Local string so the field can be emptied/backspaced while typing.
  const [sizeStr, setSizeStr] = useState(String(Math.round(style.size)))
  useEffect(() => { setSizeStr(String(Math.round(style.size))) }, [style.size])

  const commitSize = (raw: string) => {
    const n = parseFloat(raw)
    if (!isNaN(n) && n > 0) onChange({ size: clampSize(n) })
    else setSizeStr(String(Math.round(style.size)))   // revert empty/invalid on blur
  }
  const step = (d: number) => onChange({ size: clampSize(Math.round(style.size) + d) })

  return (
    <div className={styles.bar} data-editui style={position}
      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <select className={styles.select} value={style.family}
        onChange={e => onChange({ family: e.target.value as FontFamily })} title="Font">
        {(Object.keys(FAMILY_LABELS) as FontFamily[]).map(f =>
          <option key={f} value={f}>{FAMILY_LABELS[f]}</option>)}
      </select>

      <div className={styles.sizeGroup}>
        <button className={styles.step} onClick={() => step(-1)} title="Smaller" tabIndex={-1}>−</button>
        <input className={styles.size} type="text" inputMode="numeric" value={sizeStr}
          onChange={e => { setSizeStr(e.target.value); commitSizeLive(e.target.value, onChange) }}
          onBlur={e => commitSize(e.target.value)}
          title="Font size (pt)" />
        <button className={styles.step} onClick={() => step(1)} title="Larger" tabIndex={-1}>+</button>
      </div>

      <button className={`${styles.toggle} ${style.bold ? styles.on : ''}`}
        onClick={() => onChange({ bold: !style.bold })} title="Bold (Ctrl+B)" style={{ fontWeight: 700 }}>B</button>
      <button className={`${styles.toggle} ${style.italic ? styles.on : ''}`}
        onClick={() => onChange({ italic: !style.italic })} title="Italic (Ctrl+I)" style={{ fontStyle: 'italic' }}>I</button>

      <input className={styles.color} type="color" value={rgbToHex(style.color)}
        onChange={e => onChange({ color: hexToRgb(e.target.value) })} title="Text colour" />
    </div>
  )
}

// Apply a valid number as the user types (without clobbering an in-progress empty field).
function commitSizeLive(raw: string, onChange: (p: Partial<EditStyle>) => void) {
  const n = parseFloat(raw)
  if (!isNaN(n) && n > 0) onChange({ size: clampSize(n) })
}
