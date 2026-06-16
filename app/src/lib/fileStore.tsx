import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileEntry {
  name:     string
  bytes:    Uint8Array
  password: string | null
}

export interface AffectedPages {
  indices: number[]
  marker:  'remove' | 'extract'
}

interface FileStoreCtx {
  file:             FileEntry | null
  pageCount:        number
  docId:            string | null   // engine doc id of the open document (set by the viewer)
  canUndo:          boolean   // undoSteps > 0 — kept for convenience
  undoSteps:        number    // how many undo levels are available
  affectedPages:    AffectedPages | null
  openFile:         (f: File, password?: string | null) => Promise<void>
  updateBytes:      (bytes: Uint8Array) => void
  undoLastOp:       () => void
  setPageCount:     (n: number) => void
  setDocId:         (id: string | null) => void
  setAffectedPages: (ap: AffectedPages | null) => void
  clear:            () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const Ctx = createContext<FileStoreCtx | null>(null)
const MAX_UNDO = 10

export function FileStoreProvider({ children }: { children: ReactNode }) {
  const [file,          setFile]          = useState<FileEntry | null>(null)
  const [pageCount,     setPageCountState] = useState(0)
  const [docId,         setDocIdState]    = useState<string | null>(null)
  const [undoSteps,     setUndoSteps]     = useState(0)
  const [affectedPages, setAffectedPages] = useState<AffectedPages | null>(null)
  const undoStack = useRef<Uint8Array[]>([])

  const canUndo = undoSteps > 0

  const openFile = useCallback(async (f: File, password?: string | null) => {
    const buf = await f.arrayBuffer()
    undoStack.current = []
    setUndoSteps(0)
    setAffectedPages(null)
    setFile({ name: sanitizeFileName(f.name), bytes: new Uint8Array(buf), password: password ?? null })
  }, [])

  const updateBytes = useCallback((bytes: Uint8Array) => {
    setFile(prev => {
      if (!prev) return null
      const stack = undoStack.current
      stack.push(prev.bytes)
      if (stack.length > MAX_UNDO) stack.shift()
      return { ...prev, bytes }
    })
    setUndoSteps(s => Math.min(s + 1, MAX_UNDO))
  }, [])

  const undoLastOp = useCallback(() => {
    const prev = undoStack.current.pop()
    if (!prev) return
    setUndoSteps(undoStack.current.length)
    setAffectedPages(null)
    setFile(f => f ? { ...f, bytes: prev } : null)
  }, [])

  const setPageCount = useCallback((n: number) => setPageCountState(n), [])
  const setDocId = useCallback((id: string | null) => setDocIdState(id), [])

  const clear = useCallback(() => {
    undoStack.current = []
    setUndoSteps(0)
    setAffectedPages(null)
    setPageCountState(0)
    setDocIdState(null)
    setFile(null)
  }, [])

  return (
    <Ctx.Provider value={{
      file, pageCount, docId, canUndo, undoSteps, affectedPages,
      openFile, updateBytes, undoLastOp,
      setPageCount, setDocId, setAffectedPages, clear,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useFileStore(): FileStoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFileStore must be used inside FileStoreProvider')
  return ctx
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w\s.\-]/g, '_').slice(0, 200)
}
