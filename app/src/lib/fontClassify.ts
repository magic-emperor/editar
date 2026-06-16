// Name-based font classification — the deliberate seam where IntelliFont plugs in
// later (its identify_from_buffer can override `family` worker-side for the case of a
// digital font that's missing a typed glyph). For now this pure heuristic is shared by
// both the DOM preview (main thread) and the redraw op (worker), so they always agree.
//
// pdf.js font refs look like "ABCDEF+TimesNewRoman-BoldItalic", "Helvetica", or — when
// the embedded font name is garbled — "g_d0_f1" (falls through to the sans default).

import type { FontFamily } from './types'

// Dropdown labels for the editor font picker (also defines the available set + order).
export const FAMILY_LABELS: Record<FontFamily, string> = {
  sans:       'Sans (DejaVu)',
  serif:      'Serif (DejaVu)',
  mono:       'Mono (DejaVu)',
  roboto:     'Roboto',
  ptserif:    'PT Serif',
  robotomono: 'Roboto Mono',
}

export interface FontClass { family: FontFamily; bold: boolean; italic: boolean }

export function classifyFamily(fontName?: string): FontClass {
  const n = (fontName ?? '').toLowerCase()

  const bold   = /bold|black|heavy|semibold|[-_ ]bd\b/.test(n)
  const italic = /italic|oblique|[-_ ]it\b/.test(n)

  let family: FontFamily = 'sans'
  if (/mono|courier|consol|typewriter|menlo|inconsolata/.test(n)) family = 'mono'
  else if (/times|georgia|serif|roman|garamond|minion|cambria|palatino|book ?antiqua|baskerville/.test(n))
    family = 'serif'
  // else: arial, helvetica, calibri, verdana, segoe, etc. → sans (default)

  return { family, bold, italic }
}

// Maps (family, bold, italic) → the self-hosted bundled TTF filename under /fonts/edit/.
export function bundledFontFile(family: FontFamily, bold: boolean, italic: boolean): string {
  const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular'
  return `${family}-${style}.ttf`
}
