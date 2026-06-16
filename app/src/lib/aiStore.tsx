import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import type { ExtractionResult } from './types'

const DEFAULT_SERVER_URL =
  import.meta.env.VITE_AI_SERVER_URL ?? 'http://localhost:5051'

export type AIMode = 'off' | 'ocr' | 'table' | 'extract'

interface AIStoreCtx {
  licenseKey:       string | null
  setLicenseKey:    (key: string | null) => void
  aiServerUrl:      string
  consentedDocs:    Set<string>
  consentDoc:       (docId: string) => void
  aiMode:           AIMode
  setAiMode:        (m: AIMode) => void
  corrections:      Map<string, string>        // "pageIdx:itemIdx" → accepted correction
  acceptCorrection: (k: string, v: string) => void
  tableCorrections: Record<string, string>     // "row:col" → accepted correction
  acceptTableCorrection: (k: string, v: string) => void
  extractions:      ExtractionResult | null
  setExtractions:   (r: ExtractionResult | null) => void
  resetAIState:     () => void
}

const Ctx = createContext<AIStoreCtx | null>(null)

export function AIStoreProvider({ children }: { children: ReactNode }) {
  const [licenseKey, setLicenseKeyRaw] = useState<string | null>(() =>
    localStorage.getItem('ai_license_key'),
  )
  const [consentedDocs, setConsentedDocs] = useState<Set<string>>(new Set())
  const [aiMode, setAiMode]         = useState<AIMode>('off')
  const [corrections, setCorrections] = useState<Map<string, string>>(new Map())
  const [tableCorrections, setTableCorrections] = useState<Record<string, string>>({})
  const [extractions, setExtractions] = useState<ExtractionResult | null>(null)

  const setLicenseKey = useCallback((key: string | null) => {
    setLicenseKeyRaw(key)
    if (key) localStorage.setItem('ai_license_key', key)
    else localStorage.removeItem('ai_license_key')
  }, [])

  const consentDoc = useCallback((docId: string) => {
    setConsentedDocs(prev => new Set([...prev, docId]))
  }, [])

  const acceptCorrection = useCallback((k: string, v: string) => {
    setCorrections(prev => new Map([...prev, [k, v]]))
  }, [])

  const acceptTableCorrection = useCallback((k: string, v: string) => {
    setTableCorrections(prev => ({ ...prev, [k]: v }))
  }, [])

  const resetAIState = useCallback(() => {
    setAiMode('off')
    setCorrections(new Map())
    setTableCorrections({})
    setExtractions(null)
    // consentedDocs intentionally cleared on reset (new document)
    setConsentedDocs(new Set())
  }, [])

  return (
    <Ctx.Provider value={{
      licenseKey, setLicenseKey,
      aiServerUrl: DEFAULT_SERVER_URL,
      consentedDocs, consentDoc,
      aiMode, setAiMode,
      corrections, acceptCorrection,
      tableCorrections, acceptTableCorrection,
      extractions, setExtractions,
      resetAIState,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAIStore(): AIStoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAIStore must be used inside AIStoreProvider')
  return ctx
}
