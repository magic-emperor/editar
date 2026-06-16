import type { ExtractionResult } from './types'

export class AIAuthError extends Error {
  constructor() { super('Invalid license key') }
}

export class AIRateLimitError extends Error {
  constructor() { super('Rate limit exceeded — 10 req/min per license key') }
}

async function post<T>(url: string, key: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'X-License-Key': key,
    },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw new AIAuthError()
  if (res.status === 429) throw new AIRateLimitError()
  if (!res.ok) throw new Error(`AI server error ${res.status}`)
  return res.json() as Promise<T>
}

export async function correctOCRWord(
  key:        string,
  serverUrl:  string,
  word:       string,
  ctxBefore:  string,
  ctxAfter:   string,
  confidence: number,
): Promise<string> {
  const data = await post<{ correction: string }>(
    `${serverUrl}/ai/ocr/correct`,
    key,
    { word, context_before: ctxBefore, context_after: ctxAfter, confidence },
  )
  return data.correction
}

export async function cleanupTable(
  key:         string,
  serverUrl:   string,
  rows:        string[][],
  pageContext: string,
): Promise<Record<string, string>> {
  const data = await post<{ corrections: Record<string, string> }>(
    `${serverUrl}/ai/table/cleanup`,
    key,
    { rows, page_context: pageContext },
  )
  return data.corrections
}

export async function extractFromDocument(
  key:       string,
  serverUrl: string,
  text:      string,
  pageCount: number,
): Promise<ExtractionResult> {
  return post<ExtractionResult>(
    `${serverUrl}/ai/extract`,
    key,
    { text, page_count: pageCount },
  )
}
