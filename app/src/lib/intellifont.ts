import init, { identify_from_buffer } from './wasm/intellifont/intellifont_wasm.js'

const DB_URL = '/intellifont/glyph_signatures.bin'
const MIN_CONFIDENCE = 0.70

export interface FontMatch {
  family:     string
  confidence: number
}

// Module-level cache so we never re-identify the same embedded font bytes
const cache = new Map<string, FontMatch | null>()

function cacheKey(fontName: string): string {
  return fontName
}

// Lazily load the wasm module and the glyph signature database once per session.
let dbPromise: Promise<Uint8Array> | null = null
async function loadDb(): Promise<Uint8Array> {
  if (!dbPromise) {
    dbPromise = (async () => {
      await init()
      const res = await fetch(DB_URL)
      if (!res.ok) throw new Error(`glyph db fetch failed (${res.status})`)
      return new Uint8Array(await res.arrayBuffer())
    })()
  }
  return dbPromise
}

/**
 * Identify the visual font family for an embedded font, entirely client-side via wasm.
 * Returns null if the database fails to load, confidence is too low, or identification fails.
 * Caches results per fontName for the session.
 */
export async function identifyFont(fontName: string, bytes: Uint8Array): Promise<FontMatch | null> {
  const key = cacheKey(fontName)
  if (cache.has(key)) return cache.get(key)!

  try {
    const db = await loadDb()
    const json = identify_from_buffer(bytes, 'RQWMabcde012', db, 1)
    const matches = JSON.parse(json) as Array<{ family: string; confidence: number }>
    const best = matches[0]
    const match: FontMatch | null = best && best.family && best.confidence >= MIN_CONFIDENCE
      ? { family: best.family, confidence: best.confidence }
      : null
    cache.set(key, match)
    return match
  } catch {
    cache.set(key, null)
    return null
  }
}

/** Clear the identification cache (call on document close). */
export function clearFontCache(): void {
  cache.clear()
}
