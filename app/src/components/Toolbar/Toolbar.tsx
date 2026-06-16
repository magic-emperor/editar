import { useState, useRef, type ChangeEvent, type ComponentType } from 'react'
import { useFileStore, type AffectedPages } from '../../lib/fileStore'
import { useEditStore } from '../../lib/editStore'
import { runOp, splitDocument } from '../../lib/pdfEngine'
import type { PdfOpRequest, WatermarkPos } from '../../lib/pdfOps'
import { EditPanel } from './EditPanel'
import styles from './Toolbar.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanSize(n: number): string {
  return n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(1)} MB`
}

function parsePageRanges(input: string, count: number): number[] {
  const set = new Set<number>()
  for (const part of input.split(',')) {
    const t = part.trim()
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      for (let i = +m[1] - 1; i <= Math.min(+m[2] - 1, count - 1); i++)
        if (i >= 0) set.add(i)
    } else {
      const n = +t - 1
      if (!isNaN(n) && n >= 0 && n < count) set.add(n)
    }
  }
  return [...set].sort((a, b) => a - b)
}

function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a   = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

// ─── Op list ──────────────────────────────────────────────────────────────────

type OpId =
  | 'merge' | 'split' | 'extract' | 'remove'
  | 'reorder' | 'rotate' | 'compress' | 'watermark' | 'pageNumbers'

const OPS: { id: OpId; label: string; desc: string }[] = [
  { id: 'merge',       label: 'Merge',         desc: 'Combine PDFs into one' },
  { id: 'split',       label: 'Split',          desc: 'Divide into separate files' },
  { id: 'extract',     label: 'Extract Pages',  desc: 'Save selected pages' },
  { id: 'remove',      label: 'Remove Pages',   desc: 'Delete pages from this file' },
  { id: 'reorder',     label: 'Reorder',        desc: 'Change the page order' },
  { id: 'rotate',      label: 'Rotate',         desc: 'Rotate one or all pages' },
  { id: 'compress',    label: 'Compress',       desc: 'Reduce file size' },
  { id: 'watermark',   label: 'Watermark',      desc: 'Stamp text on every page' },
  { id: 'pageNumbers', label: 'Page Numbers',   desc: 'Add page numbers' },
]

// ─── Result display ───────────────────────────────────────────────────────────

type OpResult =
  | { kind: 'single'; bytes: Uint8Array }
  | { kind: 'multi';  parts: Uint8Array[] }

function ResultActions({
  result, baseName, originalSize,
}: {
  result: OpResult; baseName: string; originalSize: number
}) {
  const stem = baseName.replace(/\.pdf$/i, '')

  if (result.kind === 'multi') {
    const total = result.parts.reduce((s, p) => s + p.length, 0)
    return (
      <div className={styles.result}>
        <p className={styles.resultNote}>
          {result.parts.length} parts · {humanSize(total)} total
        </p>
        <div className={styles.resultActions}>
          {result.parts.map((part, i) => (
            <button key={i} className={styles.resultBtn}
              onClick={() => downloadBytes(part, `${stem}-part-${i + 1}.pdf`)}>
              Download Part {i + 1} ({humanSize(part.length)})
            </button>
          ))}
        </div>
      </div>
    )
  }

  const { bytes } = result
  const saved = Math.max(0, originalSize - bytes.length)
  return (
    <div className={styles.result}>
      <p className={styles.resultNote}>
        ✓ Changes applied to viewer
        {saved > 200 && ` · ${humanSize(originalSize)} → ${humanSize(bytes.length)}`}
      </p>
      <div className={styles.resultActions}>
        <button className={styles.resultBtn}
          onClick={() => downloadBytes(bytes, `${stem}-modified.pdf`)}>
          Download a copy
        </button>
      </div>
    </div>
  )
}

// ─── Panel props ──────────────────────────────────────────────────────────────

interface PanelProps {
  file:             { name: string; bytes: Uint8Array }
  running:          boolean
  pageCount:        number
  onRun:            (req: PdfOpRequest) => void
  setAffected:      (ap: AffectedPages | null) => void
}

// ─── Individual op panels ────────────────────────────────────────────────────

function MergePanel({ file, running, onRun }: PanelProps) {
  const [extras, setExtras] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const addFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = Array.from(e.target.files ?? []).filter(f => f.name.endsWith('.pdf'))
    setExtras(prev => [...prev, ...f])
    e.target.value = ''
  }

  const handleMerge = async () => {
    const extraBytes = await Promise.all(extras.map(f => f.arrayBuffer().then(b => new Uint8Array(b))))
    onRun({ op: 'merge', files: [file.bytes, ...extraBytes] })
  }

  return (
    <>
      <p className={styles.panelTitle}>Merge PDFs</p>
      <p className={styles.hint}>Current file is first. Add files to append.</p>
      {extras.length > 0 && (
        <ul className={styles.fileList}>
          {extras.map((f, i) => (
            <li key={i} className={styles.fileItem}>
              <span className={styles.fileItemName} title={f.name}>{f.name}</span>
              <button className={styles.removeFileBtn}
                onClick={() => setExtras(prev => prev.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <button className={styles.resultBtn} style={{ marginBottom: '0.4rem' }}
        onClick={() => inputRef.current?.click()}>
        + Add PDF
      </button>
      <input ref={inputRef} type="file" accept=".pdf" multiple
        style={{ display: 'none' }} onChange={addFile} />
      <button className={styles.applyBtn} onClick={handleMerge}
        disabled={running || extras.length === 0}>
        {running ? 'Merging…' : `Merge ${1 + extras.length} files`}
      </button>
    </>
  )
}

function SplitPanel({ file, running, onRun }: PanelProps) {
  const [input, setInput] = useState('')
  return (
    <>
      <p className={styles.panelTitle}>Split PDF</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="split-input">Split after page(s)</label>
        <input id="split-input" className={styles.input} value={input}
          onChange={e => setInput(e.target.value)} placeholder="e.g. 3, 6, 9" />
        <p className={styles.hint}>Enter page numbers separated by commas</p>
      </div>
      <button className={styles.applyBtn} disabled={running || !input.trim()}
        onClick={() => {
          const pts = input.split(',').map(s => parseInt(s.trim(), 10) - 1)
            .filter(n => !isNaN(n) && n >= 0)
          onRun({ op: 'split', file: file.bytes, splitAfterPages: pts })
        }}>
        {running ? 'Splitting…' : 'Split'}
      </button>
    </>
  )
}

function ExtractPanel({ file, running, onRun, pageCount, setAffected }: PanelProps) {
  const [input, setInput] = useState('')

  const handleChange = (val: string) => {
    setInput(val)
    const pages = parsePageRanges(val, pageCount)
    setAffected(pages.length > 0 ? { indices: pages, marker: 'extract' } : null)
  }

  return (
    <>
      <p className={styles.panelTitle}>Extract Pages</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="extract-input">Pages to extract</label>
        <input id="extract-input" className={styles.input} value={input}
          onChange={e => handleChange(e.target.value)} placeholder="e.g. 1-3, 5, 7-9" />
        <p className={styles.hint}>Use ranges (1-3) or individual pages</p>
      </div>
      <button className={styles.applyBtn} disabled={running || !input.trim()}
        onClick={() => {
          const pages = parsePageRanges(input, pageCount)
          onRun({ op: 'extract', file: file.bytes, pages })
        }}>
        {running ? 'Extracting…' : 'Extract'}
      </button>
    </>
  )
}

function RemovePanel({ file, running, onRun, pageCount, setAffected }: PanelProps) {
  const [input, setInput] = useState('')

  const handleChange = (val: string) => {
    setInput(val)
    const pages = parsePageRanges(val, pageCount)
    setAffected(pages.length > 0 ? { indices: pages, marker: 'remove' } : null)
  }

  return (
    <>
      <p className={styles.panelTitle}>Remove Pages</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="remove-input">Pages to remove</label>
        <input id="remove-input" className={styles.input} value={input}
          onChange={e => handleChange(e.target.value)} placeholder="e.g. 2, 5-7" />
        <p className={styles.hint}>Remaining pages are saved · pages marked in strip</p>
      </div>
      <button className={styles.applyBtn} disabled={running || !input.trim()}
        onClick={() => {
          const pages = parsePageRanges(input, pageCount)
          onRun({ op: 'remove', file: file.bytes, pages })
        }}>
        {running ? 'Removing…' : 'Remove'}
      </button>
    </>
  )
}

function ReorderPanel({ file, running, onRun, pageCount }: PanelProps) {
  const [input, setInput] = useState('')
  // Build a reversed-order example so the hint is always concrete for this doc
  const example = Array.from({ length: pageCount }, (_, i) => i + 1).reverse().join(', ')

  return (
    <>
      <p className={styles.panelTitle}>Reorder Pages</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="reorder-input">New page order</label>
        <input id="reorder-input" className={styles.input} value={input}
          onChange={e => setInput(e.target.value)} placeholder={example} />
        <p className={styles.hint}>
          You must list ALL {pageCount} pages.
          E.g. "{example}" reverses them.
        </p>
      </div>
      <button className={styles.applyBtn} disabled={running || !input.trim()}
        onClick={() => {
          const newOrder = input.split(',').map(s => parseInt(s.trim(), 10) - 1)
            .filter(n => !isNaN(n) && n >= 0)
          onRun({ op: 'reorder', file: file.bytes, newOrder })
        }}>
        {running ? 'Reordering…' : 'Reorder'}
      </button>
    </>
  )
}

function RotatePanel({ file, running, onRun, pageCount, setAffected }: PanelProps) {
  const [page,    setPage]    = useState('')
  const [degrees, setDegrees] = useState<90 | 180 | 270>(90)

  const handlePageChange = (val: string) => {
    setPage(val)
    const n = parseInt(val, 10) - 1
    setAffected((!isNaN(n) && n >= 0 && n < pageCount)
      ? { indices: [n], marker: 'extract' }
      : null)
  }

  return (
    <>
      <p className={styles.panelTitle}>Rotate Page</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="rotate-page">Page number</label>
        <input id="rotate-page" className={styles.input} type="number" min={1} max={pageCount}
          value={page} onChange={e => handlePageChange(e.target.value)}
          placeholder={`1 – ${pageCount}`} />
        <p className={styles.hint}>Document has {pageCount} page{pageCount === 1 ? '' : 's'}</p>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Direction</span>
        <div className={styles.toggleGroup}>
          {([90, 180, 270] as const).map(d => (
            <button key={d}
              className={`${styles.toggleBtn} ${degrees === d ? styles.selected : ''}`}
              onClick={() => setDegrees(d)}>
              {d}°
            </button>
          ))}
        </div>
      </div>
      <button className={styles.applyBtn} disabled={running || !page.trim()}
        onClick={() => {
          const pageIndex = parseInt(page, 10) - 1
          if (!isNaN(pageIndex) && pageIndex >= 0)
            onRun({ op: 'rotate', file: file.bytes, pageIndex, rotateDegrees: degrees })
        }}>
        {running ? 'Rotating…' : 'Rotate'}
      </button>
    </>
  )
}

function CompressPanel({ file, running, onRun }: PanelProps) {
  return (
    <>
      <p className={styles.panelTitle}>Compress PDF</p>
      <p className={styles.hint} style={{ marginBottom: '0.6rem' }}>
        Rewrites the file using object streams. Savings depend on the original encoding.
      </p>
      <p className={styles.hint} style={{ marginBottom: '0.8rem' }}>
        Current size: <strong>{humanSize(file.bytes.length)}</strong>
      </p>
      <button className={styles.applyBtn} disabled={running}
        onClick={() => onRun({ op: 'compress', file: file.bytes })}>
        {running ? 'Compressing…' : 'Compress'}
      </button>
    </>
  )
}

const WATERMARK_POSITIONS: { id: WatermarkPos; label: string }[] = [
  { id: 'top-left',     label: 'Top Left' },
  { id: 'top-right',    label: 'Top Right' },
  { id: 'center',       label: 'Centre' },
  { id: 'bottom-left',  label: 'Bot Left' },
  { id: 'bottom-right', label: 'Bot Right' },
  { id: 'diagonal',     label: 'Diagonal' },
]

function WatermarkPanel({ file, running, onRun }: PanelProps) {
  const [text,     setText]    = useState('DRAFT')
  const [opacity,  setOpacity] = useState(0.4)
  const [position, setPos]     = useState<WatermarkPos>('diagonal')

  return (
    <>
      <p className={styles.panelTitle}>Add Watermark</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="wm-text">Text</label>
        <input id="wm-text" className={styles.input} value={text}
          onChange={e => setText(e.target.value)} placeholder="e.g. DRAFT" />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Opacity — {Math.round(opacity * 100)}%</span>
        <input type="range" className={styles.slider} min={0.05} max={0.9} step={0.05}
          value={opacity} onChange={e => setOpacity(+e.target.value)} />
        <p className={styles.hint}>Lower = subtle ghost · Higher = bold stamp</p>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Position</span>
        <div className={styles.positionGrid}>
          {WATERMARK_POSITIONS.map(p => (
            <button key={p.id}
              className={`${styles.toggleBtn} ${position === p.id ? styles.selected : ''}`}
              onClick={() => setPos(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <button className={styles.applyBtn} disabled={running || !text.trim()}
        onClick={() => onRun({ op: 'watermark', file: file.bytes, text, opacity, position })}>
        {running ? 'Adding…' : 'Add Watermark'}
      </button>
    </>
  )
}

function PageNumbersPanel({ file, running, onRun }: PanelProps) {
  const [startAt,  setStartAt]  = useState(1)
  const [position, setPosition] = useState<'bottom-center' | 'bottom-right'>('bottom-center')

  return (
    <>
      <p className={styles.panelTitle}>Add Page Numbers</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="pn-start">Start numbering at</label>
        <input id="pn-start" className={styles.input} type="number" min={1}
          value={startAt} onChange={e => setStartAt(+e.target.value)} />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Position</span>
        <div className={styles.toggleGroup}>
          <button className={`${styles.toggleBtn} ${position === 'bottom-center' ? styles.selected : ''}`}
            onClick={() => setPosition('bottom-center')}>
            Centre
          </button>
          <button className={`${styles.toggleBtn} ${position === 'bottom-right' ? styles.selected : ''}`}
            onClick={() => setPosition('bottom-right')}>
            Right
          </button>
        </div>
      </div>
      <button className={styles.applyBtn} disabled={running}
        onClick={() => onRun({ op: 'pageNumbers', file: file.bytes, startAt, position })}>
        {running ? 'Adding…' : 'Add Numbers'}
      </button>
    </>
  )
}

const PANELS: Record<OpId, ComponentType<PanelProps>> = {
  merge:       MergePanel,
  split:       SplitPanel,
  extract:     ExtractPanel,
  remove:      RemovePanel,
  reorder:     ReorderPanel,
  rotate:      RotatePanel,
  compress:    CompressPanel,
  watermark:   WatermarkPanel,
  pageNumbers: PageNumbersPanel,
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

export function Toolbar() {
  const { file, updateBytes, pageCount, canUndo, undoSteps, undoLastOp, setAffectedPages } = useFileStore()
  const { editMode } = useEditStore()
  const [activeOp, setActiveOp] = useState<OpId | null>(null)
  const [running,  setRunning]  = useState(false)
  const [result,   setResult]   = useState<OpResult | null>(null)
  const [opError,  setOpError]  = useState<string | null>(null)

  const handleSelectOp = (id: OpId) => {
    setActiveOp(prev => prev === id ? null : id)
    setResult(null)
    setOpError(null)
    setAffectedPages(null)
  }

  const handleRun = async (req: PdfOpRequest) => {
    setRunning(true)
    setResult(null)
    setOpError(null)
    setAffectedPages(null)
    try {
      if (req.op === 'split') {
        const parts = await splitDocument(req.file, req.splitAfterPages)
        setResult({ kind: 'multi', parts })
      } else {
        const bytes = await runOp(req)
        updateBytes(bytes)
        setResult({ kind: 'single', bytes })
      }
    } catch (e) {
      setOpError(String(e).replace(/^Error:\s*/, ''))
    } finally {
      setRunning(false)
    }
  }

  if (!file) return null

  const Panel = activeOp ? PANELS[activeOp] : null

  return (
    <aside className={styles.sidebar} aria-label="PDF operations">
      <EditPanel />

      {editMode ? null : (
      <>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Operations</span>
        {canUndo && (
          <button className={styles.undoBtn}
            onClick={() => { undoLastOp(); setResult(null); setActiveOp(null) }}
            title={`${undoSteps} change${undoSteps === 1 ? '' : 's'} available to undo`}>
            ↩ Undo ({undoSteps})
          </button>
        )}
      </div>

      <div className={styles.opList}>
        {OPS.map(({ id, label, desc }) => (
          <button
            key={id}
            className={`${styles.opBtn} ${activeOp === id ? styles.opActive : ''}`}
            onClick={() => handleSelectOp(id)}
            aria-expanded={activeOp === id}
            aria-controls={activeOp === id ? 'op-panel' : undefined}
          >
            <span className={styles.opLabel}>{label}</span>
            <span className={styles.opDesc}>{desc}</span>
          </button>
        ))}
      </div>

      {Panel && (
        <div className={styles.panel} id="op-panel" aria-live="polite">
          <Panel
            file={file}
            running={running}
            pageCount={pageCount}
            onRun={handleRun}
            setAffected={setAffectedPages}
          />
          {opError && (
            <p className={styles.panelError} role="alert">{opError}</p>
          )}
          {result && (
            <ResultActions
              result={result}
              baseName={file.name}
              originalSize={file.bytes.length}
            />
          )}
          <button className={styles.cancelBtn}
            onClick={() => { setActiveOp(null); setResult(null); setOpError(null); setAffectedPages(null) }}>
            {result ? 'Close' : 'Cancel'}
          </button>
        </div>
      )}
      </>
      )}
    </aside>
  )
}
