// Font resolution for the redraw op (runs in the worker).
//
// v1 = name-based: map the edit's resolved (family, bold, italic) to a self-hosted
// bundled DejaVu face and embed it. Embedded-font *reuse* (pixel-identical edits on
// digital pages) is the planned enhancement; `resolveFont` is structured so it can be
// tried first and fall back here. IntelliFont would refine `style.family` upstream
// (see classifyFamily / the phase-3 plan) — this module just consumes the family.

import type { PDFDocument, PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { bundledFontFile } from './fontClassify'
import type { EditStyle } from './types'

// Bundled TTF bytes, cached across ops (the worker is long-lived).
const fontBytesCache = new Map<string, Uint8Array>()

// Parsed fontkit instances for embedded fonts, keyed by fontName (for glyph-coverage checks).
const fkCache = new Map<string, { hasGlyphForCodePoint(cp: number): boolean } | null>()

// True only if the embedded font has a glyph for every non-space char in `text`.
function embeddedCovers(fontName: string, bytes: Uint8Array, text: string): boolean {
  const ck = `${fontName}:${bytes.byteLength}`   // name+size avoids cross-document collisions
  let fk = fkCache.get(ck)
  if (fk === undefined) {
    try { fk = fontkit.create(bytes) as unknown as { hasGlyphForCodePoint(cp: number): boolean } }
    catch { fk = null }
    fkCache.set(ck, fk)
  }
  if (!fk) return false
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    const cp = ch.codePointAt(0)
    if (cp === undefined || !fk.hasGlyphForCodePoint(cp)) return false
  }
  return true
}

async function loadBundledFontBytes(file: string): Promise<Uint8Array> {
  const cached = fontBytesCache.get(file)
  if (cached) return cached
  const res = await fetch(`/fonts/edit/${file}`)
  if (!res.ok) throw new Error(`Edit font ${file} failed to load (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  fontBytesCache.set(file, bytes)
  return bytes
}

/**
 * Resolve an embeddable PDFFont for one edit. Prefers the document's OWN embedded font
 * (pixel-faithful) when it covers every glyph in `newText`; otherwise falls back to a
 * bundled DejaVu face. `perDoc` caches embedded fonts within a single editPage op.
 * fontkit must already be registered on `doc`.
 */
export async function resolveFont(
  doc:     PDFDocument,
  style:   EditStyle,
  newText: string,
  perDoc:  Map<string, PDFFont>,
): Promise<PDFFont> {
  // 1) Reuse the document's own embedded font when it has all the needed glyphs.
  if (style.embeddedFont && style.embeddedFont.byteLength > 4 && style.fontName &&
      embeddedCovers(style.fontName, style.embeddedFont, newText)) {
    const key = `emb:${style.fontName}`
    const hit = perDoc.get(key)
    if (hit) return hit
    try {
      const font = await doc.embedFont(style.embeddedFont, { subset: true })
      perDoc.set(key, font)
      return font
    } catch { /* fall through to bundled */ }
  }

  // 2) Bundled fallback by classified family.
  const file = bundledFontFile(style.family, style.bold, style.italic)
  const cached = perDoc.get(file)
  if (cached) return cached
  const bytes = await loadBundledFontBytes(file)
  const font  = await doc.embedFont(bytes, { subset: true })
  perDoc.set(file, font)
  return font
}
