import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnnotationKind = 'highlight' | 'underline' | 'strikethrough' | 'note'

export interface AnnotationRect { x: number; y: number; w: number; h: number }

export interface Annotation {
  id:        string
  kind:      AnnotationKind
  pageIndex: number
  rects:     AnnotationRect[]
  color:     string
  note?:     string
  anchorPos?: { x: number; y: number }
}

type AnnotateTool = AnnotationKind | null

interface AnnotationStoreCtx {
  annotations:       Annotation[]
  activeTool:        AnnotateTool
  highlightColor:    string
  addAnnotation:     (a: Omit<Annotation, 'id'>) => void
  updateAnnotation:  (id: string, updates: Partial<Annotation>) => void
  removeAnnotation:  (id: string) => void
  setActiveTool:     (t: AnnotateTool) => void
  setHighlightColor: (c: string) => void
  loadForDoc:        (docId: string) => void
  clearAnnotations:  () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const Ctx = createContext<AnnotationStoreCtx | null>(null)

const STORAGE_KEY = (docId: string) => `ld_annotations_${docId}`
const DEFAULT_COLOR = '#ffeb3b'

function loadAnnotations(docId: string): Annotation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(docId))
    return raw ? (JSON.parse(raw) as Annotation[]) : []
  } catch { return [] }
}

function saveAnnotations(docId: string, list: Annotation[]): void {
  try { localStorage.setItem(STORAGE_KEY(docId), JSON.stringify(list)) } catch {}
}

export function AnnotationStoreProvider({ children }: { children: ReactNode }) {
  const [annotations,    setAnnotations]    = useState<Annotation[]>([])
  const [activeTool,     setActiveToolState] = useState<AnnotateTool>(null)
  const [highlightColor, setHighlightColor] = useState(DEFAULT_COLOR)
  const [currentDocId,   setCurrentDocId]   = useState<string | null>(null)

  const addAnnotation = useCallback((a: Omit<Annotation, 'id'>) => {
    const id = crypto.randomUUID()
    setAnnotations(prev => {
      const next = [...prev, { ...a, id }]
      if (currentDocId) saveAnnotations(currentDocId, next)
      return next
    })
  }, [currentDocId])

  const updateAnnotation = useCallback((id: string, updates: Partial<Annotation>) => {
    setAnnotations(prev => {
      const next = prev.map(a => a.id === id ? { ...a, ...updates } : a)
      if (currentDocId) saveAnnotations(currentDocId, next)
      return next
    })
  }, [currentDocId])

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => {
      const next = prev.filter(a => a.id !== id)
      if (currentDocId) saveAnnotations(currentDocId, next)
      return next
    })
  }, [currentDocId])

  const setActiveTool = useCallback((t: AnnotateTool) => {
    setActiveToolState(t)
  }, [])

  const loadForDoc = useCallback((docId: string) => {
    setCurrentDocId(docId)
    setAnnotations(loadAnnotations(docId))
  }, [])

  const clearAnnotations = useCallback(() => {
    setAnnotations([])
    setCurrentDocId(null)
    setActiveToolState(null)
  }, [])

  return (
    <Ctx.Provider value={{
      annotations, activeTool, highlightColor,
      addAnnotation, updateAnnotation, removeAnnotation,
      setActiveTool, setHighlightColor, loadForDoc, clearAnnotations,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAnnotationStore(): AnnotationStoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAnnotationStore must be inside AnnotationStoreProvider')
  return ctx
}
