import {
  useEffect, useMemo, useState, useCallback,
  type DragEvent, type ChangeEvent,
} from 'react'
import { useFileStore } from '../../lib/fileStore'
import { openDocument, renderPage, closeDocument } from '../../lib/pdfEngine'
import { zipFiles } from '../../lib/zip'
import {
  CONVERTERS,
  type Converter, type ConvertResult, type ConvertOptions,
} from '../../lib/converters/registry'
import { TRANSLATE_SOURCE_LANGS, TRANSLATE_TARGET_LANGS } from '../../lib/constants'
import styles from './ConvertHub.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* silent */ }
}

// ── Presets ───────────────────────────────────────────────────────────────────

const DPI_OPTIONS = [
  { label: '150 DPI', value: 150, hint: 'Screen' },
  { label: '200 DPI', value: 200, hint: 'Standard' },
  { label: '300 DPI', value: 300, hint: 'Print' },
]
const QUALITY_PRESETS = [
  { label: 'SD',      value: 0.65, hint: 'Smaller file' },
  { label: 'HD',      value: 0.82, hint: 'Balanced' },
  { label: 'Full HD', value: 0.95, hint: 'Best quality' },
]
const RESIZE_PRESETS = [
  { label: 'Original', value: null as number | null, hint: 'No resize' },
  { label: 'Full HD',  value: 1920,                  hint: '1920px max' },
  { label: 'HD',       value: 1280,                  hint: '1280px max' },
  { label: 'SD',       value: 854,                   hint: '854px max' },
]

const DEFAULT_SERVER = import.meta.env.VITE_API_URL ?? 'http://localhost:5050'
const CONSENT_KEY    = 'ld_cloud_consent_dismissed'

// ── Sub-components ────────────────────────────────────────────────────────────

function FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  if (!url) return <span className={styles.thumbPlaceholder}>🖼</span>
  return <img src={url} className={styles.thumb} alt="" />
}

// Renders the first page of a PDF via the engine (avoids iframe/CSP issues)
function PdfPagePreview({ bytes }: { bytes: Uint8Array }) {
  const [imgUrl,   setImgUrl]   = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [lightbox, setLightbox] = useState(false)

  useEffect(() => {
    let cancelled = false
    let openedId: string | null = null

    openDocument(bytes)
      .then(async ({ docId }) => {
        openedId = docId
        if (cancelled) return
        const bmp = await renderPage(docId, 0, 1.5).promise
        if (cancelled) { bmp.close(); return }
        const canvas = document.createElement('canvas')
        canvas.width = bmp.width; canvas.height = bmp.height
        canvas.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
        if (!cancelled) setImgUrl(canvas.toDataURL('image/png'))
      })
      .catch(() => { /* preview unavailable */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => {
      cancelled = true
      if (openedId) closeDocument(openedId)
    }
  }, [bytes])

  if (loading) return <p className={styles.previewLoading}>Rendering preview…</p>
  if (!imgUrl)  return <p className={styles.previewLoading}>Preview unavailable</p>

  return (
    <>
      <img
        src={imgUrl} alt="PDF preview (page 1)"
        className={styles.pdfPageImg}
        onClick={() => setLightbox(true)}
      />
      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(false)}>
          <img src={imgUrl} className={styles.lightboxImg} alt="Full size"
            onClick={e => e.stopPropagation()} />
          <button className={styles.lightboxClose} onClick={() => setLightbox(false)}>×</button>
        </div>
      )}
    </>
  )
}

// Renders a DOCX as HTML using mammoth.js (loaded lazily)
function DocxPreview({ bytes }: { bytes: Uint8Array }) {
  const [html,    setHtml]    = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // bytes.slice(0) ensures a clean ArrayBuffer (avoids shared-buffer offset issues)
    const buf = bytes.slice(0).buffer
    import('mammoth').then(async mod => {
      const m = (mod as unknown as { default: typeof import('mammoth') }).default ?? mod
      const res = await m.convertToHtml({ arrayBuffer: buf })
      setHtml(res.value)
    }).catch(() => setHtml(null)).finally(() => setLoading(false))
  }, [bytes])

  if (loading) return <p className={styles.previewLoading}>Rendering Word preview…</p>
  if (!html)   return <p className={styles.previewLoading}>Preview unavailable</p>

  return (
    <div
      className={styles.docxPreview}
      // Safe: HTML comes from user's own local file; CSP blocks any injected scripts
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ResultPreview({ result }: { result: ConvertResult }) {
  const [urls,     setUrls]     = useState<string[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    const made = result.files.map(f =>
      URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
    )
    setUrls(made)
    return () => made.forEach(u => URL.revokeObjectURL(u))
  }, [result])

  const mime = result.files[0]?.mime ?? ''

  if (mime === 'application/pdf' && result.files[0]) {
    return (
      <div className={styles.previewBox}>
        <p className={styles.previewLabel}>Preview — page 1 · click to enlarge</p>
        <PdfPagePreview bytes={result.files[0].bytes} />
      </div>
    )
  }

  // Word — render with mammoth
  if (mime.includes('wordprocessingml') && result.files[0]) {
    return (
      <div className={styles.previewBox}>
        <p className={styles.previewLabel}>Preview — Word document</p>
        <DocxPreview bytes={result.files[0].bytes} />
      </div>
    )
  }

  // Other Office formats — no visual preview
  if (mime.includes('officedocument') || mime.includes('opendocument')) {
    return null
  }

  if (mime === 'text/plain' && result.files[0]) {
    const text = new TextDecoder().decode(result.files[0].bytes)
    return (
      <div className={styles.previewBox}>
        <p className={styles.previewLabel}>Preview</p>
        <pre className={styles.textFrame}>
          {text.length > 4000 ? text.slice(0, 4000) + '\n…' : text}
        </pre>
      </div>
    )
  }

  if (urls.length > 0) {
    return (
      <>
        <div className={styles.previewBox}>
          <p className={styles.previewLabel}>
            Preview — {urls.length} image{urls.length !== 1 ? 's' : ''}
            <span className={styles.previewHint}> · click to enlarge</span>
          </p>
          <div className={styles.imgGrid}>
            {urls.map((u, i) => (
              <div key={i} className={styles.imgGridItem} onClick={() => setLightbox(u)}>
                <img src={u} alt={`Output ${i + 1}`} className={styles.imgGridThumb} />
                {urls.length > 1 && (
                  <span className={styles.imgGridLabel}>Page {i + 1}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {lightbox && (
          <div className={styles.lightbox} onClick={() => setLightbox(null)}>
            <img src={lightbox} className={styles.lightboxImg} alt="Full size"
              onClick={e => e.stopPropagation()} />
            <button className={styles.lightboxClose} onClick={() => setLightbox(null)}>×</button>
          </div>
        )}
      </>
    )
  }

  return null
}

// ── Server status dot ─────────────────────────────────────────────────────────

type ServerStatus = 'checking' | 'ok' | 'offline'

function StatusDot({ status }: { status: ServerStatus }) {
  const label = status === 'ok' ? 'Server online' : status === 'offline' ? 'Server offline' : 'Checking…'
  return <span className={`${styles.serverDot} ${styles[`dot_${status}`]}`} title={label} />
}

// ── Offline setup block ───────────────────────────────────────────────────────

function ServerSetup({ serverUrl }: { serverUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (text: string, key: string) => {
    await copyText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1800)
  }

  const installCmd = 'pip install -r requirements.txt'
  const startCmd   = `uvicorn main:app --host 127.0.0.1 --port 5050`

  return (
    <div className={styles.setupBlock}>
      <p className={styles.setupTitle}>Start the conversion server</p>
      <p className={styles.setupNote}>
        Office ↔ PDF conversions run in a small local server — your files never leave this machine.
      </p>
      <ol className={styles.setupSteps}>
        <li>
          <span className={styles.setupLabel}>Install dependencies (once)</span>
          <div className={styles.codeRow}>
            <code className={styles.code}>cd server &amp;&amp; {installCmd}</code>
            <button className={styles.copyBtn} onClick={() => copy(`cd server && ${installCmd}`, 'install')}>
              {copied === 'install' ? '✓' : 'Copy'}
            </button>
          </div>
        </li>
        <li>
          <span className={styles.setupLabel}>Start the server</span>
          <div className={styles.codeRow}>
            <code className={styles.code}>cd server &amp;&amp; {startCmd}</code>
            <button className={styles.copyBtn} onClick={() => copy(`cd server && ${startCmd}`, 'start')}>
              {copied === 'start' ? '✓' : 'Copy'}
            </button>
          </div>
        </li>
        <li>
          <span className={styles.setupLabel}>Or double-click <strong>server/start.bat</strong> (Windows)</span>
        </li>
      </ol>
      <p className={styles.setupNote}>
        Listening at <code>{serverUrl}</code> · LibreOffice needed for Excel→PDF.
      </p>
    </div>
  )
}

// ── Conversion history entry ──────────────────────────────────────────────────

interface HistoryEntry {
  id:        string
  label:     string
  fileName:  string
  timestamp: string
  fileCount: number
}

// ── Main component ────────────────────────────────────────────────────────────

export function ConvertHub({ onClose, initialConverterId }: {
  onClose: () => void
  initialConverterId?: string
}) {
  const {
    file, docId, pageCount,
    openFile, setDocId: storeSetDocId, setPageCount: storeSetPageCount,
  } = useFileStore()

  const [selected,      setSelected]      = useState<string | null>(initialConverterId ?? null)
  const [files,         setFiles]         = useState<File[]>([])
  const [dpi,           setDpi]           = useState(200)
  const [quality,       setQuality]       = useState(0.82)
  const [format,        setFormat]        = useState<'png' | 'jpg' | 'webp'>('png')
  const [maxDim,        setMaxDim]        = useState<number | null>(null)
  const [running,       setRunning]       = useState(false)
  const [progress,      setProgress]      = useState<{ done: number; total: number; msg: string } | null>(null)
  const [terminalLogs,  setTerminalLogs]  = useState<string[]>([])
  const [result,        setResult]        = useState<ConvertResult | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [dragOver,      setDragOver]      = useState(false)
  const [pdfDrag,       setPdfDrag]       = useState(false)
  const [pdfLoading,    setPdfLoading]    = useState(false)
  const [pdfError,      setPdfError]      = useState<string | null>(null)
  const [serverUrl,     setServerUrl]     = useState(DEFAULT_SERVER)
  const [serverStatus,  setServerStatus]  = useState<ServerStatus>('checking')
  const [faithfulLayout, setFaithfulLayout] = useState(false)
  const [sourceLang,    setSourceLang]    = useState('auto')
  const [targetLang,    setTargetLang]    = useState('en')
  const [consentHidden, setConsentHidden] = useState(
    () => sessionStorage.getItem(CONSENT_KEY) === '1'
  )
  const [history,       setHistory]       = useState<HistoryEntry[]>([])

  // ── Server health ping — polls every 3 s so the dot turns green automatically ──

  useEffect(() => {
    setServerStatus('checking')

    const check = () => {
      const ctrl = new AbortController()
      const tid  = setTimeout(() => ctrl.abort(), 2000)
      fetch(`${serverUrl}/health`, { signal: ctrl.signal })
        .then(r => setServerStatus(r.ok ? 'ok' : 'offline'))
        .catch(() => setServerStatus('offline'))
        .finally(() => clearTimeout(tid))
    }

    check()                                    // immediate check on mount / url change
    const interval = setInterval(check, 3000)  // re-check every 3 s
    return () => clearInterval(interval)
  }, [serverUrl])

  const conv     = useMemo(() => CONVERTERS.find(c => c.id === selected) ?? null, [selected])
  const pdfReady = !!(file && docId)

  const groups = useMemo(() => ({
    pdf:    CONVERTERS.filter(c => c.kind === 'local' && c.source === 'pdf'),
    images: CONVERTERS.filter(c => c.kind === 'local' && c.source === 'images'),
    cloud:  CONVERTERS.filter(c => c.kind === 'cloud'),
  }), [])

  // ── Converter selection ─────────────────────────────────────────────────────

  const pick = (c: Converter) => {
    setSelected(c.id); setFiles([]); setResult(null); setError(null); setTerminalLogs([])
    setFormat(c.source === 'pdf' ? 'png' : (c.id === 'img2img' ? 'jpg' : 'png'))
    setMaxDim(null)
  }

  // ── Image file handling ─────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming || !incoming.length) return
    setFiles(prev => [...prev, ...Array.from(incoming)])
    setResult(null); setError(null)
  }, [])

  const removeFile = (i: number) =>
    setFiles(prev => prev.filter((_, j) => j !== i))

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files); e.target.value = ''
  }

  const onDragEnter = (e: DragEvent) => { e.preventDefault(); setDragOver(true) }
  const onDragOver  = (e: DragEvent) => e.preventDefault()
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files)
  }

  // ── PDF loading for PDF-source converters ───────────────────────────────────

  const loadPdf = async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Please choose a PDF file.'); return
    }
    setPdfLoading(true); setPdfError(null)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      await openFile(f)
      const { docId: id, pageCount: n } = await openDocument(bytes)
      storeSetDocId(id)
      storeSetPageCount(n)
    } catch {
      setPdfError('Could not open this PDF.')
    } finally {
      setPdfLoading(false)
    }
  }

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

  // ── Conversion ──────────────────────────────────────────────────────────────

  const formatChoices: ('png' | 'jpg' | 'webp')[] =
    conv?.source === 'pdf' ? ['png', 'jpg'] : ['png', 'jpg', 'webp']

  const showQuality = conv?.options.includes('quality') && (format === 'jpg' || format === 'webp')
  const showResize  = conv?.options.includes('resize')
  const isCloud     = conv?.kind === 'cloud'
  const cloudReady  = isCloud && serverStatus === 'ok'

  const run = async () => {
    if (!conv?.run) return
    setRunning(true); setError(null); setResult(null); setProgress(null); setTerminalLogs([])
    const ts = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setTerminalLogs([`[${ts()}] Initialising ${conv.label} pipeline…`])
    try {
      const opts: ConvertOptions = {
        scale: dpi / 72, quality, format, maxDim, serverUrl,
        useServer: conv.id === 'pdf2word' && faithfulLayout && serverStatus === 'ok',
        sourceLang, targetLang,
        onProgress: (done, total, msg) => {
          setProgress({ done, total, msg })
          setTerminalLogs(prev => [...prev, `[${ts()}] ${msg}`])
        },
      }
      const input = conv.source === 'pdf'
        ? { pdf: { docId: docId!, bytes: file!.bytes, name: file!.name, pageCount } }
        : { files }
      const res = await conv.run(input, opts)
      setTerminalLogs(prev => [...prev, `[${ts()}] ✓ Done — ${res.files.length} file(s) ready.`])
      setResult(res)
      // Record in history (keep last 5)
      const entry: HistoryEntry = {
        id:        `h-${Date.now()}`,
        label:     conv.label,
        fileName:  res.files[0]?.name ?? 'result',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fileCount: res.files.length,
      }
      setHistory(prev => [entry, ...prev].slice(0, 5))
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '')
      setTerminalLogs(prev => [...prev, `[${ts()}] ✗ Error: ${msg}`])
      setError(msg)
    } finally {
      setRunning(false); setProgress(null)
    }
  }

  const downloadAll = () => {
    if (!result) return
    if (result.files.length === 1) {
      const f = result.files[0]; dl(f.bytes, f.name, f.mime); return
    }
    const zip = zipFiles(result.files)
    dl(zip, (file?.name.replace(/\.pdf$/i, '') ?? 'converted') + '-files.zip', 'application/zip')
  }

  const localReady  = !isCloud && !running &&
    (conv?.source === 'pdf' ? pdfReady : (files.length > 0))
  const canRun      = !!(conv?.run && (isCloud ? cloudReady && (conv.source === 'pdf' ? pdfReady : files.length > 0) : localReady))

  const dismissConsent = () => {
    sessionStorage.setItem(CONSENT_KEY, '1')
    setConsentHidden(true)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onClose}>← Back</button>
        <div className={styles.topBarBrand}>
          <span className={styles.topBarLogo}>L</span>
          <div>
            <span className={styles.pageTitle}>Format Converter</span>
            <span className={styles.pageSubtitle}>On-device · Nothing leaves your machine</span>
          </div>
        </div>
        <span className={styles.privacy}>🔒 100% local</span>
      </div>

      <div className={styles.body}>
        {/* ── Sidebar ── */}
        <nav className={styles.list}>
          <p className={styles.groupLabel}>From this PDF</p>
          {groups.pdf.map(c => (
            <button key={c.id}
              className={`${styles.item} ${selected === c.id ? styles.itemActive : ''}`}
              onClick={() => pick(c)}>
              {c.label}
              {!pdfReady && <span className={styles.itemHint}> — load PDF</span>}
            </button>
          ))}

          <p className={styles.groupLabel}>From images</p>
          {groups.images.map(c => (
            <button key={c.id}
              className={`${styles.item} ${selected === c.id ? styles.itemActive : ''}`}
              onClick={() => pick(c)}>
              {c.label}
            </button>
          ))}

          <p className={styles.groupLabel}>
            Local server
            <StatusDot status={serverStatus} />
          </p>
          {groups.cloud.map(c => (
            <button key={c.id}
              className={`${styles.item} ${selected === c.id ? styles.itemActive : ''} ${serverStatus === 'offline' ? styles.itemCloud : ''}`}
              onClick={() => pick(c)}
              title={serverStatus === 'offline' ? 'Conversion server not running' : ''}>
              {c.label}
            </button>
          ))}
        </nav>

        {/* ── Main panel ── */}
        <div className={styles.panel}>
          {!conv && (
            <div className={styles.emptyState}>
              <p className={styles.emptyIcon}>⚡</p>
              <p className={styles.emptyTitle}>Pick a converter</p>
              <p className={styles.emptyNote}>Select any format from the left to get started.</p>
              {history.length > 0 && (
                <div className={styles.historyCard}>
                  <p className={styles.historyTitle}>Recent conversions</p>
                  {history.map(h => (
                    <div key={h.id} className={styles.historyRow}>
                      <span className={styles.historyLabel}>{h.label}</span>
                      <span className={styles.historyFile}>{h.fileName}</span>
                      <span className={styles.historyTime}>{h.timestamp}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {conv && (
            <div className={styles.converterCard}>
              <h2 className={styles.panelTitle}>{conv.label}</h2>
              {conv.note && <p className={styles.note}>{conv.note}</p>}

              {/* ── Cloud consent banner ── */}
              {isCloud && !consentHidden && (
                <div className={styles.consentBanner}>
                  <span className={styles.consentText}>
                    📡 This conversion uploads your file to your local server at{' '}
                    <code>{serverUrl}</code>. Files are deleted immediately after conversion.
                    Nothing leaves your machine.
                  </span>
                  <button className={styles.consentDismiss} onClick={dismissConsent}>
                    Got it
                  </button>
                </div>
              )}

              {/* ── Server URL — always shown for cloud converters ── */}
              {isCloud && (
                <div className={styles.serverUrlRow}>
                  <span className={styles.fieldLabel}>Server</span>
                  <input
                    className={styles.serverUrlInput}
                    value={serverUrl}
                    onChange={e => setServerUrl(e.target.value.trim())}
                    placeholder="http://localhost:5050"
                    spellCheck={false}
                  />
                  {serverStatus !== 'ok' && (
                    <button className={styles.retryBtn}
                      onClick={() => setServerUrl((u: string) => u)}
                      title="Re-check server">
                      ↺
                    </button>
                  )}
                  {serverStatus === 'offline' && (
                    <span className={styles.serverOfflineHint}>
                      Try <code>http://127.0.0.1:5050</code> if localhost doesn't connect
                    </span>
                  )}
                </div>
              )}

              {/* ── Cloud offline: show setup instructions ── */}
              {isCloud && serverStatus === 'offline' && (
                <ServerSetup serverUrl={serverUrl} />
              )}

              {/* ── PDF loader (PDF-source converter, no PDF yet) ── */}
              {conv.source === 'pdf' && !pdfReady && (
                <label
                  className={`${styles.dropZone} ${pdfDrag ? styles.dragOver : ''}`}
                  onDragEnter={onPdfDragEnter}
                  onDragOver={onPdfDragOver}
                  onDragLeave={onPdfDragLeave}
                  onDrop={onPdfDrop}
                >
                  <input
                    type="file" accept=".pdf,application/pdf"
                    className={styles.hiddenInput}
                    onChange={onPdfInputChange}
                    disabled={pdfLoading}
                  />
                  <span className={styles.dropIcon}>📄</span>
                  <span className={styles.dropPrimary}>
                    {pdfLoading ? 'Loading PDF…' : 'Drop a PDF here or click to load'}
                  </span>
                  {pdfError && <span className={styles.dropError}>{pdfError}</span>}
                </label>
              )}

              {/* ── PDF loaded badge ── */}
              {conv.source === 'pdf' && pdfReady && (
                <div className={styles.pdfLoaded}>📄 {file!.name}</div>
              )}

              {/* ── PDF→Word: optional faithful-layout opt-in (server, consented) ── */}
              {conv.id === 'pdf2word' && pdfReady && serverStatus === 'ok' && (
                <>
                  <label className={styles.faithfulToggle}>
                    <input
                      type="checkbox"
                      checked={faithfulLayout}
                      onChange={e => setFaithfulLayout(e.target.checked)}
                    />
                    <span>
                      Use faithful layout for digital PDFs
                      <span className={styles.faithfulHint}> — sends to your local server</span>
                    </span>
                  </label>
                  {faithfulLayout && (
                    <div className={styles.consentBanner}>
                      <span className={styles.consentText}>
                        📡 Digital PDFs will be sent to your local server at <code>{serverUrl}</code> for
                        pixel-faithful layout. Files are deleted immediately. Scanned pages are still
                        OCR’d locally and never uploaded.
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* ── Translate PDF: language selectors ── */}
              {conv.options.includes('sourceLang') && pdfReady && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Source language</span>
                  <select
                    className={styles.select}
                    value={sourceLang}
                    onChange={e => setSourceLang(e.target.value)}
                  >
                    {TRANSLATE_SOURCE_LANGS.map(l => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {conv.options.includes('targetLang') && pdfReady && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Translate to</span>
                  <select
                    className={styles.select}
                    value={targetLang}
                    onChange={e => setTargetLang(e.target.value)}
                  >
                    {TRANSLATE_TARGET_LANGS.map(l => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* ── Image drop zone (local image converters + cloud Office→PDF) ── */}
              {conv.source === 'images' && (!isCloud || serverStatus === 'ok') && (
                <label
                  className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''} ${files.length > 0 ? styles.dropZoneCompact : ''}`}
                  onDragEnter={onDragEnter}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  <input
                    type="file"
                    accept={conv.accept}
                    multiple={conv.multi}
                    className={styles.hiddenInput}
                    onChange={onInputChange}
                  />
                  <span className={styles.dropIcon}>📂</span>
                  <span className={styles.dropPrimary}>
                    {files.length > 0 ? 'Add more files' : 'Drop files here or click to browse'}
                  </span>
                  {!isCloud && (
                    <span className={styles.dropSub}>PNG · JPG · JPEG · WebP · and more</span>
                  )}
                  {isCloud && (
                    <span className={styles.dropSub}>
                      {conv.id === 'docx2pdf' ? '.docx · .doc' : '.xlsx · .xls'}
                    </span>
                  )}
                </label>
              )}

              {/* ── File list ── */}
              {files.length > 0 && (
                <div className={styles.fileList}>
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className={styles.fileRow}>
                      {!isCloud && <FileThumb file={f} />}
                      {isCloud && <span className={styles.thumbPlaceholder}>📄</span>}
                      <div className={styles.fileMeta}>
                        <span className={styles.fileName}>{f.name}</span>
                        <span className={styles.fileSize}>{fmtSize(f.size)}</span>
                      </div>
                      <button className={styles.removeBtn} onClick={() => removeFile(i)} aria-label="Remove">×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Options — shown once PDF loaded (or image/cloud-online) ── */}
              {(conv.source !== 'pdf' || pdfReady) && (!isCloud || serverStatus === 'ok') && (
                <>
                  {conv.options.includes('imageFormat') && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Output Format</span>
                      <div className={styles.toggleGroup}>
                        {formatChoices.map(f => (
                          <button key={f}
                            className={`${styles.toggle} ${format === f ? styles.on : ''}`}
                            onClick={() => setFormat(f)}>
                            {f.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {conv.options.includes('scale') && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Resolution</span>
                      <div className={styles.toggleGroup}>
                        {DPI_OPTIONS.map(d => (
                          <button key={d.value}
                            className={`${styles.toggle} ${styles.toggleTall} ${dpi === d.value ? styles.on : ''}`}
                            onClick={() => setDpi(d.value)}>
                            <span className={styles.toggleMain}>{d.label}</span>
                            <span className={styles.toggleSub}>{d.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {showQuality && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Quality</span>
                      <div className={styles.toggleGroup}>
                        {QUALITY_PRESETS.map(p => (
                          <button key={p.label}
                            className={`${styles.toggle} ${styles.toggleTall} ${quality === p.value ? styles.on : ''}`}
                            onClick={() => setQuality(p.value)}>
                            <span className={styles.toggleMain}>{p.label}</span>
                            <span className={styles.toggleSub}>{p.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {showResize && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Resize</span>
                      <div className={styles.toggleGroup}>
                        {RESIZE_PRESETS.map(p => (
                          <button key={String(p.value)}
                            className={`${styles.toggle} ${styles.toggleTall} ${maxDim === p.value ? styles.on : ''}`}
                            onClick={() => setMaxDim(p.value)}>
                            <span className={styles.toggleMain}>{p.label}</span>
                            <span className={styles.toggleSub}>{p.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button className={styles.runBtn} disabled={!canRun} onClick={run}>
                    {running ? 'Converting…' : 'Convert'}
                  </button>

                  {running && progress && (
                    <div className={styles.progressWrap}>
                      <div className={styles.progressTrack}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                        />
                      </div>
                      <p className={styles.progressMsg}>{progress.msg}</p>
                    </div>
                  )}

                  {error && <p className={styles.errorMsg} role="alert">{error}</p>}

                  {result && (
                    <div className={styles.result}>
                      {Boolean(result.meta?.scanned) && (
                        <div className={styles.scannedBadge}>
                          Scanned PDF detected — text extracted via OCR. Accuracy depends on scan quality.
                        </div>
                      )}
                      <p className={styles.resultNote}>
                        ✓ {result.files.length} file{result.files.length !== 1 ? 's' : ''} ready
                        {result.files.length === 1 && ` · ${fmtSize(result.files[0].bytes.length)}`}
                      </p>
                      <ResultPreview result={result} />
                      <button className={styles.downloadBtn} onClick={downloadAll}>
                        {result.files.length === 1 ? 'Download' : 'Download all (ZIP)'}
                      </button>
                    </div>
                  )}

                  {/* ── Terminal log ── */}
                  {terminalLogs.length > 0 && (
                    <div className={styles.terminal}>
                      <span className={styles.terminalHeader}>Pipeline log</span>
                      {terminalLogs.map((line, i) => (
                        <p key={i} className={`${styles.terminalLine} ${i === terminalLogs.length - 1 ? styles.terminalLineLast : ''}`}>
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
