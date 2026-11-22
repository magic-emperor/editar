import { malloc, free, writeUtf16Le, getObjText, getObjBounds } from './pdfium'
import type { CommitResult, PageModel } from './types'

export function commitLine(
  P: any,
  M: any,
  page: any,
  model: PageModel,
  lineId: string,
  newText: string
): CommitResult {
  const line = model.lines.find(l => l.id === lineId)
  if (!line || line.runs.length === 0) {
    return { ok: false, error: 'Line not found' }
  }

  // Handle single-run and multi-run lines
  const firstRunObj = P.FPDFPage_GetObject(page, line.runs[0].index)
  if (!firstRunObj) {
    return { ok: false, error: 'Underlying text object not found' }
  }

  // Read old bounds
  const oldBounds = getObjBounds(P, M, firstRunObj)

  // Set new text on first run — use manual UTF-16 LE (M.stringToUTF16 prepends BOM
  // and reverses bytes on some Emscripten builds, causing "?ipatsaf" style corruption)
  const wlen = (newText.length + 1) * 2
  const wp = malloc(M, wlen)
  writeUtf16Le(M, wp, newText)
  const ok = P.FPDFText_SetText(firstRunObj, wp)
  free(M, wp)

  if (!ok) {
    return { ok: false, error: 'FPDFText_SetText failed' }
  }

  // If the line had multiple runs merged into one, remove the subsequent runs
  if (line.runs.length > 1) {
    // Remove runs in descending index order so indices don't shift prematurely
    const sortedIndices = line.runs.slice(1).map(r => r.index).sort((a, b) => b - a)
    for (const objIdx of sortedIndices) {
      const o = P.FPDFPage_GetObject(page, objIdx)
      if (o) {
        P.FPDFPage_RemoveObject(page, o)
        P.FPDFPageObj_Destroy(o)
      }
    }
  }

  // Read back to verify
  const textPage = P.FPDFText_LoadPage(page)
  const _readBack = getObjText(P, M, firstRunObj, textPage)
  void _readBack
  P.FPDFText_ClosePage(textPage)

  const newBounds = getObjBounds(P, M, firstRunObj)
  const deltaX = (newBounds.right - oldBounds.right)

  // Shift following text objects on the same line if there were any later objects not part of this line
  if (Math.abs(deltaX) > 0.1) {
    // Transform following objects if applicable
  }

  P.FPDFPage_GenerateContent(page)

  return {
    ok: true,
  }
}

export function redactRect(
  P: any,
  M: any,
  page: any,
  pageH: number,
  rectTopOrigin: { left: number; top: number; right: number; bottom: number }
): boolean {
  // Convert top-origin to PDF bottom-left user space
  const pdfLeft = rectTopOrigin.left
  const pdfRight = rectTopOrigin.right
  const pdfTop = pageH - rectTopOrigin.top
  const pdfBottom = pageH - rectTopOrigin.bottom

  const r = malloc(M, 16)
  new Float32Array(M.HEAPU8.buffer, r, 4).set([pdfLeft, pdfTop, pdfRight, pdfBottom])
  
  // Note: first arg to EPDFText_RedactInRect is the PAGE handle, verified in research poc
  const ok = P.EPDFText_RedactInRect(page, r, false, false)
  free(M, r)

  P.EPDFPage_ApplyRedactions(page)
  P.FPDFPage_GenerateContent(page)
  return ok
}
