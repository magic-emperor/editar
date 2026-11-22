import { useRef, useState, useCallback, type ReactElement, type DragEvent, type ChangeEvent } from 'react'
import { PDFDocument } from 'pdf-lib'
import { useFileStore } from '../../lib/fileStore'
import { preloadEngine } from '../../lib/pdfEngine'
import { PasswordModal } from './PasswordModal'
import { SiteFooter } from '../Footer/SiteFooter'
import { DesignerCredit } from '../common/DesignerCredit'
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

// ─── Icons (terracotta line style matching Framer) ───────────────────────────

function IconDoc() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
}
function IconPen() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
}
function IconHash() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
}
function IconTable() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
}
function IconSlides() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
}
function IconWord() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13l1.5 5 1.5-4 1.5 4L15 13"/></svg>
}
function IconImage() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
}
function IconStack() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
}
function IconSwap() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
}
function IconText() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
}
function IconMerge() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/><path d="M16 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
}
function IconScissors() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
}
function IconExtract() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
}
function IconRemove() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
}
function IconReorder() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><polyline points="8 4 3 9 8 14"/><polyline points="16 20 21 15 16 10"/></svg>
}
function IconRotate() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
}
function IconCompress() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
}
function IconWatermark() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/><path d="M15 5l3 3"/></svg>
}
function IconPageNum() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="17" x2="15" y2="17"/><line x1="12" y1="14" x2="12" y2="17"/></svg>
}
function IconSparkle() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/></svg>
}
function IconLock() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
}
function IconShield() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
}
function IconUploadDoc() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

type IconFn = () => ReactElement

interface ToolDef {
  id:        string
  label:     string
  desc:      string
  badge:     'LOCAL' | 'SERVER' | 'BETA' | 'SOON'
  action:    string
  Icon:      IconFn
  disabled?: boolean
}

interface CategoryGroup {
  id:       string
  title:    string
  subtitle: string
  tools:    ToolDef[]
}

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'popular',
    title: 'Popular tools',
    subtitle: 'The everyday essentials.',
    tools: [
      { id: 'view', label: 'Edit PDF', Icon: IconPen, badge: 'LOCAL', action: 'Edit',
        desc: 'Edit existing text, fix typos, modify fonts and replace text directly.' },
      { id: 'op:merge', label: 'Merge PDFs', Icon: IconMerge, badge: 'LOCAL', action: 'Merge',
        desc: 'Combine multiple PDF files into one document in any order.' },
      { id: 'op:compress', label: 'Compress PDF', Icon: IconCompress, badge: 'LOCAL', action: 'Compress',
        desc: 'Reduce file size while preserving high visual quality.' },
      { id: 'pdf2txt', label: 'PDF to Text', Icon: IconText, badge: 'LOCAL', action: 'Convert',
        desc: 'Extract clean selectable text, including OCR fallback for scans.' },
    ],
  },
  {
    id: 'convert',
    title: 'Convert & export',
    subtitle: 'The right format for your next step.',
    tools: [
      { id: 'docx2pdf', label: 'Word to PDF', Icon: IconWord, badge: 'SERVER', action: 'Convert',
        desc: 'Make a share-ready PDF from a Word file.' },
      { id: 'xlsx2pdf', label: 'Excel to PDF', Icon: IconTable, badge: 'SERVER', action: 'Convert',
        desc: 'Turn spreadsheets into polished PDFs.' },
      { id: 'pdf2txt', label: 'PDF to Text', Icon: IconText, badge: 'LOCAL', action: 'Convert',
        desc: 'Extract text, including scanned pages.' },
      { id: 'pdf2png', label: 'PDF to Images', Icon: IconImage, badge: 'LOCAL', action: 'Convert',
        desc: 'Save pages as PNG, JPG, or WebP.' },
      { id: 'img2pdf', label: 'Images to PDF', Icon: IconStack, badge: 'LOCAL', action: 'Convert',
        desc: 'Gather your images into one document.' },
      { id: 'img2img', label: 'Convert Images', Icon: IconSwap, badge: 'LOCAL', action: 'Convert',
        desc: 'Switch image formats, quality, and size.' },
    ],
  },
  {
    id: 'organize',
    title: 'Organize PDF',
    subtitle: 'A little order goes a long way.',
    tools: [
      { id: 'op:split', label: 'Split PDF', Icon: IconScissors, badge: 'LOCAL', action: 'Edit',
        desc: 'Separate one PDF into smaller files.' },
      { id: 'op:extract', label: 'Extract Pages', Icon: IconExtract, badge: 'LOCAL', action: 'Edit',
        desc: 'Keep just the pages you need.' },
      { id: 'op:remove', label: 'Remove Pages', Icon: IconRemove, badge: 'LOCAL', action: 'Edit',
        desc: 'Leave unnecessary pages behind.' },
      { id: 'op:reorder', label: 'Reorder Pages', Icon: IconReorder, badge: 'LOCAL', action: 'Edit',
        desc: 'Put every page in the right place.' },
      { id: 'op:rotate', label: 'Rotate Pages', Icon: IconRotate, badge: 'LOCAL', action: 'Edit',
        desc: 'Get a fresh angle on your document.' },
      { id: 'op:watermark', label: 'Add Watermark', Icon: IconWatermark, badge: 'LOCAL', action: 'Edit',
        desc: 'Add a draft label or a personal stamp.' },
      { id: 'op:pageNumbers', label: 'Page Numbers', Icon: IconPageNum, badge: 'LOCAL', action: 'Edit',
        desc: 'Make long documents easier to navigate.' },
    ],
  },
  {
    id: 'annotate',
    title: 'View & annotate',
    subtitle: 'Read closely. Leave your mark.',
    tools: [
      { id: 'view', label: 'Open & View', Icon: IconDoc, badge: 'LOCAL', action: 'Open',
        desc: 'Read, search, and zoom into your PDFs.' },
      { id: 'annotate', label: 'Annotate PDF', Icon: IconPen, badge: 'LOCAL', action: 'Annotate',
        desc: 'Highlight ideas and add your notes.' },
    ],
  },
  {
    id: 'beta',
    title: 'New in beta',
    subtitle: 'A few more possibilities. Still being perfected.',
    tools: [
      { id: 'pdf2md', label: 'PDF to Markdown', Icon: IconHash, badge: 'BETA', action: 'Convert',
        desc: 'Clean text, ready for your next idea.' },
      { id: 'pdf2xlsx', label: 'PDF to Excel', Icon: IconTable, badge: 'BETA', action: 'Convert',
        desc: 'Move document data into a spreadsheet.' },
      { id: 'pdf2pptx', label: 'PDF to PowerPoint', Icon: IconSlides, badge: 'BETA', action: 'Convert',
        desc: 'Give each page a place in your presentation.' },
    ],
  },
]

type Theme = 'warm' | 'dark'

export function DropZone({ onOpenTool }: {
  onOpenTool:    (toolId: string) => void
  theme?:        Theme
  onToggleTheme?: () => void
}) {
  const { openFile } = useFileStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over,  setOver]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy,  setBusy]  = useState(false)
  const [pendingEncrypted, setPendingEncrypted] = useState<{ file: File; bytes: Uint8Array } | null>(null)
  const [activeTab, setActiveTab] = useState<string>('all')

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

  const loadSample = useCallback(async () => {
    try {
      setBusy(true)
      setError(null)
      const res = await fetch('/sample.pdf')
      if (!res.ok) throw new Error('Sample not found')
      const blob = await res.blob()
      const file = new File([blob], 'Brand proposal.pdf', { type: 'application/pdf' })
      await openFile(file)
    } catch {
      setError('Could not load sample file.')
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

  const scrollToTools = () => {
    setActiveTab('all')
    const el = document.getElementById('catalog-section')
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  // Filter groups depending on activeTab: 'all' shows all 22 tools, rest filter to specific category
  const visibleGroups = activeTab === 'all'
    ? CATEGORY_GROUPS
    : CATEGORY_GROUPS.filter(g => g.id === activeTab)

  return (
    <div
      className={styles.root}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={handleHoverIntent}
    >
      {/* ── Navbar ── */}
      <header className={styles.nav}>
        <div className={styles.navLeft}>
          <img src="/EDITAR.png" alt="EDITAR" className={styles.logoImg} />
          <span className={styles.logoText}>EDITAR</span>
          <span className={styles.logoTagline}>Your everyday document workspace</span>
        </div>

        <DesignerCredit />

        <div className={styles.navRight}>
          <button className={styles.navLink} onClick={scrollToTools}>
            All tools
          </button>
          <button className={styles.navEditorBtn} onClick={() => inputRef.current?.click()}>
            PDF editor
          </button>
          <div className={styles.privacyPill} title="All processing happens on your device">
            <span>Privacy first</span>
            <IconShield />
          </div>
        </div>
      </header>

      {/* ── Hero Section (2 Columns) ── */}
      <section className={styles.heroSection}>
        <div className={styles.heroLeft}>
          <div className={styles.eyebrow}>
            <IconShield />
            <span>YOUR FILES. YOUR DEVICE. YOUR CONTROL.</span>
          </div>

          <h1 className={styles.headline}>
            Documents, without<br />the busywork.
          </h1>

          <p className={styles.subtext}>
            Edit, convert, and organize your PDFs in one calm workspace. No accounts. No unnecessary steps.
          </p>

          <div className={styles.checkmarks}>
            <div className={styles.checkItem}>
              <span className={styles.checkIcon}>✓</span>
              <span>No sign-up</span>
            </div>
            <div className={styles.checkItem}>
              <span className={styles.checkIcon}>✓</span>
              <span>Local-first tools</span>
            </div>
            <div className={styles.checkItem}>
              <span className={styles.checkIcon}>✓</span>
              <span>Free to use</span>
            </div>
          </div>
        </div>

        <div className={styles.heroRight}>
          <div className={styles.dropCard}>
            <div className={styles.uploadIconWrap}>
              <IconUploadDoc />
            </div>

            <h3 className={styles.dropTitle}>Start with a document</h3>
            <p className={styles.dropDesc}>Drop your PDF here, or choose a file</p>

            <button
              className={styles.ctaBtn}
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? 'Opening…' : '+ Open PDF editor'}
            </button>

            <div className={styles.dropFootnote}>
              <span>PDF documents · </span>
              <button className={styles.sampleLink} onClick={loadSample}>
                Preview with a sample file
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className={styles.errorBanner} role="alert">{error}</div>
      )}

      {/* ── Catalog Section ── */}
      <section id="catalog-section" className={styles.catalogSection}>
        <div className={styles.catalogHeader}>
          <div className={styles.catalogHeadingLeft}>
            <h2 className={styles.catalogTitle}>A tool for every to-do.</h2>
            <p className={styles.catalogSub}>Find the right tool. Get straight to work.</p>
          </div>
          {/* <div className={styles.countBadge}>
            [ 22 useful tools ]
          </div> */}
        </div>

        {/* Category Tabs */}
        <div className={styles.tabBar} role="tablist" aria-label="Tool categories">
          <button
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`${styles.tabBtn} ${activeTab === 'all' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All tools
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'popular'}
            className={`${styles.tabBtn} ${activeTab === 'popular' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('popular')}
          >
            Popular
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'convert'}
            className={`${styles.tabBtn} ${activeTab === 'convert' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('convert')}
          >
            Convert & export
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'organize'}
            className={`${styles.tabBtn} ${activeTab === 'organize' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('organize')}
          >
            Organize PDF
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'annotate'}
            className={`${styles.tabBtn} ${activeTab === 'annotate' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('annotate')}
          >
            View & annotate
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'beta'}
            className={`${styles.tabBtn} ${activeTab === 'beta' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('beta')}
          >
            New in beta
          </button>
        </div>

        {/* Tool Groups */}
        <div className={styles.groupsWrap}>
          {visibleGroups.map(group => (
            <div key={group.id} className={styles.groupBlock}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{group.title}</span>
                <span className={styles.groupSubtitle}>{group.subtitle}</span>
              </div>

              <div className={styles.cardGrid}>
                {group.tools.map(tool => {
                  const { Icon } = tool
                  return (
                    <button
                      key={`${group.id}-${tool.id}`}
                      className={styles.toolCard}
                      onClick={() => {
                        if (tool.id === 'view' || tool.id === 'annotate') {
                          inputRef.current?.click()
                        } else {
                          onOpenTool(tool.id)
                        }
                      }}
                      aria-label={`${tool.label}: ${tool.desc}`}
                    >
                      <div className={styles.cardTop}>
                        <div className={styles.cardIconBox}>
                          <Icon />
                        </div>
                        <span className={styles.cardBadge}>{tool.badge}</span>
                      </div>
                      <div className={styles.cardLabel}>{tool.label}</div>
                      <p className={styles.cardDesc}>{tool.desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Privacy Callout Card ── */}
        <div className={styles.privacyCallout}>
          <div className={styles.privacyIconWrap}>
            <IconLock />
          </div>
          <div className={styles.privacyText}>
            <span className={styles.privacyTitle}>Privacy isn't an extra. It's the starting point.</span>
            <span className={styles.privacyDesc}>
              Local tools process files on your device. Tools marked Server need a local server connection.
            </span>
          </div>
        </div>

        {/* ── AI Assistant Teaser ── */}
        <div className={styles.aiTeaser}>
          <div className={styles.aiIcon}>
            <IconSparkle />
          </div>
          <span className={styles.aiLabel}>AI Assistant</span>
          <span className={styles.aiDesc}>A little help with the big documents. Coming soon.</span>
        </div>
      </section>

      {/* ── Footer ── */}
      <SiteFooter />

      {/* ── Hidden File Input ── */}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className={styles.fileInput}
        onChange={onInputChange}
        aria-hidden
        tabIndex={-1}
      />

      {/* ── Drop overlay ── */}
      {over && (
        <div className={styles.dropOverlay} aria-hidden>
          <div className={styles.dropOverlayInner}>
            <span className={styles.dropArrow}>↓</span>
            <span>Drop your PDF here</span>
          </div>
        </div>
      )}

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
