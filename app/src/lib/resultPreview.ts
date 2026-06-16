export function dl(bytes: Uint8Array, name: string, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export type PreviewKind = 'text' | 'image' | 'pdf' | 'none'

export function previewKind(mime: string): PreviewKind {
  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv' || mime === 'application/json') return 'text'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  return 'none'
}
