import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
// XLSX — only used by the disabled table-export handlers below; re-import when re-enabled
// import * as XLSX from 'xlsx'
import { useFileStore } from '../../lib/fileStore'
import { openDocument, closeDocument } from '../../lib/pdfEngine'
import { registerDocPassword } from '../../lib/textExtract'
import { clearFontCache } from '../../lib/intellifont'
// DISABLED: multi-language OCR dropdown — kept for future translation feature
// import { setOcrLanguage, getOcrLanguage } from '../../lib/ocr'
// import { OCR_LANGUAGES } from '../../lib/constants'
import type { PageSize } from '../../lib/pdfEngine'
import { DEFAULT_ZOOM, ZOOM_STEPS, BASE_RENDER_SCALE } from '../../lib/constants'
import { useEditStore } from '../../lib/editStore'
import { useAIStore } from '../../lib/aiStore'
import {
  loadPageTextLayer,
  getCachedTextLayer,
  clearTextLayerCache,
} from '../../lib/textLayer'
import { clearTableCache } from '../../lib/tableCache'
// loadPageTables — only used by the disabled table-export handlers below; re-import when re-enabled
// import { loadPageTables } from '../../lib/tableCache'
import { PageCanvas } from './PageCanvas'
import { ThumbnailStrip } from './ThumbnailStrip'
import { SearchBar } from './SearchBar'
import { TableToolbar } from './TableToolbar'
import { AIPanel } from '../AI/AIPanel'
import { AIConsent } from '../AI/AIConsent'
import { AISettings } from '../AI/AISettings'
import { AnnotationPanel } from '../Annotations/AnnotationPanel'
import { useAnnotationStore } from '../../lib/annotationStore'
import { TranslatePanel as _TranslatePanel } from './TranslatePanel'
import type { TranslationBlock, TranslationMeta } from '../../lib/translator'
import type { SpanMatch } from './TextLayer'
import type { TableSelection, BasketEntry } from './TableLayer'
import styles from './PDFViewer.module.css'

interface Match { page: number; item: number; start: number; len: number }

// 1 PDF point = 96/72 CSS pixels at 100% zoom
const PT_TO_PX = 96 / 72

// Render at the device's pixel density (capped) so pages stay sharp under OS/browser
// scaling — e.g. Windows 125/150% makes devicePixelRatio 1.25/1.5, and a fixed 1.5×
// render then looks blurry. Multiplying the render scale by DPR matches physical pixels.
const DPR = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2.5)
const RENDER_MUL = BASE_RENDER_SCALE * DPR

export function PDFViewer({ onOpenConvert: _onOpenConvert }: { onOpenConvert: () => void }) {
  const { file, affectedPages, setPageCount, setAffectedPages, setDocId: setStoreDocId } = useFileStore()
  const { reset: resetEdits, setEditMode } = useEditStore()
  const { aiMode: _aiMode, setAiMode, licenseKey, consentedDocs, resetAIState } = useAIStore()
  const { activeTool, setActiveTool, setHighlightColor, highlightColor, loadForDoc, clearAnnotations } = useAnnotationStore()

  const [docId,       setDocId]       = useState<string | null>(null)
  const [pageSizes,   setPageSizes]   = useState<PageSize[]>([])
  const [zoom,        setZoom]        = useState(DEFAULT_ZOOM)
  const [renderScale, setRenderScale] = useState(DEFAULT_ZOOM * RENDER_MUL)
  const [currentPage, setCurrentPage] = useState(0)
  const [jumpInput,   setJumpInput]   = useState('')
  const [error,       setError]       = useState<string | null>(null)

  // Find-in-page
  const [searchOpen,   setSearchOpen]   = useState(false)
  const [query,        setQuery]        = useState('')
  const [matches,      setMatches]      = useState<Match[]>([])
  const [activeMatch,  setActiveMatch]  = useState(0)
  const [scanned,      setScanned]      = useState(0)   // pages whose text is loaded

  // Table mode
  const [tableMode,      setTableMode]      = useState(false)
  const [tableSelection, setTableSelection] = useState<TableSelection | null>(null)
  const [tableBasket,    setTableBasket]    = useState<BasketEntry[]>([])
  // setExportingAll — only used by the disabled table-export handlers below
  const [_exportingAll,  _setExportingAll]  = useState(false)

  // AI Assist
  const [aiPanelOpen,   setAiPanelOpen]   = useState(false)
  const [showConsent,   setShowConsent]   = useState(false)
  const [showAISettings, setShowAISettings] = useState(false)

  // Translate panel + per-page overlay data (disabled — re-enable with translation server)
  const [_translateOpen,    setTranslateOpen]    = useState(false)
  const [pageTranslations,  setPageTranslations] = useState<
    Record<number, { blocks: TranslationBlock[]; meta: TranslationMeta }>
  >({})

  // OCR language — disabled (see import comment above)
  // const [ocrLang, setOcrLang] = useState(getOcrLanguage)

  // Re-enable when translation server is hosted: pass to TranslatePanel as onPageTranslated
  // const handlePageTranslated = useCallback(
  //   (pageIndex: number, blocks: TranslationBlock[], meta: TranslationMeta) => {
  //     setPageTranslations(prev => ({ ...prev, [pageIndex]: { blocks, meta } }))
  //   },
  //   [],
  // )

  const docConsented = docId ? consentedDocs.has(docId) : false

  // AI ASSIST handler — kept for re-enable; button is commented out in toolbar
  // function handleAIButtonClick() {
  //   if (!licenseKey) { setShowAISettings(true); return }
  //   if (!docConsented) { setShowConsent(true); return }
  //   const next = !aiPanelOpen
  //   setAiPanelOpen(next)
  //   if (!next) setAiMode('off')
  //   else if (aiMode === 'off') setAiMode('ocr')
  //   if (next) { setEditMode(false); setTableMode(false); setTableSelection(null) }
  // }

  const toggleTableBasket = useCallback((entry: BasketEntry, append: boolean) => {
    setTableBasket(prev => {
      const exists = prev.some(
        e => e.pageIndex === entry.pageIndex && e.tableIndex === entry.tableIndex
      )
      if (append) {
        return exists
          ? prev.filter(e => !(e.pageIndex === entry.pageIndex && e.tableIndex === entry.tableIndex))
          : [...prev, entry]
      }
      // Without shift: set basket to just this one (or clear if already sole entry)
      return exists && prev.length === 1 ? [] : [entry]
    })
  }, [])

  // TABLE EXPORT handlers — kept for re-enable; buttons are commented out in toolbar
  // const exportBasketTables = useCallback(async () => {
  //   if (!docId || !file || tableBasket.length === 0) return
  //   setExportingAll(true)
  //   try {
  //     const wb = XLSX.utils.book_new()
  //     for (const entry of tableBasket) {
  //       const tables = await loadPageTables(docId, file.bytes, entry.pageIndex)
  //       const tbl = tables[entry.tableIndex]
  //       if (!tbl) continue
  //       const data = tbl.rows
  //         .filter(row => tbl.colCount <= 1 || row.cells.length > 1)
  //         .map(row => {
  //           const out: string[] = Array(tbl.colCount).fill('')
  //           for (const cell of row.cells) {
  //             if (cell.colIndex < tbl.colCount) out[cell.colIndex] = cell.str
  //           }
  //           return out
  //         })
  //       const ws = XLSX.utils.aoa_to_sheet(data)
  //       XLSX.utils.book_append_sheet(wb, ws, `P${entry.pageIndex + 1}-T${entry.tableIndex + 1}`)
  //     }
  //     XLSX.writeFile(wb, `${file.name.replace(/\.pdf$/i, '')}-selected-tables.xlsx`)
  //   } finally {
  //     setExportingAll(false)
  //   }
  // }, [docId, file, tableBasket])

  // const exportAllTables = useCallback(async () => {
  //   if (!docId || !file) return
  //   setExportingAll(true)
  //   try {
  //     const wb = XLSX.utils.book_new()
  //     let sheetCount = 0
  //     for (let p = 0; p < pageSizes.length; p++) {
  //       const tables = await loadPageTables(docId, file.bytes, p)
  //       for (let t = 0; t < tables.length; t++) {
  //         const tbl = tables[t]
  //         const data = tbl.rows.map(row => {
  //           const out: string[] = Array(tbl.colCount).fill('')
  //           for (const cell of row.cells) {
  //             if (cell.colIndex < tbl.colCount) out[cell.colIndex] = cell.str
  //           }
  //           return out
  //         })
  //         const ws = XLSX.utils.aoa_to_sheet(data)
  //         XLSX.utils.book_append_sheet(wb, ws, `P${p + 1}-T${t + 1}`)
  //         sheetCount++
  //       }
  //     }
  //     if (sheetCount === 0) return
  //     const stem = file.name.replace(/\.pdf$/i, '')
  //     XLSX.writeFile(wb, `${stem}-all-tables.xlsx`)
  //   } finally {
  //     setExportingAll(false)
  //   }
  // }, [docId, file, pageSizes.length])

  const scrollRef   = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Open document in engine when file changes
  useEffect(() => {
    if (!file) return
    let cancelled = false
    let openedId: string | null = null
    setError(null)
    resetEdits()   // pending edits don't carry across documents (incl. post-apply reopen)

    openDocument(file.bytes, file.password)
      .then(({ docId, pageSizes }) => {
        if (cancelled) { closeDocument(docId); return }
        registerDocPassword(docId, file.password ?? null)
        loadForDoc(docId)
        openedId = docId
        setDocId(docId)
        setStoreDocId(docId)
        setPageSizes(pageSizes)
        setCurrentPage(0)
        setPageCount(pageSizes.length)
        setAffectedPages(null)
        setMatches([])
        setScanned(0)
        scrollRef.current?.scrollTo({ top: 0 })
      })
      .catch(() => {
        if (!cancelled) setError('This PDF appears to be damaged and could not be opened.')
      })

    return () => {
      cancelled = true
      if (openedId) { closeDocument(openedId); clearTextLayerCache(openedId); clearTableCache(openedId); clearFontCache() }
      setDocId(null)
      setPageSizes([])
      setTableMode(false)
      setTableSelection(null)
      setTableBasket([])
      setAiPanelOpen(false)
      setShowConsent(false)
      setTranslateOpen(false)
      setPageTranslations({})
      resetAIState()
      setActiveTool(null)
      clearAnnotations()
    }
  }, [file])

  // Track visible page from scroll position
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || pageSizes.length === 0) return

    const onScroll = () => {
      const top = scroll.scrollTop + 80  // bias toward top of viewport
      let best = 0
      let bestDist = Infinity
      scroll.querySelectorAll('[data-page]').forEach(el => {
        const page = parseInt((el as HTMLElement).dataset.page ?? '0', 10)
        const dist = Math.abs((el as HTMLElement).offsetTop - top)
        if (dist < bestDist) { bestDist = dist; best = page }
      })
      setCurrentPage(best)
    }

    scroll.addEventListener('scroll', onScroll, { passive: true })
    return () => scroll.removeEventListener('scroll', onScroll)
  }, [pageSizes.length])

  // Keyboard navigation
  useEffect(() => {
    const scrollToPage = (i: number) => {
      const el = scrollRef.current?.querySelector(`[data-page="${i}"]`) as HTMLElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (!docId) return
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        scrollToPage(Math.min(currentPage + 1, pageSizes.length - 1))
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        scrollToPage(Math.max(currentPage - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docId, currentPage, pageSizes.length])

  // Zoom: CSS re-layout immediately, debounce actual re-render by 150ms (no white flash)
  const handleZoom = useCallback((newZoom: number) => {
    setZoom(newZoom)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setRenderScale(newZoom * RENDER_MUL), 150)
  }, [])

  const zoomOut = () => {
    const prev = [...ZOOM_STEPS].reverse().find(s => s < zoom) ?? ZOOM_STEPS[0]
    handleZoom(prev)
  }
  const zoomIn = () => {
    const next = ZOOM_STEPS.find(s => s > zoom) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
    handleZoom(next)
  }

  const jumpToPage = useCallback((i: number) => {
    const el = scrollRef.current?.querySelector(`[data-page="${i}"]`) as HTMLElement
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ── Find-in-page ──────────────────────────────────────────────────────────

  // Ctrl/Cmd-F opens find; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen])

  // When search opens, eagerly load every page's text (native is fast; image-only
  // pages OCR in the background). Matches appear as pages resolve.
  useEffect(() => {
    if (!searchOpen || !docId || !file) return
    let cancelled = false
    let done = 0
    setScanned(0)
    const bytes = file.bytes
    pageSizes.forEach((_, i) => {
      loadPageTextLayer(docId, bytes, i)
        .catch(() => {})
        .finally(() => { if (!cancelled) setScanned(++done) })
    })
    return () => { cancelled = true }
  }, [searchOpen, docId, file, pageSizes.length])

  // Recompute matches when the query changes or more pages finish loading.
  useEffect(() => {
    if (!docId || query.trim() === '') { setMatches([]); setActiveMatch(0); return }
    const q = query.toLowerCase()
    const found: Match[] = []
    for (let p = 0; p < pageSizes.length; p++) {
      const layer = getCachedTextLayer(docId, p)
      if (!layer) continue
      layer.items.forEach((it, item) => {
        const s = it.str.toLowerCase()
        let idx = s.indexOf(q)
        while (idx !== -1) {
          found.push({ page: p, item, start: idx, len: q.length })
          idx = s.indexOf(q, idx + q.length)
        }
      })
    }
    setMatches(found)
    setActiveMatch(0)
  }, [query, scanned, docId, pageSizes.length])

  // Scroll the active match into view.
  useEffect(() => {
    const mt = matches[activeMatch]
    if (!mt) return
    const el = scrollRef.current?.querySelector(`[data-page="${mt.page}"]`) as HTMLElement
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeMatch, matches])

  const nextMatch = useCallback(() => {
    setActiveMatch(i => (matches.length ? (i + 1) % matches.length : 0))
  }, [matches.length])
  const prevMatch = useCallback(() => {
    setActiveMatch(i => (matches.length ? (i - 1 + matches.length) % matches.length : 0))
  }, [matches.length])
  const closeSearch = useCallback(() => { setSearchOpen(false); setQuery('') }, [])

  const matchesByPage = useMemo(() => {
    const map = new Map<number, SpanMatch[]>()
    matches.forEach((mt, idx) => {
      const arr = map.get(mt.page) ?? []
      arr.push({ item: mt.item, start: mt.start, len: mt.len, active: idx === activeMatch })
      map.set(mt.page, arr)
    })
    return map
  }, [matches, activeMatch])

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--accent)', fontFamily: 'var(--font-ui)', padding: '2rem' }}>{error}</p>
      </div>
    )
  }

  if (!docId) return null

  return (
    <div className={styles.root}>
      <ThumbnailStrip
        docId={docId}
        pageSizes={pageSizes}
        currentPage={currentPage}
        onPageClick={jumpToPage}
        affectedPages={affectedPages}
      />

      <div className={styles.main}>
        <div className={styles.topBar} role="toolbar" aria-label="Viewer controls">
          <span className={styles.pageInfo}>
            <span>Page</span>
            <input
              className={styles.pageInput}
              type="number"
              min={1}
              max={pageSizes.length}
              value={jumpInput !== '' ? jumpInput : currentPage + 1}
              onChange={e => setJumpInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const n = parseInt(jumpInput, 10)
                  if (!isNaN(n) && n >= 1 && n <= pageSizes.length) jumpToPage(n - 1)
                  setJumpInput('')
                } else if (e.key === 'Escape') {
                  setJumpInput('')
                }
              }}
              onBlur={() => setJumpInput('')}
              aria-label="Current page"
            />
            <span aria-live="polite" aria-atomic>of {pageSizes.length}</span>
          </span>

          <div className={styles.rightControls}>
            <div className={styles.zoomControls} role="group" aria-label="Zoom level">
              <button
                className={styles.zoomBtn}
                onClick={zoomOut}
                disabled={zoom <= ZOOM_STEPS[0]}
                aria-label="Zoom out"
              >−</button>
              <span className={styles.zoomLabel} aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button
                className={styles.zoomBtn}
                onClick={zoomIn}
                disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                aria-label="Zoom in"
              >+</button>
            </div>
            {/* DISABLED: OCR language dropdown — re-enable when free translation is implemented
            <select
              value={ocrLang}
              onChange={async e => {
                const lang = e.target.value
                setOcrLang(lang)
                await setOcrLanguage(lang)
                if (docId) clearTextLayerCache(docId)
              }}
              title="OCR language — applies when reading scanned pages"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.4rem', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-control)', background: 'var(--paper)', color: 'var(--ink)', cursor: 'pointer' }}
              aria-label="OCR language"
            >
              {OCR_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            */}
            {/* TABLES BUTTON — moved to home page; re-enable here if inline table mode is wanted
            <button
              className={tableMode ? styles.tableBtnActive : styles.tableBtn}
              onClick={() => {
                const next = !tableMode
                setTableMode(next)
                setTableSelection(null)
                if (next) setEditMode(false)
              }}
              aria-pressed={tableMode}
              aria-label="Toggle table detection"
              title="Detect tables"
            >⊞ Tables</button>
            {tableMode && tableBasket.length > 0 && (
              <button className={styles.tableBtnActive} onClick={exportBasketTables} disabled={exportingAll}
                title="Export selected tables">
                {exportingAll ? 'Exporting…' : `Export selected (${tableBasket.length})`}
              </button>
            )}
            {tableMode && (
              <button className={styles.tableBtn} onClick={exportAllTables} disabled={exportingAll}
                title="Export all tables">
                {exportingAll ? 'Scanning…' : 'Export all tables'}
              </button>
            )}
            */}
            {/* AI ASSIST BUTTON — feature gated; re-enable when license system is live
            <button
              className={aiPanelOpen ? styles.tableBtnActive : styles.tableBtn}
              style={!licenseKey ? { opacity: 0.55 } : undefined}
              onClick={handleAIButtonClick}
              aria-pressed={aiPanelOpen}
              title={!licenseKey ? 'Enter a license key to unlock AI features' : 'AI Assist'}
            >
              {!licenseKey ? '🔒 AI Assist' : aiPanelOpen ? `✦ AI · ${aiMode}` : '✦ AI Assist'}
            </button>
            */}
            {/* TRANSLATE BUTTON — hidden; re-enable when hosting translation server
            <button
              className={translateOpen ? styles.tableBtnActive : styles.tableBtn}
              onClick={() => {
                setTranslateOpen(o => {
                  if (o) setPageTranslations({})
                  return !o
                })
              }}
              aria-pressed={translateOpen}
              title="Translate current page to English"
            >⟳ Translate</button>
            */}
            <button
              className={activeTool ? styles.tableBtnActive : styles.tableBtn}
              onClick={() => {
                if (activeTool) { setActiveTool(null) }
                else {
                  setActiveTool('highlight')
                  setEditMode(false); setTableMode(false); setTableSelection(null)
                  setAiPanelOpen(false); setAiMode('off')
                }
              }}
              aria-pressed={!!activeTool}
              title="Annotate — highlight, underline, notes"
            >✎ Annotate</button>
            {/* CONVERT BUTTON — converters now live on the home page grid
            <button className={styles.convertBtn} onClick={onOpenConvert}>Convert</button>
            */}
          </div>
        </div>

        {searchOpen && (
          <SearchBar
            query={query}
            onQuery={setQuery}
            matchCount={matches.length}
            activeIndex={matches.length ? activeMatch : -1}
            onPrev={prevMatch}
            onNext={nextMatch}
            onClose={closeSearch}
            scanned={scanned}
            total={pageSizes.length}
          />
        )}

        {tableSelection && (
          <TableToolbar
            selection={tableSelection}
            fileName={file?.name ?? 'document.pdf'}
            onDeselect={() => setTableSelection(null)}
            onSelectAll={() => setTableSelection({
              ...tableSelection,
              rowIndices: tableSelection.table.rows.map(r => r.rowIndex),
            })}
            aiEnabled={aiPanelOpen && docConsented}
            onAICleanup={() => { setAiPanelOpen(true); setAiMode('table') }}
          />
        )}

        {showAISettings && (
          <div style={{ position: 'relative' }}>
            <AISettings onClose={() => {
              setShowAISettings(false)
              if (licenseKey) { setShowConsent(true) }
            }} />
          </div>
        )}

        {aiPanelOpen && docConsented && (
          <AIPanel
            docId={docId}
            pageCount={pageSizes.length}
            tableSelection={tableSelection}
            onClose={() => { setAiPanelOpen(false); setAiMode('off') }}
          />
        )}

        {showConsent && file && docId && (
          <AIConsent
            docId={docId}
            fileName={file.name}
            onClose={() => {
              setShowConsent(false)
              if (consentedDocs.has(docId)) { setAiPanelOpen(true); setAiMode('ocr') }
            }}
          />
        )}

        {activeTool && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--hairline)', background: 'var(--paper-card)', flexShrink: 0 }}>
            {(['highlight', 'underline', 'strikethrough', 'note'] as const).map(tool => (
              <button
                key={tool}
                className={activeTool === tool ? styles.tableBtnActive : styles.tableBtn}
                onClick={() => setActiveTool(tool)}
                title={tool.charAt(0).toUpperCase() + tool.slice(1)}
              >
                {tool === 'highlight' ? '▮ Highlight' : tool === 'underline' ? 'U̲ Underline' : tool === 'strikethrough' ? 'S̶ Strike' : '📌 Note'}
              </button>
            ))}
            {activeTool !== 'note' && (
              <input
                type="color"
                value={highlightColor}
                onChange={e => setHighlightColor(e.target.value)}
                title="Annotation color"
                style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--hairline)', borderRadius: 4, cursor: 'pointer' }}
              />
            )}
          </div>
        )}

        {activeTool && (
          <AnnotationPanel
            onScrollToPage={jumpToPage}
            onClose={() => setActiveTool(null)}
          />
        )}

        {/* TRANSLATE PANEL — hidden; re-enable with the button above
        {translateOpen && file && (
          <TranslatePanel
            docId={docId}
            bytes={file.bytes}
            pageCount={pageSizes.length}
            currentPage={currentPage}
            onPageTranslated={handlePageTranslated}
            onClose={() => { setTranslateOpen(false); setPageTranslations({}) }}
          />
        )}
        */}

        <div
          ref={scrollRef}
          className={styles.scroll}
          role="document"
          aria-label={`${file?.name ?? 'PDF document'}, ${pageSizes.length} pages`}
        >
          {pageSizes.map((size, i) => (
            <PageCanvas
              key={`${docId}-${i}`}
              docId={docId}
              bytes={file!.bytes}
              pageIndex={i}
              pageSize={size}
              zoom={zoom}
              renderScale={renderScale}
              ptToPx={PT_TO_PX}
              matches={matchesByPage.get(i)}
              tableMode={tableMode}
              tableSelection={tableSelection}
              onTableSelect={setTableSelection}
              tableBasket={tableBasket}
              onTableBasketToggle={toggleTableBasket}
              translationBlocks={pageTranslations[i]?.blocks}
              translationMeta={pageTranslations[i]?.meta}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
