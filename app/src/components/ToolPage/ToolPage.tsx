import {
  useState, useCallback, useEffect, useRef,
  type DragEvent, type ChangeEvent,
} from 'react'
import { openDocument, closeDocument, renderPage } from '../../lib/pdfEngine'
import type { PageSize } from '../../lib/pdfEngine'
import { zipFiles } from '../../lib/zip'
import {
  CONVERTERS,
  type ConvertOptions, type ConvertResult,
} from '../../lib/converters/registry'
import { setOcrLanguage, getOcrLanguage } from '../../lib/ocr'
import { OCR_LANGUAGES } from '../../lib/constants'
import { clearTextLayerCache } from '../../lib/textLayer'
import styles from './ToolPage.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_SERVER = import.meta.env.VITE_API_URL ?? 'http://localhost:5050'

function dl(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

type PreviewKind = 'text' | 'image' | 'pdf' | 'none'

function previewKind(mime: string): PreviewKind {
  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv' || mime === 'application/json') return 'text'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  return 'none'
}

const DPI_OPTIONS  = [
  { label: '150 DPI', value: 150 },
  { label: '200 DPI', value: 200 },
  { label: '300 DPI', value: 300 },
]
const QUALITY_OPTS = [
  { label: 'SD',      value: 0.65 },
  { label: 'HD',      value: 0.82 },
  { label: 'Full HD', value: 0.95 },
]
const RESIZE_OPTS  = [
  { label: 'Original', value: null  as number | null },
  { label: '1920px',   value: 1920 },
  { label: '1280px',   value: 1280 },
  { label: '854px',    value: 854  },
]

// ── ToolPage ──────────────────────────────────────────────────────────────────

interface PdfInfo {
  docId:     string
  bytes:     Uint8Array
  name:      string
  pageCount: number
  pageSizes: PageSize[]
}

type ServerStatus = 'checking' | 'ok' | 'offline'

export function ToolPage({ toolId, onBack }: { toolId: string; onBack: () => void }) {
  const conv = CONVERTERS.find(c => c.id === toolId) ?? null

  // ── PDF state (for source: 'pdf' converters) ──
  const [pdfInfo,    setPdfInfo]    = useState<PdfInfo | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfDrag,    setPdfDrag]    = useState(false)
  const [pdfError,   setPdfError]   = useState<string | null>(null)

  // ── Image / file state (for source: 'images' converters) ──
  const [files,      setFiles]      = useState<File[]>([])
  const [fileDrag,   setFileDrag]   = useState(false)

  // ── Options ──
  const [dpi,        setDpi]        = useState(200)
  const [quality,    setQuality]    = useState(0.82)
  const [format,     setFormat]     = useState<'png' | 'jpg' | 'webp'>('png')
  const [maxDim,     setMaxDim]     = useState<number | null>(null)
  const [ocrLang,    setOcrLang]    = useState<string>(getOcrLanguage)

  // ── Run state ──
  const [running,   setRunning]    = useState(false)
  const [logs,      setLogs]       = useState<string[]>([])
  const [result,    setResult]     = useState<ConvertResult | null>(null)
  const [runError,  setRunError]   = useState<string | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null)

  // ── Server status (for cloud converters) ──
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking')

  useEffect(() => {
    if (conv?.kind !== 'cloud') return
    const check = () => {
      const ctrl = new AbortController()
      const tid  = setTimeout(() => ctrl.abort(), 2000)
      fetch(`${DEFAULT_SERVER}/health`, { signal: ctrl.signal })
        .then(r => setServerStatus(r.ok ? 'ok' : 'offline'))
        .catch(() => setServerStatus('offline'))
        .finally(() => clearTimeout(tid))
    }
    check()
    const id = setInterval(check, 4000)
    return () => clearInterval(id)
  }, [conv?.kind])

  // Cleanup openDocument handles when PDF changes or component unmounts
  useEffect(() => {
    return () => {
      if (pdfInfo?.docId) closeDocument(pdfInfo.docId)
    }
  }, [pdfInfo?.docId])

  // Render first-page thumbnail when a PDF is loaded
  const thumbRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!pdfInfo || !thumbRef.current) return
    const pageSize = pdfInfo.pageSizes[0]
    if (!pageSize) return
    const THUMB_W = 180
    const scale   = THUMB_W / (pageSize.width * (96 / 72))
    const { promise, cancel } = renderPage(pdfInfo.docId, 0, scale)
    promise.then(bitmap => {
      const canvas = thumbRef.current
      if (!canvas) return
      canvas.width  = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      bitmap.close()
    }).catch(() => {})
    return cancel
  }, [pdfInfo])

  // Build/revoke a Blob URL for the file currently being previewed (image/PDF kinds only)
  useEffect(() => {
    if (previewIndex === null || !result) { setPreviewUrl(null); return }
    const f = result.files[previewIndex]
    if (!f) { setPreviewUrl(null); return }
    const kind = previewKind(f.mime)
    if (kind !== 'image' && kind !== 'pdf') { setPreviewUrl(null); return }
    const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [previewIndex, result])

  // ── PDF loading ───────────────────────────────────────────────────────────

  const loadPdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Please choose a PDF file.'); return
    }
    // Close old document if any
    if (pdfInfo?.docId) closeDocument(pdfInfo.docId)
    setPdfLoading(true); setPdfError(null); setResult(null); setRunError(null); setLogs([])
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { docId, pageCount, pageSizes } = await openDocument(bytes)
      setPdfInfo({ docId, bytes, name: file.name, pageCount, pageSizes })
    } catch {
      setPdfError('Could not open this PDF. It may be damaged or password-protected.')
    } finally {
      setPdfLoading(false)
    }
  }, [pdfInfo?.docId])

  const onPdfInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (f) loadPdf(f)
  }
  const onPdfDragEnter = (e: DragEvent) => { e.preventDefault(); setPdfDrag(true) }
  const onPdfDragOver  = (e: DragEvent) => e.preventDefault()
  const onPdfDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setPdfDrag(false)
  }
  const onPdfDrop = (e: DragEvent) => {
    e.preventDefault(); setPdfDrag(false)
    const f = e.dataTransfer.files[0]; if (f) loadPdf(f)
  }

  // ── Image / file handling ─────────────────────────────────────────────────

  const addFiles = useCallback((fl: FileList | null) => {
    if (!fl?.length) return
    setFiles(prev => conv?.multi ? [...prev, ...Array.from(fl)] : [fl[0]])
    setResult(null); setRunError(null)
  }, [conv?.multi])

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files); e.target.value = ''
  }
  const onFileDragEnter = (e: DragEvent) => { e.preventDefault(); setFileDrag(true) }
  const onFileDragOver  = (e: DragEvent) => e.preventDefault()
  const onFileDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDrag(false)
  }
  const onFileDrop = (e: DragEvent) => {
    e.preventDefault(); setFileDrag(false); addFiles(e.dataTransfer.files)
  }

  // ── Run conversion ────────────────────────────────────────────────────────

  const ts = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const run = async () => {
    if (!conv?.run) return
    setRunning(true); setRunError(null); setResult(null); setLogs([]); setPreviewIndex(null)
    setLogs([`[${ts()}] Initialising ${conv.label}…`])
    try {
      if (conv.options.includes('ocrLanguage')) await setOcrLanguage(ocrLang)
      const opts: ConvertOptions = {
        scale: dpi / 72, quality, format, maxDim,
        serverUrl: DEFAULT_SERVER,
        onProgress: (_done, _total, msg) => {
          setLogs(prev => [...prev, `[${ts()}] ${msg}`])
        },
      }
      const input = conv.source === 'pdf'
        ? { pdf: pdfInfo! }
        : { files }
      const res = await conv.run(input, opts)
      setLogs(prev => [...prev, `[${ts()}] ✓ Done — ${res.files.length} file(s) ready.`])
      setResult(res)
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '')
      setLogs(prev => [...prev, `[${ts()}] ✗ ${msg}`])
      setRunError(msg)
    } finally {
      setRunning(false)
    }
  }

  const downloadAll = () => {
    if (!result) return
    if (result.files.length === 1) { const f = result.files[0]; dl(f.bytes, f.name, f.mime); return }
    const zip = zipFiles(result.files)
    dl(zip, (pdfInfo?.name.replace(/\.pdf$/i, '') ?? files[0]?.name.replace(/\.[^.]+$/, '') ?? 'converted') + '-files.zip', 'application/zip')
  }

  // ── Ready check ───────────────────────────────────────────────────────────

  const hasInput = conv?.source === 'pdf' ? !!pdfInfo : files.length > 0
  const cloudOk  = conv?.kind !== 'cloud' || serverStatus === 'ok'
  const canRun   = !running && hasInput && cloudOk && !!conv?.run

  // ── Options flags ─────────────────────────────────────────────────────────

  const showFormat   = conv?.options.includes('imageFormat')
  const showDpi      = conv?.options.includes('scale')
  const showQuality  = conv?.options.includes('quality') && (format === 'jpg' || format === 'webp')
  const showResize   = conv?.options.includes('resize')
  const showOcrLang  = conv?.options.includes('ocrLanguage')
  const hasOptions   = showFormat || showDpi || showQuality || showResize || showOcrLang

  if (!conv) {
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={onBack}>← Back</button>
        <p style={{ padding: '2rem' }}>Unknown tool: {toolId}</p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>

      {/* ── Header ── */}
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Back to tools">
          ← Back to tools
        </button>
        <div className={styles.headerMeta}>
          <span className={styles.toolName}>{conv.label}</span>
          <span className={styles.toolNote}>{conv.note}</span>
        </div>
        <div className={styles.headerBadges}>
          {conv.kind === 'cloud' && (
            <span className={`${styles.serverDot} ${serverStatus === 'ok' ? styles.dotGreen : serverStatus === 'offline' ? styles.dotRed : styles.dotYellow}`} />
          )}
          <span className={`${styles.badge} ${conv.kind === 'cloud' ? styles.badgeServer : styles.badgeLocal}`}>
            {conv.kind === 'cloud' ? 'SERVER' : 'LOCAL'}
          </span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className={styles.body}>

        {/* ── LEFT: Upload ── */}
        <section className={styles.uploadSection}>
          <h2 className={styles.sectionLabel}>
            {conv.source === 'pdf' ? 'Upload PDF' : 'Upload Files'}
          </h2>

          {conv.source === 'pdf' ? (
            // PDF upload drop zone
            <>
              <label
                className={`${styles.dropZone} ${pdfDrag ? styles.dropping : ''} ${pdfInfo ? styles.hasFile : ''}`}
                onDragEnter={onPdfDragEnter}
                onDragOver={onPdfDragOver}
                onDragLeave={onPdfDragLeave}
                onDrop={onPdfDrop}
              >
                <input
                  type="file" accept=".pdf,application/pdf"
                  className={styles.fileInput}
                  onChange={onPdfInputChange}
                />
                {pdfLoading ? (
                  <div className={styles.dzContent}>
                    <div className={styles.spinner} />
                    <span>Opening PDF…</span>
                  </div>
                ) : pdfInfo ? (
                  <div className={styles.dzContent}>
                    <div className={styles.thumbWrap}>
                      <canvas ref={thumbRef} className={styles.thumb} />
                    </div>
                    <div className={styles.fileDetails}>
                      <span className={styles.fileName}>{pdfInfo.name}</span>
                      <span className={styles.fileMeta}>{pdfInfo.pageCount} page{pdfInfo.pageCount !== 1 ? 's' : ''} · {fmtSize(pdfInfo.bytes.length)}</span>
                      <span className={styles.changeHint}>click to change</span>
                    </div>
                    <button
                      className={styles.removePdfBtn}
                      onClick={e => {
                        e.preventDefault(); e.stopPropagation()
                        if (pdfInfo?.docId) closeDocument(pdfInfo.docId)
                        setPdfInfo(null); setResult(null); setRunError(null); setLogs([]); setPreviewIndex(null)
                      }}
                      aria-label="Remove file"
                    >✕ Remove</button>
                  </div>
                ) : (
                  <div className={styles.dzContent}>
                    <div className={styles.dzIcon}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="12" y1="18" x2="12" y2="12"/>
                        <line x1="9" y1="15" x2="15" y2="15"/>
                      </svg>
                    </div>
                    <span className={styles.dzPrimary}>Drop your PDF here</span>
                    <span className={styles.dzSub}>or click to choose a file</span>
                  </div>
                )}
              </label>
              {pdfError && <p className={styles.inputError}>{pdfError}</p>}
            </>
          ) : (
            // Image / file upload
            <>
              <label
                className={`${styles.dropZone} ${fileDrag ? styles.dropping : ''} ${files.length > 0 ? styles.hasFile : ''}`}
                onDragEnter={onFileDragEnter}
                onDragOver={onFileDragOver}
                onDragLeave={onFileDragLeave}
                onDrop={onFileDrop}
              >
                <input
                  type="file"
                  accept={conv.accept ?? '*/*'}
                  multiple={conv.multi ?? false}
                  className={styles.fileInput}
                  onChange={onFileInputChange}
                />
                <div className={styles.dzContent}>
                  <div className={styles.dzIcon}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                  </div>
                  {files.length === 0 ? (
                    <>
                      <span className={styles.dzPrimary}>Drop {conv.multi ? 'files' : 'a file'} here</span>
                      <span className={styles.dzSub}>or click to browse</span>
                    </>
                  ) : (
                    <span className={styles.dzPrimary}>{files.length} file{files.length > 1 ? 's' : ''} selected — click to change</span>
                  )}
                </div>
              </label>

              {files.length > 0 && (
                <ul className={styles.fileList}>
                  {files.map((f, i) => (
                    <li key={i} className={styles.fileRow}>
                      <span className={styles.fileRowName}>{f.name}</span>
                      <span className={styles.fileRowSize}>{fmtSize(f.size)}</span>
                      <button className={styles.removeBtn} onClick={() => setFiles(p => p.filter((_, j) => j !== i))} aria-label="Remove">×</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* ── Server offline warning ── */}
          {conv.kind === 'cloud' && serverStatus === 'offline' && (
            <div className={styles.serverWarning}>
              Local server not running — start <code>server/start.bat</code> first.
            </div>
          )}
        </section>

        {/* ── RIGHT: Options + Run + Output ── */}
        <section className={styles.actionSection}>

          {hasOptions && (
            <div className={styles.optionsBox}>
              <h2 className={styles.sectionLabel}>Options</h2>

              {showFormat && (
                <div className={styles.optRow}>
                  <span className={styles.optLabel}>Format</span>
                  <div className={styles.pills}>
                    {(['png', 'jpg', 'webp'] as const).filter(f => conv.source === 'pdf' ? f !== 'webp' : true).map(f => (
                      <button key={f} className={`${styles.pill} ${format === f ? styles.pillActive : ''}`} onClick={() => setFormat(f)}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showDpi && (
                <div className={styles.optRow}>
                  <span className={styles.optLabel}>Resolution</span>
                  <div className={styles.pills}>
                    {DPI_OPTIONS.map(o => (
                      <button key={o.value} className={`${styles.pill} ${dpi === o.value ? styles.pillActive : ''}`} onClick={() => setDpi(o.value)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showQuality && (
                <div className={styles.optRow}>
                  <span className={styles.optLabel}>Quality</span>
                  <div className={styles.pills}>
                    {QUALITY_OPTS.map(o => (
                      <button key={o.value} className={`${styles.pill} ${quality === o.value ? styles.pillActive : ''}`} onClick={() => setQuality(o.value)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showResize && (
                <div className={styles.optRow}>
                  <span className={styles.optLabel}>Max size</span>
                  <div className={styles.pills}>
                    {RESIZE_OPTS.map(o => (
                      <button key={String(o.value)} className={`${styles.pill} ${maxDim === o.value ? styles.pillActive : ''}`} onClick={() => setMaxDim(o.value)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showOcrLang && (
                <div className={styles.optRow}>
                  <span className={styles.optLabel}>OCR Language</span>
                  <select
                    className={styles.ocrSelect}
                    value={ocrLang}
                    onChange={async e => {
                      const lang = e.target.value
                      setOcrLang(lang)
                      await setOcrLanguage(lang)
                      if (pdfInfo?.docId) clearTextLayerCache(pdfInfo.docId)
                    }}
                    aria-label="OCR language"
                  >
                    {OCR_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* ── Run button ── */}
          <button
            className={styles.runBtn}
            disabled={!canRun}
            onClick={run}
          >
            {running ? (
              <><span className={styles.spinner} /> Converting…</>
            ) : (
              `Convert →`
            )}
          </button>

          {/* ── Progress bar ── */}
          {running && (
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: '100%', animation: 'indeterminate 1.4s ease infinite' }} />
            </div>
          )}

          {/* ── Terminal log ── */}
          {logs.length > 0 && (
            <div className={styles.terminal}>
              {logs.map((line, i) => (
                <div key={i} className={`${styles.termLine} ${i === logs.length - 1 ? styles.termLineLast : ''}`}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* ── Error ── */}
          {runError && (
            <div className={styles.runError}>{runError}</div>
          )}

          {/* ── Result / download ── */}
          {result && (
            <div className={styles.resultBox}>
              <p className={styles.resultTitle}>
                {result.files.length === 1 ? 'Conversion complete' : `${result.files.length} files ready`}
              </p>
              <div className={styles.resultFiles}>
                {result.files.map((f, i) => {
                  const kind = previewKind(f.mime)
                  const open = previewIndex === i
                  return (
                    <div key={i}>
                      <div className={styles.resultFile}>
                        <span className={styles.resultFileName}>{f.name}</span>
                        <span className={styles.resultFileSize}>{fmtSize(f.bytes.length)}</span>
                        {kind !== 'none' && (
                          <button
                            className={styles.previewBtn}
                            onClick={() => setPreviewIndex(open ? null : i)}
                          >{open ? '✕ Close' : '👁 Preview'}</button>
                        )}
                        <button className={styles.resultDl} onClick={() => dl(f.bytes, f.name, f.mime)}>↓ Download</button>
                      </div>
                      {open && (
                        <div className={styles.previewPanel}>
                          {kind === 'text' && (
                            <pre className={styles.previewText}>{new TextDecoder().decode(f.bytes)}</pre>
                          )}
                          {kind === 'image' && previewUrl && (
                            <img className={styles.previewImg} src={previewUrl} alt={f.name} />
                          )}
                          {kind === 'pdf' && previewUrl && (
                            <iframe className={styles.previewFrame} src={previewUrl} title={f.name} />
                          )}
                          {kind === 'none' && (
                            <p className={styles.previewNone}>Preview not available for this file type — download to view.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {result.files.length > 1 && (
                <button className={styles.downloadAllBtn} onClick={downloadAll}>
                  ↓ Download all as ZIP
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
