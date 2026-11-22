import type { EditBlock, EditLine, EditRun, PageModel } from './types'
import { malloc, free, getObjText, getObjBounds } from './pdfium'

export function buildPageModel(P: any, M: any, page: any, pageIndex: number): PageModel {
  const pageH = P.FPDF_GetPageHeightF ? P.FPDF_GetPageHeightF(page) : P.FPDF_GetPageHeight(page)
  const pageW = P.FPDF_GetPageWidthF ? P.FPDF_GetPageWidthF(page) : P.FPDF_GetPageWidth(page)
  const textPage = P.FPDFText_LoadPage(page)

  const count = P.FPDFPage_CountObjects(page)
  const runs: EditRun[] = []

  const matrixPtr = malloc(M, 24)
  const sizePtr = malloc(M, 4)
  const colorPtr = malloc(M, 16)
  const fontNamePtr = malloc(M, 256)

  for (let i = 0; i < count; i++) {
    const obj = P.FPDFPage_GetObject(page, i)
    if (P.FPDFPageObj_GetType(obj) !== 1) continue // 1 = FPDF_PAGEOBJ_TEXT

    const text = getObjText(P, M, obj, textPage)
    if (!text || text.trim() === '') continue

    const b = getObjBounds(P, M, obj)

    P.FPDFPageObj_GetMatrix(obj, matrixPtr)
    const m = [...new Float32Array(M.HEAPU8.buffer, matrixPtr, 6)]

    P.FPDFTextObj_GetFontSize(obj, sizePtr)
    const rawFontSize = new Float32Array(M.HEAPU8.buffer, sizePtr, 1)[0]
    const effSize = rawFontSize * Math.hypot(m[2], m[3])

    P.FPDFPageObj_GetFillColor(obj, colorPtr, colorPtr + 4, colorPtr + 8, colorPtr + 12)
    const color = [...new Uint32Array(M.HEAPU8.buffer, colorPtr, 4)] as [number, number, number, number]

    const font = P.FPDFTextObj_GetFont(obj)
    P.FPDFFont_GetBaseFontName(font, fontNamePtr, 256)
    const fontName = M.UTF8ToString(fontNamePtr)
    const isEmbedded = !!P.FPDFFont_GetIsEmbedded(font)

    // Convert PDF bottom-left to top-left points
    const topOriginLeft = b.left
    const topOriginRight = b.right
    const topOriginTop = pageH - b.top
    const topOriginBottom = pageH - b.bottom
    const topOriginBaseline = pageH - m[5]

    const isRotated = Math.abs(m[1]) > 0.05 || Math.abs(m[2]) > 0.05

    runs.push({
      index: i,
      text,
      left: topOriginLeft,
      top: topOriginTop,
      right: topOriginRight,
      bottom: topOriginBottom,
      baseline: topOriginBaseline,
      fontSize: effSize > 0 ? effSize : rawFontSize,
      color,
      fontName,
      isEmbedded,
      editable: !isRotated,
      nonEditableReason: isRotated ? 'rotated' : undefined,
    })
  }

  free(M, matrixPtr)
  free(M, sizePtr)
  free(M, colorPtr)
  free(M, fontNamePtr)
  P.FPDFText_ClosePage(textPage)

  // Cluster runs into lines
  // Sort by baseline (top to bottom) then left (left to right)
  runs.sort((a, b) => {
    if (Math.abs(a.baseline - b.baseline) > 3) {
      return a.baseline - b.baseline
    }
    return a.left - b.left
  })

  const lines: EditLine[] = []
  let currentRuns: EditRun[] = []

  for (const run of runs) {
    if (currentRuns.length === 0) {
      currentRuns.push(run)
      continue
    }

    const prev = currentRuns[currentRuns.length - 1]
    const sameBaseline = Math.abs(run.baseline - prev.baseline) < Math.max(3, prev.fontSize * 0.25)
    const gap = run.left - prev.right
    const closeHorizontally = gap < Math.max(15, prev.fontSize * 2.0)

    if (sameBaseline && closeHorizontally) {
      currentRuns.push(run)
    } else {
      lines.push(createLineFromRuns(currentRuns, lines.length))
      currentRuns = [run]
    }
  }

  if (currentRuns.length > 0) {
    lines.push(createLineFromRuns(currentRuns, lines.length))
  }

  // Cluster lines into blocks
  const blocks: EditBlock[] = []
  let currentLines: EditLine[] = []

  for (const line of lines) {
    if (currentLines.length === 0) {
      currentLines.push(line)
      continue
    }

    const prev = currentLines[currentLines.length - 1]
    const baselineStep = line.baseline - prev.baseline
    const reasonableStep = baselineStep > 0 && baselineStep < prev.fontSize * 2.2
    const alignedLeft = Math.abs(line.left - prev.left) < 15

    if (reasonableStep && alignedLeft) {
      currentLines.push(line)
    } else {
      blocks.push(createBlockFromLines(currentLines, blocks.length))
      currentLines = [line]
    }
  }

  if (currentLines.length > 0) {
    blocks.push(createBlockFromLines(currentLines, blocks.length))
  }

  return {
    pageIndex,
    width: pageW,
    height: pageH,
    lines,
    blocks,
  }
}

function createLineFromRuns(runs: EditRun[], idx: number): EditLine {
  runs.sort((a, b) => a.left - b.left)
  let lineText = ''
  for (let i = 0; i < runs.length; i++) {
    if (i > 0) {
      const prev = runs[i - 1]
      const gap = runs[i].left - prev.right
      if (gap > prev.fontSize * 0.1) {
        lineText += ' '
      }
    }
    lineText += runs[i].text
  }

  const left = Math.min(...runs.map(r => r.left))
  const top = Math.min(...runs.map(r => r.top))
  const right = Math.max(...runs.map(r => r.right))
  const bottom = Math.max(...runs.map(r => r.bottom))
  const baseline = runs[0].baseline
  const fontSize = runs[0].fontSize
  const editable = runs.every(r => r.editable)

  return {
    id: `line-${idx}`,
    runs,
    text: lineText,
    left,
    top,
    right,
    bottom,
    baseline,
    fontSize,
    editable,
  }
}

function createBlockFromLines(lines: EditLine[], idx: number): EditBlock {
  const left = Math.min(...lines.map(l => l.left))
  const top = Math.min(...lines.map(l => l.top))
  const right = Math.max(...lines.map(l => l.right))
  const bottom = Math.max(...lines.map(l => l.bottom))

  return {
    id: `block-${idx}`,
    lines,
    left,
    top,
    right,
    bottom,
  }
}
