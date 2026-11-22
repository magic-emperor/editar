import { getPdfium, malloc, free, saveDocToBytes, writeUtf16Le } from './pdfium'
import { buildPageModel } from './model'
import { commitLine, redactRect } from './commit'
import type { PageModel, CommitResult } from './types'

let P: any = null
let M: any = null
let doc: any = null
let docBuf: number = 0
let loadedPages = new Map<number, any>()
let pageModels = new Map<number, PageModel>()
let undoStack: Uint8Array[] = []
let redoStack: Uint8Array[] = []

export type EditWorkerReq =
  | { type: 'init'; id: string; bytes: Uint8Array }
  | { type: 'getPageModel'; id: string; pageIndex: number }
  | { type: 'hitTest'; id: string; pageIndex: number; x: number; y: number }
  | { type: 'commitLine'; id: string; pageIndex: number; lineId: string; newText: string }
  | { type: 'commitRun'; id: string; pageIndex: number; objIndex: number; newText: string }
  | { type: 'commitRunV2'; id: string; pageIndex: number; objIndex: number; newText: string; style?: { size?: number; color?: [number, number, number]; family?: string; bold?: boolean; italic?: boolean }; newPos?: { x: number; y: number }; initialPos?: { x: number; y: number } }
  | { type: 'redact'; id: string; pageIndex: number; rect: { left: number; top: number; right: number; bottom: number } }
  | { type: 'renderPage'; id: string; pageIndex: number; scale: number; hideLineId?: string }
  | { type: 'undo'; id: string }
  | { type: 'redo'; id: string }
  | { type: 'save'; id: string }
  | { type: 'close'; id: string }

export type EditWorkerRes =
  | { type: 'init'; id: string; ok: true }
  | { type: 'getPageModel'; id: string; ok: true; model: PageModel }
  | { type: 'hitTest'; id: string; ok: true; line: any | null }
  | { type: 'commitLine'; id: string; ok: true; result: CommitResult; model: PageModel }
  | { type: 'commitRun'; id: string; ok: true; model: PageModel }
  | { type: 'commitRunV2'; id: string; ok: true; model: PageModel }
  | { type: 'redact'; id: string; ok: true; success: boolean; model: PageModel }
  | { type: 'renderPage'; id: string; ok: true; bitmap: ImageBitmap }
  | { type: 'undo'; id: string; ok: true }
  | { type: 'redo'; id: string; ok: true }
  | { type: 'save'; id: string; ok: true; bytes: Uint8Array }
  | { type: 'close'; id: string; ok: true }
  | { id: string; ok: false; error: string }

function cleanupDoc() {
  if (P) {
    for (const page of loadedPages.values()) {
      P.FPDF_ClosePage(page)
    }
    loadedPages.clear()
    pageModels.clear()
    if (doc) {
      P.FPDF_CloseDocument(doc)
      doc = null
    }
    if (docBuf && M) {
      free(M, docBuf)
      docBuf = 0
    }
  }
}

function loadPage(pageIndex: number) {
  if (loadedPages.has(pageIndex)) return loadedPages.get(pageIndex)
  const page = P.FPDF_LoadPage(doc, pageIndex)
  loadedPages.set(pageIndex, page)
  return page
}

// ── Font helpers for commitRunV2 ───────────────────────────────────────────────

/**
 * Detect PDF subset font prefix (e.g. "BCDEEE+Calibri" → true).
 * Subset fonts are missing glyphs for characters not in the original text —
 * especially the space glyph — so we must fall back to a standard font.
 */
function isSubsetFont(fontName: string): boolean {
  return /^[A-Z]{6}\+/.test(fontName)
}

self.onmessage = async (e: MessageEvent<EditWorkerReq>) => {
  const req = e.data
  try {
    if (!P || !M) {
      const initRes = await getPdfium()
      P = initRes.P
      M = initRes.M
    }

    switch (req.type) {
      case 'init': {
        // Guard: if the doc is already loaded with this exact byte length, skip re-init.
        // A 2-page PDF causes two EditLayers to call initEditSession concurrently.
        // Both send 'init'; processing the second would close the first's loaded doc.
        if (doc) {
          self.postMessage({ type: 'init', id: req.id, ok: true })
          break
        }
        cleanupDoc()
        undoStack = [req.bytes]
        redoStack = []
        docBuf = malloc(M, req.bytes.length)
        M.HEAPU8.set(req.bytes, docBuf)
        doc = P.FPDF_LoadMemDocument(docBuf, req.bytes.length, '')
        if (!doc) throw new Error('FPDF_LoadMemDocument failed')
        self.postMessage({ type: 'init', id: req.id, ok: true })
        break
      }

      case 'getPageModel': {
        const page = loadPage(req.pageIndex)
        const model = buildPageModel(P, M, page, req.pageIndex)
        pageModels.set(req.pageIndex, model)
        self.postMessage({ type: 'getPageModel', id: req.id, ok: true, model })
        break
      }

      case 'hitTest': {
        const page = loadPage(req.pageIndex)
        let model = pageModels.get(req.pageIndex)
        if (!model) {
          model = buildPageModel(P, M, page, req.pageIndex)
          pageModels.set(req.pageIndex, model)
        }

        // Hit-test lines
        let hitLine: any = null
        for (const line of model.lines) {
          if (
            req.x >= line.left - 4 &&
            req.x <= line.right + 4 &&
            req.y >= line.top - 2 &&
            req.y <= line.bottom + 2
          ) {
            hitLine = line
            break
          }
        }
        self.postMessage({ type: 'hitTest', id: req.id, ok: true, line: hitLine })
        break
      }

      case 'commitLine': {
        const page = loadPage(req.pageIndex)
        let model = pageModels.get(req.pageIndex)
        if (!model) {
          model = buildPageModel(P, M, page, req.pageIndex)
        }

        // Push snapshot before mutating
        const snapshot = saveDocToBytes(P, M, doc)
        undoStack.push(snapshot)
        if (undoStack.length > 20) undoStack.shift()
        redoStack = []

        const result = commitLine(P, M, page, model, req.lineId, req.newText)
        const updatedModel = buildPageModel(P, M, page, req.pageIndex)
        pageModels.set(req.pageIndex, updatedModel)

        self.postMessage({
          type: 'commitLine',
          id: req.id,
          ok: true,
          result,
          model: updatedModel,
        })
        break
      }

      case 'commitRun': {
        const page = loadPage(req.pageIndex)

        // Push undo snapshot before mutating
        const runSnapshot = saveDocToBytes(P, M, doc)
        undoStack.push(runSnapshot)
        if (undoStack.length > 20) undoStack.shift()
        redoStack = []

        const obj = P.FPDFPage_GetObject(page, req.objIndex)
        if (!obj) throw new Error(`Page object ${req.objIndex} not found`)

        const wlen = (req.newText.length + 1) * 2
        const wp = malloc(M, wlen)
        writeUtf16Le(M, wp, req.newText)
        P.FPDFText_SetText(obj, wp)
        free(M, wp)
        P.FPDFPage_GenerateContent(page)

        const updatedRunModel = buildPageModel(P, M, page, req.pageIndex)
        pageModels.set(req.pageIndex, updatedRunModel)

        self.postMessage({ type: 'commitRun', id: req.id, ok: true, model: updatedRunModel })
        break
      }

      case 'commitRunV2': {
        // ── Remove + Recreate approach ──────────────────────────────────────
        // FPDFText_SetText on an EXISTING object corrupts its TJ/Td positioning
        // operators → justified spacing and □ boxes for spaces in subset fonts.
        // On a FRESH object created by FPDFPageObj_CreateTextObj there are no
        // operators to corrupt, so SetText produces clean output.
        //
        // For subset fonts (BCDEEE+Calibri style) the embedded font file lacks
        // glyphs for characters not in the original text. We fall back to a
        // standard PDF font (Helvetica/Times/Courier) so all glyphs are present.
        const page = loadPage(req.pageIndex)
        const obj = P.FPDFPage_GetObject(page, req.objIndex)
        if (!obj) throw new Error(`Page object ${req.objIndex} not found`)

        // ── 1. Capture original properties BEFORE any mutation ──

        // Matrix: 6 floats (a, b, c, d, e, f) = 24 bytes
        const matPtr = malloc(M, 24)
        P.FPDFPageObj_GetMatrix(obj, matPtr)

        // Raw font size (the matrix already encodes effective scaling via m[2]/m[3])
        const szPtr = malloc(M, 4)
        P.FPDFTextObj_GetFontSize(obj, szPtr)
        let rawFontSize = new Float32Array(M.HEAPU8.buffer, szPtr, 1)[0]
        free(M, szPtr)

        // Fill color (RGBA, 0-255 each stored as uint32)
        const cPtr = malloc(M, 16)
        P.FPDFPageObj_GetFillColor(obj, cPtr, cPtr + 4, cPtr + 8, cPtr + 12)
        const colorArr = [...new Uint32Array(M.HEAPU8.buffer, cPtr, 4)]
        free(M, cPtr)
        let [fillR, fillG, fillB, fillA] = colorArr

        // Font handle + name
        const origFont = P.FPDFTextObj_GetFont(obj)
        const fnBuf = malloc(M, 256)
        P.FPDFFont_GetBaseFontName(origFont, fnBuf, 256)
        const fontName = M.UTF8ToString(fnBuf)
        free(M, fnBuf)

        const subset = isSubsetFont(fontName)

        // Apply style overrides if user modified them in the formatting toolbar
        if (req.style?.color) {
          fillR = Math.round(req.style.color[0] * 255)
          fillG = Math.round(req.style.color[1] * 255)
          fillB = Math.round(req.style.color[2] * 255)
          fillA = 255
        }
        if (req.style?.size && req.style.size > 0) {
          rawFontSize = req.style.size
        }

        // ── 2. Push undo snapshot while original is still in doc ──

        const v2Snapshot = saveDocToBytes(P, M, doc)
        undoStack.push(v2Snapshot)
        if (undoStack.length > 20) undoStack.shift()
        redoStack = []

        // ── 3. Remove original text object (physically deletes it from PDF) ──

        P.FPDFPage_RemoveObject(page, obj)
        P.FPDFPageObj_Destroy(obj)
        // obj handle is now INVALID — never use it again

        // ── 4. Create a fresh text object ──

        let newObj = 0
        let textOk = false

        // Check if user requested a specific font family or bold/italic
        const userFamily = req.style?.family
        const userBold = req.style?.bold
        const userItalic = req.style?.italic

        // Is bold or italic explicitly set?
        const isBold = userBold !== undefined ? userBold : /bold|black|heavy|semibold/i.test(fontName)
        const isItalic = userItalic !== undefined ? userItalic : /italic|oblique/i.test(fontName)
        const styleModified = userBold !== undefined || userItalic !== undefined || Boolean(userFamily)

        // Strategy A: Try original font handle (only if user did NOT modify font/style and not subset)
        if (!styleModified && !subset && origFont) {
          try {
            newObj = P.FPDFPageObj_CreateTextObj(doc, origFont, rawFontSize)
            if (newObj) {
              const wlen = (req.newText.length + 1) * 2
              const wp = malloc(M, wlen)
              writeUtf16Le(M, wp, req.newText)
              textOk = !!P.FPDFText_SetText(newObj, wp)
              free(M, wp)
              if (!textOk) {
                P.FPDFPageObj_Destroy(newObj)
                newObj = 0
              }
            }
          } catch {
            if (newObj) { P.FPDFPageObj_Destroy(newObj); newObj = 0 }
            textOk = false
          }
        }

        // Strategy B: Standard font fallback or user-selected font
        if (!newObj || !textOk) {
          let stdName: string
          const fam = userFamily || (
            /mono|courier|consol|typewriter|menlo/i.test(fontName) ? 'mono' :
            /times|georgia|serif|roman|garamond|cambria/i.test(fontName) ? 'serif' : 'sans'
          )

          if (fam === 'serif' || fam === 'ptserif') {
            if (isBold && isItalic) stdName = 'Times-BoldItalic'
            else if (isBold) stdName = 'Times-Bold'
            else if (isItalic) stdName = 'Times-Italic'
            else stdName = 'Times-Roman'
          } else if (fam === 'mono' || fam === 'robotomono') {
            if (isBold && isItalic) stdName = 'Courier-BoldOblique'
            else if (isBold) stdName = 'Courier-Bold'
            else if (isItalic) stdName = 'Courier-Oblique'
            else stdName = 'Courier'
          } else {
            if (isBold && isItalic) stdName = 'Helvetica-BoldOblique'
            else if (isBold) stdName = 'Helvetica-Bold'
            else if (isItalic) stdName = 'Helvetica-Oblique'
            else stdName = 'Helvetica'
          }

          const stdFont = P.FPDFText_LoadStandardFont(doc, stdName)
          if (!stdFont) throw new Error(`FPDFText_LoadStandardFont failed for: ${stdName}`)

          newObj = P.FPDFPageObj_CreateTextObj(doc, stdFont, rawFontSize)
          if (!newObj) throw new Error('FPDFPageObj_CreateTextObj failed with standard font')

          const wlen = (req.newText.length + 1) * 2
          const wp = malloc(M, wlen)
          writeUtf16Le(M, wp, req.newText)
          textOk = !!P.FPDFText_SetText(newObj, wp)
          free(M, wp)

          if (!textOk) throw new Error('FPDFText_SetText failed even on standard font')
        }

        // ── 5. Position new object at the location ──

        if (req.newPos) {
          const matFloats = new Float32Array(M.HEAPU8.buffer, matPtr, 6)
          if (req.initialPos) {
            const dx = req.newPos.x - req.initialPos.x
            const dy = req.newPos.y - req.initialPos.y
            matFloats[4] += dx
            matFloats[5] -= dy
          } else {
            const pageH = P.FPDF_GetPageHeightF ? P.FPDF_GetPageHeightF(page) : P.FPDF_GetPageHeight(page)
            matFloats[4] = req.newPos.x
            matFloats[5] = pageH - (req.newPos.y + rawFontSize * 0.85)
          }
        }

        P.FPDFPageObj_SetMatrix(newObj, matPtr)
        free(M, matPtr)

        // ── 6. Apply fill color ──

        P.FPDFPageObj_SetFillColor(newObj, fillR, fillG, fillB, fillA)

        // ── 7. Insert into page and regenerate content stream ──

        P.FPDFPage_InsertObject(page, newObj)
        P.FPDFPage_GenerateContent(page)

        // ── 8. Rebuild page model and respond ──

        const v2Model = buildPageModel(P, M, page, req.pageIndex)
        pageModels.set(req.pageIndex, v2Model)

        self.postMessage({ type: 'commitRunV2', id: req.id, ok: true, model: v2Model })
        break
      }

      case 'redact': {
        const page = loadPage(req.pageIndex)
        let model = pageModels.get(req.pageIndex)
        if (!model) {
          model = buildPageModel(P, M, page, req.pageIndex)
        }

        const snapshot = saveDocToBytes(P, M, doc)
        undoStack.push(snapshot)
        if (undoStack.length > 20) undoStack.shift()
        redoStack = []

        const success = redactRect(P, M, page, model.height, req.rect)
        const updatedModel = buildPageModel(P, M, page, req.pageIndex)
        pageModels.set(req.pageIndex, updatedModel)

        self.postMessage({
          type: 'redact',
          id: req.id,
          ok: true,
          success,
          model: updatedModel,
        })
        break
      }

      case 'renderPage': {
        const page = loadPage(req.pageIndex)
        const pageW = P.FPDF_GetPageWidthF ? P.FPDF_GetPageWidthF(page) : P.FPDF_GetPageWidth(page)
        const pageH = P.FPDF_GetPageHeightF ? P.FPDF_GetPageHeightF(page) : P.FPDF_GetPageHeight(page)

        const w = Math.round(pageW * req.scale)
        const h = Math.round(pageH * req.scale)

        let hiddenObjs: { obj: any; oldMode: number }[] = []
        if (req.hideLineId) {
          const model = pageModels.get(req.pageIndex)
          const line = model?.lines.find(l => l.id === req.hideLineId)
          if (line) {
            for (const run of line.runs) {
              const obj = P.FPDFPage_GetObject(page, run.index)
              if (obj) {
                // Set render mode 3 = invisible text
                const oldMode = P.FPDFTextObj_GetTextRenderMode(obj)
                P.FPDFTextObj_SetTextRenderMode(obj, 3)
                hiddenObjs.push({ obj, oldMode })
              }
            }
          }
        }

        const bmp = P.FPDFBitmap_Create(w, h, 1)
        // 0xFFFFFFFF = solid white background
        P.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xFFFFFFFF)

        // 0x01 = FPDF_ANNOT (render annotations); no REVERSE_BYTE_ORDER flag —
        // PDFium's default output is BGRA. We swap B↔R below before creating ImageData.
        P.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0x01)

        // Restore hidden objects immediately
        for (const { obj, oldMode } of hiddenObjs) {
          P.FPDFTextObj_SetTextRenderMode(obj, oldMode)
        }

        const bufferPtr = P.FPDFBitmap_GetBuffer(bmp)
        const stride = P.FPDFBitmap_GetStride(bmp)
        const pixelData = new Uint8ClampedArray(w * h * 4)

        for (let row = 0; row < h; row++) {
          const srcOffset = bufferPtr + row * stride
          const rowBytes = M.HEAPU8.subarray(srcOffset, srcOffset + w * 4)
          pixelData.set(rowBytes, row * w * 4)
        }

        // Swap BGRA → RGBA (PDFium outputs Blue at byte 0, Red at byte 2)
        for (let i = 0; i < pixelData.length; i += 4) {
          const b = pixelData[i]
          pixelData[i]     = pixelData[i + 2]  // R ← B
          pixelData[i + 2] = b                  // B ← R
        }

        P.FPDFBitmap_Destroy(bmp)

        const imgData = new ImageData(pixelData, w, h)
        const bitmap = await createImageBitmap(imgData)

        ;(self as unknown as Worker).postMessage(
          { type: 'renderPage', id: req.id, ok: true, bitmap },
          [bitmap]
        )
        break
      }

      case 'undo': {
        if (undoStack.length > 1) {
          const current = undoStack.pop()!
          redoStack.push(current)
          const prev = undoStack[undoStack.length - 1]

          cleanupDoc()
          docBuf = malloc(M, prev.length)
          M.HEAPU8.set(prev, docBuf)
          doc = P.FPDF_LoadMemDocument(docBuf, prev.length, '')
        }
        self.postMessage({ type: 'undo', id: req.id, ok: true })
        break
      }

      case 'redo': {
        if (redoStack.length > 0) {
          const next = redoStack.pop()!
          undoStack.push(next)

          cleanupDoc()
          docBuf = malloc(M, next.length)
          M.HEAPU8.set(next, docBuf)
          doc = P.FPDF_LoadMemDocument(docBuf, next.length, '')
        }
        self.postMessage({ type: 'redo', id: req.id, ok: true })
        break
      }

      case 'save': {
        const bytes = saveDocToBytes(P, M, doc)
        ;(self as unknown as Worker).postMessage({ type: 'save', id: req.id, ok: true, bytes }, [bytes.buffer])
        break
      }

      case 'close': {
        cleanupDoc()
        undoStack = []
        redoStack = []
        self.postMessage({ type: 'close', id: req.id, ok: true })
        break
      }
    }
  } catch (err: any) {
    self.postMessage({ id: req.id, ok: false, error: err.message || String(err) })
  }
}
