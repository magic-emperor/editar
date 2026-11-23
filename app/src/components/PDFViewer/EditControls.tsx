import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { EditStyle, FontFamily, RGB } from '../../lib/types'
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

// Preset font sizes matching Folio/Sejda
const PRESET_SIZES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72]

// Expanded font options grouped by category
interface FontOption { family: FontFamily; label: string; group: string }
const FONT_OPTIONS: FontOption[] = [
  // Sans-serif
  { family: 'sans',       label: 'Helvetica / Arial',  group: 'Sans-serif' },
  { family: 'roboto',     label: 'Roboto',              group: 'Sans-serif' },
  // Serif
  { family: 'serif',      label: 'Times New Roman',     group: 'Serif' },
  { family: 'ptserif',    label: 'PT Serif',            group: 'Serif' },
  // Monospace
  { family: 'mono',       label: 'Courier New',         group: 'Monospace' },
  { family: 'robotomono', label: 'Roboto Mono',         group: 'Monospace' },
]

interface Props {
  style:    EditStyle
  onChange: (patch: Partial<EditStyle>) => void
  position: CSSProperties
  onDelete?: () => void
}

export function EditControls({ style, onChange, position, onDelete }: Props) {
  const [sizeStr,     setSizeStr]     = useState(String(Math.round(style.size)))
  const [sizeOpen,    setSizeOpen]    = useState(false)
  const [fontOpen,    setFontOpen]    = useState(false)
  const colorRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setSizeStr(String(Math.round(style.size))) }, [style.size])

  const commitSize = (raw: string) => {
    const n = parseFloat(raw)
    if (!isNaN(n) && n > 0) onChange({ size: clampSize(n) })
    else setSizeStr(String(Math.round(style.size)))
  }

  // Show original PDF font name (read-only label above the picker)
  const pdfFontName = style.fontName || null
  const displayFontName = pdfFontName
    ? pdfFontName.replace(/^[A-Z]{6}\+/, '') // strip subset prefix like "BCDEEE+"
    : null

  return (
    <div
      className={styles.bar}
      data-editui
      style={position}
      onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
      onClick={e => e.stopPropagation()}
    >
      {/* Bold */}
      <button
        className={`${styles.btn} ${style.bold ? styles.active : ''}`}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        onClick={() => onChange({ bold: !style.bold })}
        title="Bold (Ctrl+B)"
      >
        <strong>B</strong>
      </button>

      {/* Italic */}
      <button
        className={`${styles.btn} ${style.italic ? styles.active : ''}`}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        onClick={() => onChange({ italic: !style.italic })}
        title="Italic (Ctrl+I)"
        style={{ fontStyle: 'italic' }}
      >
        I
      </button>

      <div className={styles.divider} />

      {/* Font size — Tt label + [-] input [+] */}
      <span className={styles.ttLabel}>Tt</span>
      <div className={styles.sizeWrap}>
        <button
          type="button"
          className={styles.stepBtn}
          data-editui
          onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
          onClick={() => {
            const next = clampSize(Math.round(style.size) - 1)
            setSizeStr(String(next))
            onChange({ size: next })
          }}
          title="Decrease font size by 1pt"
        >−</button>
        <input
          className={styles.sizeInput}
          type="text"
          inputMode="numeric"
          value={sizeStr}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => { setSizeStr(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n) && n > 0) onChange({ size: clampSize(n) }) }}
          onBlur={e => commitSize(e.target.value)}
          onFocus={() => setSizeOpen(true)}
          onBlurCapture={() => setTimeout(() => setSizeOpen(false), 150)}
          title="Font size (pt)"
        />
        <button
          type="button"
          className={styles.stepBtn}
          data-editui
          onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
          onClick={() => {
            const next = clampSize(Math.round(style.size) + 1)
            setSizeStr(String(next))
            onChange({ size: next })
          }}
          title="Increase font size by 1pt"
        >+</button>
        {sizeOpen && (
          <div className={styles.sizeDropdown} data-editui>
            {PRESET_SIZES.map(s => (
              <button key={s} className={`${styles.sizeItem} ${Math.round(style.size) === s ? styles.sizeItemActive : ''}`}
                data-editui
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange({ size: s }); setSizeOpen(false) }}
              >{s}</button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.divider} />

      {/* Font family — Aa button */}
      <div className={styles.fontWrap}>
        <button
          className={`${styles.btn} ${styles.aaBtn}`}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
          onClick={() => setFontOpen(f => !f)}
          title="Font family"
        >
          Aa
        </button>
        {fontOpen && (
          <div className={styles.fontDropdown} data-editui>
            {displayFontName && (
              <div className={styles.fontOriginal} title="Original PDF font">
                Original: {displayFontName}
              </div>
            )}
            {(['Sans-serif', 'Serif', 'Monospace'] as const).map(group => (
              <div key={group}>
                <div className={styles.fontGroup}>{group}</div>
                {FONT_OPTIONS.filter(f => f.group === group).map(f => (
                  <button key={f.family}
                    className={`${styles.fontItem} ${style.family === f.family ? styles.fontItemActive : ''}`}
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange({ family: f.family as FontFamily }); setFontOpen(false) }}
                  >{f.label}</button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.divider} />

      {/* Strikethrough */}
      <button
        className={styles.btn}
        style={{ textDecoration: 'line-through' }}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        onClick={() => onChange({ strikethrough: !style.strikethrough })}
        title="Strikethrough"
      >
        S
      </button>

      {/* Color */}
      <button
        className={styles.colorBtn}
        style={{ background: rgbToHex(style.color) }}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        onClick={() => colorRef.current?.click()}
        title="Text color"
      />
      <input
        ref={colorRef}
        type="color"
        className={styles.hiddenColor}
        value={rgbToHex(style.color)}
        onChange={e => onChange({ color: hexToRgb(e.target.value) })}
        data-editui
      />

      <div className={styles.divider} />

      {/* Delete */}
      {onDelete && (
        <button
          className={`${styles.btn} ${styles.deleteBtn}`}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
          onClick={onDelete}
          title="Delete this text"
        >
          🗑
        </button>
      )}
    </div>
  )
}
