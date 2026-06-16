import { useRef, useState, useCallback, type ReactElement, type DragEvent, type ChangeEvent } from 'react'
import { PDFDocument } from 'pdf-lib'
import { useFileStore } from '../../lib/fileStore'
import { preloadEngine } from '../../lib/pdfEngine'
import { PasswordModal } from './PasswordModal'
import styles from './DropZone.module.css'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    return doc.isEncrypted
  } catch {
    return false
  }
}

// ─── Icons (inline SVG, no dep) ──────────────────────────────────────────────

function IconDoc() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
}
function IconPen() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
}

function IconHash() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
}
function IconTable() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
}
function IconSlides() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
}
function IconWord() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13l1.5 5 1.5-4 1.5 4L15 13"/></svg>
}
function IconImage() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
}
function IconStack() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
}
function IconSwap() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
}
function IconText() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
}
function IconMerge() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/><path d="M16 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
}
function IconScissors() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
}
function IconExtract() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
}
function IconRemove() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
}
function IconReorder() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><polyline points="8 4 3 9 8 14"/><polyline points="16 20 21 15 16 10"/></svg>
}
function IconRotate() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
}
function IconCompress() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
}
function IconWatermark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/><path d="M15 5l3 3"/></svg>
}
function IconPageNum() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="17" x2="15" y2="17"/><line x1="12" y1="14" x2="12" y2="17"/></svg>
}
function IconSparkle() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/></svg>
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

type IconFn = () => ReactElement

interface ToolDef {
  id:        string   // routing id: 'view', 'annotate', 'op:merge', 'pdf2md', etc.
  label:     string
  desc:      string
  badge:     'LOCAL' | 'SERVER' | 'BETA' | 'SOON'
  action:    string
  Icon:      IconFn
  disabled?: boolean
}

interface Category {
  label:    string
  tools:    ToolDef[]
  isBeta?:  boolean
}

const CATEGORIES: Category[] = [
  {
    label: 'Convert & Export',
    tools: [
      { id: 'docx2pdf', label: 'Word → PDF',    Icon: IconWord,   badge: 'SERVER', action: 'Convert',
        desc: 'Convert a .docx Word document to PDF via LibreOffice on your local server.' },
      { id: 'xlsx2pdf', label: 'Excel → PDF',   Icon: IconTable,  badge: 'SERVER', action: 'Convert',
        desc: 'Convert a .xlsx spreadsheet to PDF via LibreOffice headless.' },
      { id: 'pdf2txt',  label: 'PDF → Text',    Icon: IconText,   badge: 'LOCAL',  action: 'Convert',
        desc: 'Extract all text from a PDF with OCR fallback for scanned pages.' },
      { id: 'pdf2word', label: 'PDF → Word',    Icon: IconWord,   badge: 'LOCAL',  action: 'Convert',
        desc: 'OCR-aware: scanned pages become real editable text in a .docx file.' },
      { id: 'pdf2png',  label: 'PDF → Images',  Icon: IconImage,  badge: 'LOCAL',  action: 'Convert',
        desc: 'Render every PDF page to PNG, JPG, or WebP. Multiple pages → ZIP.' },
      { id: 'img2pdf',  label: 'Images → PDF',  Icon: IconStack,  badge: 'LOCAL',  action: 'Convert',
        desc: 'Combine multiple image files into one PDF, one page per image.' },
      { id: 'img2img',  label: 'Convert Images', Icon: IconSwap,  badge: 'LOCAL',  action: 'Convert',
        desc: 'Transcode between PNG, JPG, and WebP with quality and resize controls.' },
    ],
  },
  {
    label: 'Edit PDF',
    tools: [
      { id: 'op:merge',       label: 'Merge PDFs',       Icon: IconMerge,    badge: 'LOCAL', action: 'Edit',
        desc: 'Combine multiple PDF files into a single document in any order.' },
      { id: 'op:split',       label: 'Split PDF',        Icon: IconScissors, badge: 'LOCAL', action: 'Edit',
        desc: 'Break a PDF into separate files at pages you choose.' },
      { id: 'op:extract',     label: 'Extract Pages',    Icon: IconExtract,  badge: 'LOCAL', action: 'Edit',
        desc: 'Pull out a range of pages from a PDF into a new file.' },
      { id: 'op:remove',      label: 'Remove Pages',     Icon: IconRemove,   badge: 'LOCAL', action: 'Edit',
        desc: 'Delete specific pages or a page range from a PDF.' },
      { id: 'op:reorder',     label: 'Reorder Pages',    Icon: IconReorder,  badge: 'LOCAL', action: 'Edit',
        desc: 'Rearrange pages by specifying a new page order.' },
      { id: 'op:rotate',      label: 'Rotate Pages',     Icon: IconRotate,   badge: 'LOCAL', action: 'Edit',
        desc: 'Rotate all pages or selected pages by 90°, 180°, or 270°.' },
      { id: 'op:compress',    label: 'Compress PDF',     Icon: IconCompress, badge: 'LOCAL', action: 'Edit',
        desc: 'Reduce PDF file size while preserving readable quality.' },
      { id: 'op:watermark',   label: 'Add Watermark',    Icon: IconWatermark, badge: 'LOCAL', action: 'Edit',
        desc: 'Stamp text across every page — confidential, draft, or custom.' },
      { id: 'op:pageNumbers', label: 'Page Numbers',     Icon: IconPageNum,  badge: 'LOCAL', action: 'Edit',
        desc: 'Add page numbers to the header or footer of every page.' },
    ],
  },
  {
    label: 'New Tools (Beta)',
    isBeta: true,
    tools: [
      { id: 'pdf2md',   label: 'PDF → Markdown',   Icon: IconHash,   badge: 'BETA', action: 'Convert',
        desc: 'Extract all text into clean Markdown with per-page headings.' },
      { id: 'pdf2xlsx', label: 'PDF → Excel',       Icon: IconTable,  badge: 'BETA', action: 'Convert',
        desc: 'Text content as rows in a real .xlsx workbook, one sheet per page.' },
      { id: 'pdf2pptx', label: 'PDF → PowerPoint',  Icon: IconSlides, badge: 'BETA', action: 'Convert',
        desc: 'One editable slide per page with the extracted text.' },
    ],
  },
  {
    label: 'View & Annotate',
    tools: [
      { id: 'view',     label: 'Open & View',   Icon: IconDoc, badge: 'LOCAL', action: 'Open',
        desc: 'Render any PDF in-browser — search, zoom, multi-page, all local.' },
      { id: 'annotate', label: 'Annotate PDF',  Icon: IconPen, badge: 'LOCAL', action: 'Open',
        desc: 'Add highlights, underlines, and sticky notes directly on pages.' },
    ],
  },
]

const AI_TOOL: ToolDef = {
  id: 'ai', label: 'AI Assistant', Icon: IconSparkle, badge: 'SOON', action: '',
  desc: 'Ask questions about your document, summarise, translate and more.', disabled: true,
}

// ─── Component ────────────────────────────────────────────────────────────────

type Theme = 'warm' | 'dark'

export function DropZone({ onOpenTool, theme, onToggleTheme }: {
  onOpenTool:    (toolId: string) => void
  theme:         Theme
  onToggleTheme: () => void
}) {
  const { openFile } = useFileStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over,  setOver]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy,  setBusy]  = useState(false)
  const [pendingEncrypted, setPendingEncrypted] = useState<{ file: File; bytes: Uint8Array } | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported.')
      return
    }
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (await isEncrypted(bytes)) {
        setPendingEncrypted({ file, bytes })
        return
      }
      await openFile(file)
    } catch {
      setError('Could not read the file. It may be damaged or an unsupported format.')
    } finally {
      setBusy(false)
    }
  }, [openFile])

  const handleUnlock = useCallback(async (password: string) => {
    if (!pendingEncrypted) return
    setBusy(true)
    try {
      await openFile(pendingEncrypted.file, password)
    } catch {
      setError('Could not open the file.')
    } finally {
      setPendingEncrypted(null)
      setBusy(false)
    }
  }, [pendingEncrypted, openFile])

  const handleCancelPassword = useCallback(() => {
    setPendingEncrypted(null)
    setError(null)
  }, [])

  const handleHoverIntent = useCallback(() => preloadEngine(), [])

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    preloadEngine()
    setOver(true)
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
  }, [])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }, [handleFile])

  const handleToolClick = useCallback((tool: ToolDef) => {
    if (tool.disabled) return
    onOpenTool(tool.id)
  }, [onOpenTool])

  return (
    <div
      className={styles.root}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={handleHoverIntent}
    >
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <img className={styles.logo} src="/EDITAR.png" alt="" aria-hidden />
          <div className={styles.brand}>
            <span className={styles.brandName}>EDITAR</span>
            <span className={styles.brandSub}>On-Device PDF &amp; Document Workstation</span>
          </div>
        </div>
        <div className={styles.themeToggle} role="group" aria-label="Color theme">
          <button
            className={`${styles.themeBtn} ${theme === 'warm' ? styles.themeBtnActive : ''}`}
            onClick={() => { if (theme !== 'warm') onToggleTheme() }}
          >Warm Paper</button>
          <button
            className={`${styles.themeBtn} ${theme === 'dark' ? styles.themeBtnActive : ''}`}
            onClick={() => { if (theme !== 'dark') onToggleTheme() }}
          >Studio Dark</button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className={styles.hero}>
        <p className={styles.heroEyebrow}>Privacy-first · 100% in your browser</p>
        <h1 className={styles.heroHeadline}>Beautiful, local<br />document processing.</h1>
        <p className={styles.heroSub}>
          Everything runs on your machine. No uploads, no accounts, no cloud cost.
          Your files never leave your browser.
        </p>
        <div className={styles.heroActions}>
          <button
            className={styles.heroBtn}
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? 'Opening…' : 'Open a PDF →'}
          </button>
          <span className={styles.heroDrop}>or drop a PDF anywhere on this page</span>
        </div>
        {error && (
          <div className={styles.errorBanner} role="alert">{error}</div>
        )}
      </section>

      {/* ── Tool grid ── */}
      <main className={styles.grid} aria-label="Available tools">
        {CATEGORIES.map(cat => (
          <section key={cat.label} className={`${styles.category} ${cat.isBeta ? styles.betaSection : ''}`}>
            <h2 className={styles.catLabel}>
              {cat.label}
              {cat.isBeta && <span className={styles.betaLabel}>BETA</span>}
            </h2>
            <div className={styles.toolGrid}>
              {cat.tools.map(tool => {
                const { Icon } = tool
                const badgeCls = tool.badge === 'SERVER' ? styles.badgeServer
                               : tool.badge === 'BETA'   ? styles.badgeBeta
                               : styles.badgeLocal
                return (
                  <button
                    key={tool.id}
                    className={`${styles.toolCard} ${tool.disabled ? styles.toolCardDisabled : ''}`}
                    onClick={() => handleToolClick(tool)}
                    disabled={tool.disabled}
                    aria-label={`${tool.label}: ${tool.desc}`}
                  >
                    <div className={styles.cardTop}>
                      <div className={styles.cardIcon}><Icon /></div>
                      <span className={`${styles.badge} ${badgeCls}`}>{tool.badge}</span>
                    </div>
                    <span className={styles.cardLabel}>{tool.label}</span>
                    <p className={styles.cardDesc}>{tool.desc}</p>
                    {!tool.disabled && <span className={styles.cardAction}>{tool.action} →</span>}
                    {tool.disabled && <span className={styles.cardSoon}>Coming Soon</span>}
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        {/* ── AI Assistant Coming Soon ── */}
        <section className={styles.category}>
          <h2 className={styles.catLabel}>AI Assistant</h2>
          <div className={styles.toolGrid}>
            {(() => {
              const { Icon } = AI_TOOL
              return (
                <button
                  className={`${styles.toolCard} ${styles.toolCardDisabled}`}
                  disabled
                  aria-label={`${AI_TOOL.label}: ${AI_TOOL.desc}`}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.cardIcon}><Icon /></div>
                    <span className={`${styles.badge} ${styles.badgeSoon}`}>SOON</span>
                  </div>
                  <span className={styles.cardLabel}>{AI_TOOL.label}</span>
                  <p className={styles.cardDesc}>{AI_TOOL.desc}</p>
                  <span className={styles.cardSoon}>Coming Soon</span>
                </button>
              )
            })()}
          </div>
        </section>
      </main>

      {/* ── Drop overlay ── */}
      {over && (
        <div className={styles.dropOverlay} aria-hidden>
          <div className={styles.dropOverlayInner}>
            <span className={styles.dropArrow}>↓</span>
            <span>Drop your PDF here</span>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className={styles.fileInput}
        onChange={onInputChange}
        aria-hidden
        tabIndex={-1}
      />

      {pendingEncrypted && (
        <PasswordModal
          fileName={pendingEncrypted.file.name}
          bytes={pendingEncrypted.bytes}
          onUnlock={handleUnlock}
          onCancel={handleCancelPassword}
        />
      )}
    </div>
  )
}
