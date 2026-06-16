// Cloud converter implementations — POST to the local conversion server.
// Files travel over localhost only; nothing leaves the machine.
import type { ConvertInput, ConvertOptions, ConvertResult } from './registry'

const DEFAULT_SERVER = import.meta.env.VITE_API_URL ?? 'http://localhost:5050'

async function post(
  serverUrl: string,
  endpoint: string,
  bytes: Uint8Array,
  filename: string,
): Promise<Uint8Array> {
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart]), filename)

  const res = await fetch(`${serverUrl}${endpoint}`, { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `Server error ${res.status}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

// ── PDF → Word (.docx) ────────────────────────────────────────────────────────

export async function cloudPdf2Docx(
  input: ConvertInput,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const { bytes, name } = input.pdf!
  const serverUrl = opts.serverUrl ?? DEFAULT_SERVER
  const out = await post(serverUrl, '/convert/pdf2docx', bytes, name)
  const stem = name.replace(/\.pdf$/i, '')
  return {
    files: [{
      name: `${stem}.docx`,
      bytes: out,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }],
  }
}

// ── Translate PDF (any language → any language via Argos Translate) ───────────

export async function cloudTranslatePdf(
  input: ConvertInput,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const { bytes, name } = input.pdf!
  const serverUrl = opts.serverUrl ?? DEFAULT_SERVER

  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart]), name)
  form.append('source_lang', opts.sourceLang ?? 'auto')
  form.append('target_lang', opts.targetLang ?? 'en')

  const res = await fetch(`${serverUrl}/convert/translate-pdf`, {
    method: 'POST',
    body:   form,
    signal: AbortSignal.timeout(300_000),  // 5 min — model download + large docs
  })

  if (!res.ok) {
    let msg = `Server error ${res.status}`
    try { const b = await res.json(); msg = b.detail ?? b.error ?? msg } catch { /* */ }
    throw new Error(msg)
  }

  const out      = new Uint8Array(await res.arrayBuffer())
  const stem     = name.replace(/\.pdf$/i, '')
  const langLabel = opts.targetLang ?? 'translated'
  return {
    files: [{ name: `${stem}-${langLabel}.pdf`, bytes: out, mime: 'application/pdf' }],
  }
}

// ── Office → PDF (.docx / .xlsx) ─────────────────────────────────────────────

export async function cloudOffice2Pdf(
  input: ConvertInput,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const file = input.files?.[0]
  if (!file) throw new Error('No file provided')
  const serverUrl = opts.serverUrl ?? DEFAULT_SERVER
  const bytes = new Uint8Array(await file.arrayBuffer())
  const out = await post(serverUrl, '/convert/office2pdf', bytes, file.name)
  const stem = file.name.replace(/\.[^.]+$/, '')
  return {
    files: [{ name: `${stem}.pdf`, bytes: out, mime: 'application/pdf' }],
  }
}
