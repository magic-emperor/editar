import { useState, useEffect } from 'react'
import { useFileStore } from './lib/fileStore'
import { DropZone } from './components/DropZone/DropZone'
import { PDFViewer } from './components/PDFViewer/PDFViewer'
import { Toolbar } from './components/Toolbar/Toolbar'
// import { PrivacyBadge } from './components/PrivacyBadge/PrivacyBadge'
import { ConvertHub } from './components/Convert/ConvertHub'
import { ToolPage } from './components/ToolPage/ToolPage'
import { EditPage } from './components/EditPage/EditPage'
import { ViewerPage } from './components/ViewerPage/ViewerPage'
import styles from './App.module.css'

type Theme = 'warm' | 'dark'

function ViewerLayout({ onOpenConvert }: { onOpenConvert: () => void }) {
  return (
    <div className={styles.viewerLayout}>
      <PDFViewer onOpenConvert={onOpenConvert} />
      <Toolbar />
    </div>
  )
}

export default function App() {
  const { file } = useFileStore()

  const [activeTool,  setActiveTool]  = useState<string | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>('warm')

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : ''
  }, [theme])

  const goBack = () => setActiveTool(null)
  const toggleTheme = () => setTheme(t => t === 'warm' ? 'dark' : 'warm')

  // When ViewerPage loads a PDF it populates fileStore; clear the tool route
  // so the viewer layout takes over. Must run in an effect, not during render.
  useEffect(() => {
    if (file && (activeTool === 'view' || activeTool === 'annotate')) {
      setActiveTool(null)
    }
  }, [file, activeTool])

  // ── Routing: tool page takes priority ──────────────────────────────────────

  if (activeTool === 'view' || activeTool === 'annotate') {
    if (file) return null   // transitioning; effect above will clear activeTool
    return (
      <div className={styles.appRoot}>
        <ViewerPage mode={activeTool} onBack={goBack} />
        {/* <PrivacyBadge /> */}
      </div>
    )
  }

  if (activeTool?.startsWith('op:')) {
    return (
      <div className={styles.appRoot}>
        <EditPage opId={activeTool.slice(3)} onBack={goBack} />
        {/* <PrivacyBadge /> */}
      </div>
    )
  }

  if (activeTool) {
    return (
      <div className={styles.appRoot}>
        <ToolPage toolId={activeTool} onBack={goBack} />
        {/* <PrivacyBadge /> */}
      </div>
    )
  }

  // ── No active tool: viewer or landing ─────────────────────────────────────

  if (file) {
    return (
      <div className={`${styles.appRoot} ${styles.hasFile}`}>
        <ViewerLayout onOpenConvert={() => setConvertOpen(true)} />
        {/* <PrivacyBadge /> */}
        {convertOpen && <ConvertHub onClose={() => setConvertOpen(false)} />}
      </div>
    )
  }

  return (
    <div className={styles.appRoot}>
      <DropZone
        onOpenTool={setActiveTool}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {/* <PrivacyBadge /> */}
    </div>
  )
}
