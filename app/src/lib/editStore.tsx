import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import type { EditOp } from './types'

// ─── Pending-edit store ─────────────────────────────────────────────────────────
//
// Edits are held here (not yet written to the PDF) so they render instantly in the
// DOM overlay and can be undone with no worker round-trip. They are baked into the
// document in one batched op only on "Apply" (see PDFViewer). Reset whenever the
// open document changes (new file, or post-apply reopen ⇒ new docId).

export type EditTool = 'select' | 'text' | 'whiteout'

interface EditStoreCtx {
  editMode: boolean
  setEditMode: (b: boolean) => void
  tool: EditTool
  setTool: (t: EditTool) => void
  edits: EditOp[]
  addEdit: (e: EditOp) => void
  updateEdit: (id: string, patch: Partial<EditOp>) => void
  removeEdit: (id: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  reset: () => void          // drop all edits (on document change / after apply)
  engineReady: boolean
  setEngineReady: (b: boolean) => void
  engineRevision: number
  bumpEngineRevision: () => void
  waveTrigger: number
  waveOrigin: { x: number; y: number } | null
  triggerWave: (origin?: { x: number; y: number }) => void
  /** ID of the engine line currently open for editing (or null). Used to hide
   *  that line's original text objects during the editing pass so the transparent
   *  textarea appears to edit the PDF directly — no white patch behind the text. */
  editingEngineLineId: string | null
  setEditingEngineLineId: (id: string | null) => void
  registerCommitHandler: (fn: (() => Promise<void>) | null) => void
  commitActiveEdit: () => Promise<void>
  getEdits: () => EditOp[]
}

const Ctx = createContext<EditStoreCtx | null>(null)

export function EditStoreProvider({ children }: { children: ReactNode }) {
  const [editMode, setEditMode] = useState(true)
  const [tool,     setTool]     = useState<EditTool>('select')
  const [edits,    setEdits]    = useState<EditOp[]>([])
  const editsRef = useRef<EditOp[]>([])
  editsRef.current = edits
  const [engineReady, setEngineReady] = useState(false)
  const [engineRevision, setEngineRevision] = useState(0)
  const [waveTrigger, setWaveTrigger] = useState(0)
  const [waveOrigin,  setWaveOrigin]  = useState<{ x: number; y: number } | null>(null)
  const [editingEngineLineId, setEditingEngineLineId] = useState<string | null>(null)
  const redo = useRef<EditOp[]>([])
  const commitHandlerRef = useRef<(() => Promise<void>) | null>(null)

  const registerCommitHandler = useCallback((fn: (() => Promise<void>) | null) => {
    commitHandlerRef.current = fn
  }, [])

  const commitActiveEdit = useCallback(async () => {
    if (commitHandlerRef.current) {
      await commitHandlerRef.current()
    }
  }, [])

  const getEdits = useCallback(() => editsRef.current, [])

  const triggerWave = useCallback((origin?: { x: number; y: number }) => {
    setWaveOrigin(origin ?? null)
    setWaveTrigger(w => w + 1)
  }, [])

  const bumpEngineRevision = useCallback(() => {
    setEngineRevision(r => r + 1)
  }, [])

  const addEdit = useCallback((e: EditOp) => {
    redo.current = []
    editsRef.current = [...editsRef.current, e]
    setEdits(editsRef.current)
  }, [])

  const updateEdit = useCallback((id: string, patch: Partial<EditOp>) => {
    editsRef.current = editsRef.current.map(e => (e.id === id ? { ...e, ...patch } as EditOp : e))
    setEdits(editsRef.current)
  }, [])

  const removeEdit = useCallback((id: string) => {
    editsRef.current = editsRef.current.filter(e => e.id !== id)
    setEdits(editsRef.current)
  }, [])

  const undo = useCallback(() => {
    if (editsRef.current.length === 0) return
    const last = editsRef.current[editsRef.current.length - 1]
    redo.current.push(last)
    editsRef.current = editsRef.current.slice(0, -1)
    setEdits(editsRef.current)
  }, [])

  const redoFn = useCallback(() => {
    const e = redo.current.pop()
    if (e) {
      editsRef.current = [...editsRef.current, e]
      setEdits(editsRef.current)
    }
  }, [])

  const reset = useCallback(() => {
    redo.current = []
    editsRef.current = []
    setEdits([])
    setTool('select')
    setEditMode(true)
    setEngineReady(false)
    setEditingEngineLineId(null)
  }, [])

  return (
    <Ctx.Provider value={{
      editMode, setEditMode, tool, setTool,
      edits, addEdit, updateEdit, removeEdit,
      undo, redo: redoFn, canUndo: edits.length > 0, canRedo: redo.current.length > 0,
      reset,
      engineReady, setEngineReady, engineRevision, bumpEngineRevision,
      waveTrigger, waveOrigin, triggerWave,
      editingEngineLineId, setEditingEngineLineId,
      registerCommitHandler, commitActiveEdit,
      getEdits,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useEditStore(): EditStoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEditStore must be used inside EditStoreProvider')
  return ctx
}
