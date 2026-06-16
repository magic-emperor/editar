import { useState, useCallback } from 'react'
import { openDocument, runOp, splitDocument } from '../../lib/pdfEngine'
import type { WatermarkPos } from '../../lib/pdfOps'
import styles from './EditPage.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function dl(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function parsePageRanges(input: string, count: number): number[] {
  const pages = new Set<number>()
  for (const part of input.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/)
    if (!m) continue
    const from = parseInt(m[1], 10)
    const to   = m[2] ? parseInt(m[2], 10) : from
    for (let p = from; p <= to && p <= count; p++) {
      if (p >= 1) pages.add(p - 1)
    }
  }
  return Array.from(pages).sort((a, b) => a - b)
}

// ── Op config ─────────────────────────────────────────────────────────────────

type OpId = 'merge' | 'split' | 'extract' | 'remove' | 'reorder' | 'rotate' | 'compress' | 'watermark' | 'pageNumbers'

const OP_META: Record<OpId, { label: string; note: string; multi?: boolean }> = {
  merge:       { label: 'Merge PDFs',       note: 'Combine multiple PDF files into a single document.',              multi: true },
  split:       { label: 'Split PDF',        note: 'Divide a PDF into separate files at chosen page boundaries.'                },
  extract:     { label: 'Extract Pages',    note: 'Save a subset of pages from a PDF as a new file.'                          },
  remove:      { label: 'Remove Pages',     note: 'Delete specific pages and download the remaining document.'                },
  reorder:     { label: 'Reorder Pages',    note: 'Rearrange pages into any new order you specify.'                           },
  rotate:      { label: 'Rotate Pages',     note: 'Rotate one, many, or all pages by 90°, 180°, or 270°.'                   },
  compress:    { label: 'Compress PDF',     note: 'Reduce file size using PDF object stream optimisation.'                    },
  watermark:   { label: 'Add Watermark',    note: 'Stamp text onto every page at a chosen position and opacity.'             },
  pageNumbers: { label: 'Add Page Numbers', note: 'Append page numbers to every page at the bottom.'                         },
}

// ── PdfInfo ───────────────────────────────────────────────────────────────────

interface PdfInfo { name: string; bytes: Uint8Array; pageCount: number }

// ── Sub-components ────────────────────────────────────────────────────────────

function DropZone({
  label, multi, onFiles,
}: {
  label: string; multi?: boolean
  onFiles: (files: File[]) => void
}) {
  const [over, setOver] = useState(false)

  const handleFiles = (fl: FileList | null) => {
    if (!fl?.length) return
    const arr = Array.from(fl).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (arr.length) onFiles(multi ? arr : [arr[0]])
  }

  return (
    <label
      className={`${styles.dz} ${over ? styles.dzOver : ''}`}
      onDragEnter={e => { e.preventDefault(); setOver(true) }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files) }}
    >
      <input type="file" accept=".pdf,application/pdf" multiple={multi} className={styles.hidden}
        onChange={e => { handleFiles(e.target.files); e.currentTarget.value = '' }} />
      <svg className={styles.dzIcon} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
      </svg>
      <span className={styles.dzPrimary}>{label}</span>
      <span className={styles.dzSub}>or click to browse</span>
    </label>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EditPage({ opId, onBack }: { opId: string; onBack: () => void }) {
  const op = OP_META[opId as OpId]

  // ── PDF state ──
  const [pdfs,      setPdfs]      = useState<PdfInfo[]>([])
  const [pdfError,  setPdfError]  = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)

  // ── Op options state ──
  const [pageRange,   setPageRange]   = useState('')          // split / extract / remove
  const [newOrder,    setNewOrder]    = useState('')          // reorder
  const [rotateAngle, setRotateAngle] = useState<90|180|270>(90)   // rotate
  const [rotatePages, setRotatePages] = useState<'all' | string>('all') // rotate — which pages
  const [wmText,      setWmText]      = useState('CONFIDENTIAL')
  const [wmPos,       setWmPos]       = useState<WatermarkPos>('diagonal')
  const [wmOpacity,   setWmOpacity]   = useState(0.3)
  const [pnStart,     setPnStart]     = useState(1)
  const [pnPos,       setPnPos]       = useState<'bottom-center' | 'bottom-right'>('bottom-center')

  // ── Run state ──
  const [running, setRunning] = useState(false)
  const [logs,    setLogs]    = useState<string[]>([])
  const [runErr,  setRunErr]  = useState<string | null>(null)
  const [done,    setDone]    = useState(false)

  const meta = op ?? { label: opId, note: '', multi: false }
  const isMulti = meta.multi ?? false
  const firstPdf = pdfs[0] ?? null

  // ── Load PDF(s) ───────────────────────────────────────────────────────────

  const loadPdfs = useCallback(async (files: File[]) => {
    setLoading(true); setPdfError(null); setLogs([]); setRunErr(null); setDone(false)
    try {
      const infos: PdfInfo[] = await Promise.all(files.map(async f => {
        const bytes = new Uint8Array(await f.arrayBuffer())
        const { pageCount } = await openDocument(bytes)
        return { name: f.name, bytes, pageCount }
      }))
      setPdfs(isMulti ? prev => [...prev, ...infos] : [infos[0]])
    } catch {
      setPdfError('Could not open a PDF. It may be damaged or password-protected.')
    } finally {
      setLoading(false)
    }
  }, [isMulti])

  const removePdf = (i: number) => setPdfs(p => p.filter((_, j) => j !== i))

  // ── Run operation ─────────────────────────────────────────────────────────

  const ts = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const log = (msg: string) => setLogs(prev => [...prev, `[${ts()}] ${msg}`])

  const run = async () => {
    if (!firstPdf && opId !== 'merge') return
    if (opId === 'merge' && pdfs.length < 2) return
    setRunning(true); setRunErr(null); setLogs([]); setDone(false)
    log(`Starting ${meta.label}…`)
    try {
      const stem = firstPdf?.name.replace(/\.pdf$/i, '') ?? 'merged'
      const pc   = firstPdf?.pageCount ?? 0

      if (opId === 'merge') {
        const merged = await runOp({ op: 'merge', files: pdfs.map(p => p.bytes) })
        log(`Done — ${fmtSize(merged.length)}`)
        dl(merged, 'merged.pdf'); setDone(true)

      } else if (opId === 'split') {
        const indices = pageRange.trim()
          ? pageRange.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(n => n >= 0 && n < pc - 1)
          : []
        if (!indices.length) { setRunErr('Enter at least one split point (e.g. "3" to split after page 3).'); return }
        log(`Splitting at indices: ${indices.join(', ')}`)
        const parts = await splitDocument(firstPdf!.bytes, indices)
        parts.forEach((p, i) => dl(p, `${stem}-part${i + 1}.pdf`))
        log(`Done — ${parts.length} file(s) downloaded`); setDone(true)

      } else if (opId === 'extract') {
        const pages = parsePageRanges(pageRange, pc)
        if (!pages.length) { setRunErr(`Enter a page range (e.g. "1-3, 5"). The PDF has ${pc} pages.`); return }
        log(`Extracting pages: ${pages.map(p => p + 1).join(', ')}`)
        const res = await runOp({ op: 'extract', file: firstPdf!.bytes, pages })
        log(`Done — ${fmtSize(res.length)}`); dl(res, `${stem}-extracted.pdf`); setDone(true)

      } else if (opId === 'remove') {
        const pages = parsePageRanges(pageRange, pc)
        if (!pages.length) { setRunErr(`Enter pages to remove (e.g. "2, 4-6"). The PDF has ${pc} pages.`); return }
        log(`Removing pages: ${pages.map(p => p + 1).join(', ')}`)
        const res = await runOp({ op: 'remove', file: firstPdf!.bytes, pages })
        log(`Done — ${fmtSize(res.length)}`); dl(res, `${stem}-removed.pdf`); setDone(true)

      } else if (opId === 'reorder') {
        const order = newOrder.split(',').map(s => parseInt(s.trim(), 10) - 1)
        if (order.length !== pc || order.some(n => n < 0 || n >= pc)) {
          setRunErr(`Enter all ${pc} page numbers in new order, e.g. "2, 1, 3" to swap pages 1 and 2.`); return
        }
        log(`Reordering to: ${order.map(n => n + 1).join(', ')}`)
        const res = await runOp({ op: 'reorder', file: firstPdf!.bytes, newOrder: order })
        log(`Done — ${fmtSize(res.length)}`); dl(res, `${stem}-reordered.pdf`); setDone(true)

      } else if (opId === 'rotate') {
        let bytes = firstPdf!.bytes
        const pagesToRotate = rotatePages === 'all'
          ? Array.from({ length: pc }, (_, i) => i)
          : parsePageRanges(rotatePages, pc)
        if (!pagesToRotate.length) { setRunErr('Specify which pages to rotate.'); return }
        log(`Rotating ${pagesToRotate.length === pc ? 'all' : pagesToRotate.length} page(s) by ${rotateAngle}°`)
        for (const idx of pagesToRotate) {
          bytes = await runOp({ op: 'rotate', file: bytes, pageIndex: idx, rotateDegrees: rotateAngle })
        }
        log(`Done — ${fmtSize(bytes.length)}`); dl(bytes, `${stem}-rotated.pdf`); setDone(true)

      } else if (opId === 'compress') {
        log('Compressing…')
        const res = await runOp({ op: 'compress', file: firstPdf!.bytes })
        const saved = firstPdf!.bytes.length - res.length
        log(`Done — saved ${fmtSize(Math.max(0, saved))} (${fmtSize(res.length)})`)
        dl(res, `${stem}-compressed.pdf`); setDone(true)

      } else if (opId === 'watermark') {
        if (!wmText.trim()) { setRunErr('Enter watermark text.'); return }
        log(`Adding watermark "${wmText}" at ${wmPos}, opacity ${wmOpacity}`)
        const res = await runOp({ op: 'watermark', file: firstPdf!.bytes, text: wmText, opacity: wmOpacity, position: wmPos })
        log(`Done — ${fmtSize(res.length)}`); dl(res, `${stem}-watermarked.pdf`); setDone(true)

      } else if (opId === 'pageNumbers') {
        log(`Adding page numbers starting at ${pnStart}, position: ${pnPos}`)
        const res = await runOp({ op: 'pageNumbers', file: firstPdf!.bytes, startAt: pnStart, position: pnPos })
        log(`Done — ${fmtSize(res.length)}`); dl(res, `${stem}-numbered.pdf`); setDone(true)
      }
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '')
      log(`✗ ${msg}`); setRunErr(msg)
    } finally {
      setRunning(false)
    }
  }

  const canRun = !running && (opId === 'merge' ? pdfs.length >= 2 : !!firstPdf)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>← Back to tools</button>
        <div className={styles.headerMeta}>
          <span className={styles.toolName}>{meta.label}</span>
          <span className={styles.toolNote}>{meta.note}</span>
        </div>
        <span className={styles.badge}>LOCAL</span>
      </header>

      <div className={styles.body}>
        {/* ── Upload column ── */}
        <section className={styles.col}>
          <h2 className={styles.secLabel}>{isMulti ? 'Upload PDFs' : 'Upload PDF'}</h2>

          {pdfs.length === 0 ? (
            <DropZone
              label={isMulti ? 'Drop PDFs here' : 'Drop your PDF here'}
              multi={isMulti}
              onFiles={loadPdfs}
            />
          ) : (
            <div className={styles.fileListWrap}>
              <ul className={styles.fileList}>
                {pdfs.map((p, i) => (
                  <li key={i} className={styles.fileRow}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.8">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className={styles.fileName}>{p.name}</span>
                    <span className={styles.fileMeta}>{p.pageCount}p · {fmtSize(p.bytes.length)}</span>
                    <button className={styles.removeBtn} onClick={() => removePdf(i)}>×</button>
                  </li>
                ))}
              </ul>
              {isMulti && (
                <label className={styles.addMoreBtn}>
                  <input type="file" accept=".pdf,application/pdf" multiple className={styles.hidden}
                    onChange={e => { if (e.target.files) loadPdfs(Array.from(e.target.files)); e.currentTarget.value = '' }} />
                  + Add more PDFs
                </label>
              )}
              {!isMulti && (
                <label className={styles.changeBtn}>
                  <input type="file" accept=".pdf,application/pdf" className={styles.hidden}
                    onChange={e => { if (e.target.files?.[0]) loadPdfs([e.target.files[0]]); e.currentTarget.value = '' }} />
                  Change file
                </label>
              )}
            </div>
          )}

          {loading && <p className={styles.hint}>Opening PDF…</p>}
          {pdfError && <p className={styles.errMsg}>{pdfError}</p>}
          {firstPdf && <p className={styles.hint}>{firstPdf.pageCount} page{firstPdf.pageCount !== 1 ? 's' : ''} detected</p>}
        </section>

        {/* ── Options + run column ── */}
        <section className={styles.col}>
          {/* ── Operation-specific options ── */}
          {(opId === 'split') && (
            <div className={styles.optBox}>
              <h2 className={styles.secLabel}>Split after page</h2>
              <input
                className={styles.textInput}
                placeholder={`e.g. "3, 7" — splits after page 3 and 7${firstPdf ? ` (${firstPdf.pageCount} pages)` : ''}`}
                value={pageRange}
                onChange={e => setPageRange(e.target.value)}
              />
              <p className={styles.optHint}>Enter comma-separated page numbers. "3" creates two files: pages 1–3 and 4–end.</p>
            </div>
          )}

          {(opId === 'extract' || opId === 'remove') && (
            <div className={styles.optBox}>
              <h2 className={styles.secLabel}>{opId === 'extract' ? 'Pages to extract' : 'Pages to remove'}</h2>
              <input
                className={styles.textInput}
                placeholder={`e.g. "1-3, 5, 8-10"${firstPdf ? ` (${firstPdf.pageCount} pages total)` : ''}`}
                value={pageRange}
                onChange={e => setPageRange(e.target.value)}
              />
            </div>
          )}

          {opId === 'reorder' && (
            <div className={styles.optBox}>
              <h2 className={styles.secLabel}>New page order</h2>
              <input
                className={styles.textInput}
                placeholder={firstPdf ? `e.g. "${Array.from({length: firstPdf.pageCount}, (_, i) => i + 1).reverse().join(', ')}" to reverse` : 'Enter all page numbers in new order'}
                value={newOrder}
                onChange={e => setNewOrder(e.target.value)}
              />
              <p className={styles.optHint}>
                {firstPdf ? `Enter all ${firstPdf.pageCount} page numbers in your desired order, comma-separated.` : 'Enter all page numbers in new order.'}
              </p>
            </div>
          )}

          {opId === 'rotate' && (
            <div className={styles.optBox}>
              <h2 className={styles.secLabel}>Rotation</h2>
              <div className={styles.optRow}>
                <span className={styles.optLabel}>Angle</span>
                <div className={styles.pills}>
                  {([90, 180, 270] as const).map(a => (
                    <button key={a} className={`${styles.pill} ${rotateAngle === a ? styles.pillOn : ''}`} onClick={() => setRotateAngle(a)}>
                      {a}°
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.optRow}>
                <span className={styles.optLabel}>Pages</span>
                <div className={styles.pills}>
                  <button className={`${styles.pill} ${rotatePages === 'all' ? styles.pillOn : ''}`} onClick={() => setRotatePages('all')}>
                    All pages
                  </button>
                  <button className={`${styles.pill} ${rotatePages !== 'all' ? styles.pillOn : ''}`} onClick={() => setRotatePages(rotatePages === 'all' ? '' : rotatePages)}>
                    Specific pages
                  </button>
                </div>
              </div>
              {rotatePages !== 'all' && (
                <input
                  className={styles.textInput}
                  placeholder={`e.g. "1, 3-5"${firstPdf ? ` (${firstPdf.pageCount} pages total)` : ''}`}
                  value={rotatePages}
                  onChange={e => setRotatePages(e.target.value)}
                />
              )}
            </div>
          )}

          {opId === 'watermark' && (
            <div className={styles.optBox}>
              <h2 className={styles.secLabel}>Watermark options</h2>
              <div className={styles.optRow}>
                <span className={styles.optLabel}>Text</span>
                <input className={styles.textInput} value={wmText} onChange={e => setWmText(e.target.value)} placeholder="Watermark text" style={{ flex: 1 }} />
              </div>
              <div className={styles.optRow}>
                <span className={styles.optLabel}>Position</span>
                <select className={styles.select} value={wmPos} onChange={e => setWmPos(e.target.value as WatermarkPos)}>
                  <option value="diagonal">Diagonal (centre)</option>
                  <option value="center">Centre</option>
                  <option value="top-left">Top left</option>
                  <option value="top-right">Top right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </div>
              <div className={styles.optRow}>
                <span className={styles.optLabel}>Opacity</span>
                <div className={styles.pills}>
                  {[{l:'Light', v:0.15}, {l:'Medium', v:0.3}, {l:'Strong', v:0.55}].map(o => (
                    <button key={o.v} className={`${styles.pill} ${wmOpacity === o.v ? styles.pillOn : ''}`} onClick={() => setWmOpacity(o.v)}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {opId === 'pageNumbers' && (
            <div className={styles.optBox}>
              <h2 className={styles.secLabel}>Page number options</h2>
              <div className={styles.optRow}>
                <span className={styles.optLabel}>Start at</span>
                <input
                  className={styles.textInput}
                  type="number" min={1} value={pnStart}
                  onChange={e => setPnStart(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: 80 }}
                />
              </div>
              <div className={styles.optRow}>
                <span className={styles.optLabel}>Position</span>
                <div className={styles.pills}>
                  <button className={`${styles.pill} ${pnPos === 'bottom-center' ? styles.pillOn : ''}`} onClick={() => setPnPos('bottom-center')}>Bottom centre</button>
                  <button className={`${styles.pill} ${pnPos === 'bottom-right'  ? styles.pillOn : ''}`} onClick={() => setPnPos('bottom-right')}>Bottom right</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Run button ── */}
          <button className={styles.runBtn} disabled={!canRun} onClick={run}>
            {running ? 'Processing…' : meta.label + ' →'}
          </button>

          {running && <div className={styles.progressBar}><div className={styles.progressFill} /></div>}

          {/* ── Terminal ── */}
          {logs.length > 0 && (
            <div className={styles.terminal}>
              {logs.map((l, i) => (
                <div key={i} className={`${styles.termLine} ${i === logs.length - 1 ? styles.termLast : ''}`}>{l}</div>
              ))}
            </div>
          )}

          {runErr && <p className={styles.errMsg}>{runErr}</p>}

          {done && (
            <div className={styles.doneBox}>
              ✓ {meta.label} complete — file downloaded automatically
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
