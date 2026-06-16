// Table detection cache — mirrors the textLayer.ts pattern exactly.
// loadPageTextLayer is called first (its result is already cached there),
// then detectTables runs on the items and the result is cached here.

import { loadPageTextLayer } from './textLayer'
import { detectTables } from './tableDetection'
import type { DetectedTable } from './types'

const cache    = new Map<string, DetectedTable[]>()
const inflight = new Map<string, Promise<DetectedTable[]>>()

const key = (docId: string, pageIndex: number) => `${docId}:${pageIndex}`

export function getCachedTables(docId: string, pageIndex: number): DetectedTable[] | undefined {
  return cache.get(key(docId, pageIndex))
}

export function loadPageTables(
  docId: string,
  bytes: Uint8Array,
  pageIndex: number,
): Promise<DetectedTable[]> {
  const k = key(docId, pageIndex)
  const cached = cache.get(k)
  if (cached) return Promise.resolve(cached)
  const running = inflight.get(k)
  if (running) return running

  const task = (async () => {
    const layer  = await loadPageTextLayer(docId, bytes, pageIndex)
    const tables = detectTables(layer.items, pageIndex)
    cache.set(k, tables)
    return tables
  })().finally(() => inflight.delete(k))

  inflight.set(k, task)
  return task
}

export function clearTableCache(docId?: string): void {
  if (!docId) { cache.clear(); inflight.clear(); return }
  for (const k of [...cache.keys()])    if (k.startsWith(`${docId}:`)) cache.delete(k)
  for (const k of [...inflight.keys()]) if (k.startsWith(`${docId}:`)) inflight.delete(k)
}
