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
}

const Ctx = createContext<EditStoreCtx | null>(null)

export function EditStoreProvider({ children }: { children: ReactNode }) {
  const [editMode, setEditMode] = useState(false)
  const [tool,     setTool]     = useState<EditTool>('select')
  const [edits,    setEdits]    = useState<EditOp[]>([])
  const redo = useRef<EditOp[]>([])

  const addEdit = useCallback((e: EditOp) => {
    redo.current = []
    setEdits(prev => [...prev, e])
  }, [])

  const updateEdit = useCallback((id: string, patch: Partial<EditOp>) => {
    setEdits(prev => prev.map(e => (e.id === id ? { ...e, ...patch } as EditOp : e)))
  }, [])

  const removeEdit = useCallback((id: string) => {
    setEdits(prev => prev.filter(e => e.id !== id))
  }, [])

  const undo = useCallback(() => {
    setEdits(prev => {
      if (prev.length === 0) return prev
      redo.current.push(prev[prev.length - 1])
      return prev.slice(0, -1)
    })
  }, [])

  const redoFn = useCallback(() => {
    const e = redo.current.pop()
    if (e) setEdits(prev => [...prev, e])
  }, [])

  const reset = useCallback(() => {
    redo.current = []
    setEdits([])
    setTool('select')
    setEditMode(false)
  }, [])

  return (
    <Ctx.Provider value={{
      editMode, setEditMode, tool, setTool,
      edits, addEdit, updateEdit, removeEdit,
      undo, redo: redoFn, canUndo: edits.length > 0, canRedo: redo.current.length > 0,
      reset,
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
