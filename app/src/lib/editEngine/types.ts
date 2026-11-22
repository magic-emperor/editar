export interface EditRun {
  index: number // object index in FPDFPage
  text: string
  left: number // PDF points, top-left origin
  top: number
  right: number
  bottom: number
  baseline: number
  fontSize: number
  color: [number, number, number, number] // RGBA 0-255
  fontName: string
  isEmbedded: boolean
  editable: boolean
  nonEditableReason?: string
}

export interface EditLine {
  id: string
  runs: EditRun[]
  text: string
  left: number
  top: number
  right: number
  bottom: number
  baseline: number
  fontSize: number
  editable: boolean
}

export interface EditBlock {
  id: string
  lines: EditLine[]
  left: number
  top: number
  right: number
  bottom: number
}

export interface PageModel {
  pageIndex: number
  width: number
  height: number
  lines: EditLine[]
  blocks: EditBlock[]
}

export interface CommitResult {
  ok: boolean
  error?: string
  fallback?: {
    missing: string[]
    family: string
  }
}
