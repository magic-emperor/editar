const SERVER_URL = 'http://127.0.0.1:5050'

export interface TranslationResult {
  translated:    string
  detected_lang: string
  error?:        string
}

export interface TranslationBlock {
  text:       string
  translated: string
  bbox:       [number, number, number, number]   // x0, y0, x1, y1 in PDF points
}

export interface TranslationMeta {
  page_width:    number
  page_height:   number
  detected_lang: string
}

export interface PageTranslationResult {
  blocks: TranslationBlock[]
  meta:   TranslationMeta
  error?: string
}

export async function translateText(
  text:   string,
  toLang: string = 'en',
): Promise<TranslationResult> {
  const res = await fetch(`${SERVER_URL}/translate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text, to_lang: toLang }),
    signal:  AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      msg = body.detail ?? body.error ?? JSON.stringify(body)
    } catch {
      msg = await res.text().catch(() => `HTTP ${res.status}`)
    }
    return { translated: text, detected_lang: 'unknown', error: msg }
  }
  return res.json() as Promise<TranslationResult>
}

// Sends PDF bytes to the server, which uses PyMuPDF to extract text with
// line-level bounding boxes and translates via Google Translate.
// Returns blocks suitable for rendering as an in-page overlay.
export async function translatePageBlocks(
  bytes:      Uint8Array,
  pageIndex:  number,
  targetLang: string = 'en',
  serverUrl:  string = SERVER_URL,
): Promise<PageTranslationResult> {
  const EMPTY_META: TranslationMeta = { page_width: 0, page_height: 0, detected_lang: 'unknown' }

  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart], { type: 'application/pdf' }), 'input.pdf')
  form.append('page_index', String(pageIndex))
  form.append('target_lang', targetLang)

  try {
    const res = await fetch(`${serverUrl}/translate/page`, {
      method: 'POST',
      body:   form,
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const body = await res.json()
        msg = body.detail ?? body.error ?? JSON.stringify(body)
      } catch {
        msg = await res.text().catch(() => `HTTP ${res.status}`)
      }
      return { blocks: [], meta: EMPTY_META, error: msg }
    }

    const data = await res.json()
    return {
      blocks: (data.blocks ?? []) as TranslationBlock[],
      meta: {
        page_width:    data.page_width  ?? 0,
        page_height:   data.page_height ?? 0,
        detected_lang: data.detected_lang ?? 'unknown',
      },
    }
  } catch (e: unknown) {
    return { blocks: [], meta: EMPTY_META, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function unloadTranslator(): Promise<void> {
  await fetch(`${SERVER_URL}/translate/unload`, { method: 'POST' }).catch(() => {})
}
