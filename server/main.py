from __future__ import annotations  # enables X | Y union hints on Python 3.7-3.9

"""
Living Documents — Phase 4b conversion server.
Runs locally at http://127.0.0.1:5050 alongside the Vite dev server.
Files are processed in a temporary directory and deleted immediately.
Nothing is stored to disk beyond the lifetime of each request.
"""

import asyncio
import os
import base64
import json
import subprocess
import tempfile
import time
from collections import defaultdict
from pathlib import Path
from pydantic import BaseModel

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI(title="Living Documents Converter", version="1.0.0")

# Allowed origins: comma-separated env var for production, localhost defaults for dev.
_allowed_origins = os.environ.get("ALLOWED_ORIGINS")
ALLOWED_ORIGINS = (
    [o.strip() for o in _allowed_origins.split(",") if o.strip()]
    if _allowed_origins
    else ["http://localhost:5173", "http://127.0.0.1:5173"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# LibreOffice is not safely concurrent and uses ~150-300MB RAM per conversion —
# cap upload size so a single request can't exhaust the host.
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "25")) * 1024 * 1024


def _check_size(content: bytes) -> None:
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit.")


# Translation makes one outbound call to Google per page (more for long pages) —
# cap page count so one upload can't fan out into hundreds of outbound requests.
MAX_TRANSLATE_PAGES = int(os.environ.get("MAX_TRANSLATE_PAGES", "50"))


# ── Per-IP rate limiting (no auth on this server, so key on client address) ────
# In-memory; resets per instance restart and isn't shared across replicas —
# fine at current single-instance scale, revisit (Redis) before scaling out.
_rate_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT  = 10  # requests
RATE_WINDOW = 60  # seconds


def _check_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    window_start = now - RATE_WINDOW
    timestamps = [t for t in _rate_store[ip] if t > window_start]
    if len(timestamps) >= RATE_LIMIT:
        raise HTTPException(429, f"Rate limit exceeded — {RATE_LIMIT} req/{RATE_WINDOW}s per IP.")
    timestamps.append(now)
    _rate_store[ip] = timestamps


# LibreOffice/pdf2docx are not safely concurrent (~150-300MB RAM each, can
# deadlock/corrupt output when run in parallel) — serialize heavy conversions
# instead of letting requests pile up unboundedly.
_CONVERSION_SEMAPHORE = asyncio.Semaphore(2)


async def _acquire_conversion_slot() -> None:
    try:
        await asyncio.wait_for(_CONVERSION_SEMAPHORE.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Server busy with other conversions — please retry shortly.")

# ── Capability detection ──────────────────────────────────────────────────────

def _has(pkg: str) -> bool:
    try:
        __import__(pkg)
        return True
    except ImportError:
        return False

def _soffice_path() -> str | None:
    """Find LibreOffice soffice binary on PATH or common install locations."""
    import shutil
    if p := shutil.which("soffice"):
        return p
    candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None

def _tesseract_path() -> str | None:
    """Find Tesseract binary on PATH or common install locations."""
    import shutil
    if p := shutil.which("tesseract"):
        return p
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        str(Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe"),
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/opt/homebrew/bin/tesseract",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None

_TESS_BIN = _tesseract_path()

def _has_tesseract() -> bool:
    if not _TESS_BIN or not _has("pytesseract"):
        return False
    try:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = _TESS_BIN
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False

def _garbled_ratio(text: str) -> float:
    """Fraction of chars that are CID-font decoding artifacts (not real text)."""
    if not text:
        return 1.0
    artifacts = sum(1 for c in text if (
        'ʰ' <= c <= '˿' or   # Spacing Modifier Letters
        'ᴀ' <= c <= 'ᶿ' or   # Phonetic Extensions
        '∀' <= c <= '⋿' or   # Mathematical Operators
        '̀' <= c <= 'ͯ'       # Combining Diacritical Marks
    ))
    return artifacts / len(text)

CAPS = {
    "pdf2docx":    _has("pdf2docx"),
    "docx2pdf":    _has("docx2pdf"),
    "soffice":     bool(_soffice_path()),
    "translation": _has("deep_translator") and _has("langdetect"),
    "tesseract":   False,   # OCR disabled — set to _has_tesseract() to re-enable
}

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "capabilities": {
            "pdf_to_docx":   CAPS["pdf2docx"],
            "docx_to_pdf":   CAPS["docx2pdf"] or CAPS["soffice"],
            "xlsx_to_pdf":   CAPS["soffice"],
            "translation":   CAPS["translation"],
            "ocr_fallback":  CAPS["tesseract"],
        },
    }

# ── PDF → Word ────────────────────────────────────────────────────────────────

@app.post("/convert/pdf2docx")
async def pdf_to_docx(request: Request, file: UploadFile):
    _check_rate_limit(request)
    if not CAPS["pdf2docx"]:
        raise HTTPException(503, "pdf2docx not installed. Run: pip install pdf2docx")

    content = await file.read()
    _check_size(content)
    filename = file.filename or "input.pdf"

    await _acquire_conversion_slot()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path  = os.path.join(tmp, "input.pdf")
            docx_path = os.path.join(tmp, "output.docx")

            with open(pdf_path, "wb") as f:
                f.write(content)

            try:
                from pdf2docx import Converter
                cv = Converter(pdf_path)
                cv.convert(docx_path, start=0, end=None)
                cv.close()
            except Exception as e:
                raise HTTPException(500, f"Conversion failed: {e}")

            with open(docx_path, "rb") as f:
                result = f.read()
    finally:
        _CONVERSION_SEMAPHORE.release()

    stem = Path(filename).stem
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return Response(
        content=result,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{stem}.docx"'},
    )

# ── Office → PDF (Word / Excel) ───────────────────────────────────────────────

@app.post("/convert/office2pdf")
async def office_to_pdf(request: Request, file: UploadFile):
    _check_rate_limit(request)
    content  = await file.read()
    _check_size(content)
    filename = file.filename or "input.docx"
    ext      = Path(filename).suffix.lower()

    if ext not in {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"}:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    can_docx2pdf = CAPS["docx2pdf"] and ext in {".docx", ".doc"}
    can_soffice  = bool(_soffice_path())

    if not can_docx2pdf and not can_soffice:
        raise HTTPException(
            503,
            "No Office→PDF engine available. "
            "Install docx2pdf (pip install docx2pdf) or LibreOffice."
        )

    await _acquire_conversion_slot()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            in_path  = os.path.join(tmp, f"input{ext}")
            out_path = os.path.join(tmp, "output.pdf")

            with open(in_path, "wb") as f:
                f.write(content)

            converted = False

            # Try docx2pdf first (uses Word COM on Windows — best fidelity for .docx)
            if can_docx2pdf:
                try:
                    from docx2pdf import convert
                    convert(in_path, out_path)
                    converted = Path(out_path).exists()
                except Exception:
                    converted = False

            # Fall back to LibreOffice headless
            if not converted:
                soffice = _soffice_path()
                if not soffice:
                    raise HTTPException(503, "LibreOffice not found. Install LibreOffice.")
                proc = subprocess.run(
                    [soffice, "--headless", "--convert-to", "pdf", in_path, "--outdir", tmp],
                    capture_output=True,
                    timeout=120,
                )
                if proc.returncode != 0:
                    raise HTTPException(500, f"LibreOffice failed: {proc.stderr.decode()}")
                # soffice names the output after the input stem
                stem_out = Path(in_path).stem + ".pdf"
                generated = os.path.join(tmp, stem_out)
                if not Path(generated).exists():
                    raise HTTPException(500, "LibreOffice produced no output file.")
                out_path = generated
                converted = True

            if not converted:
                raise HTTPException(500, "Conversion failed — no engine succeeded.")

            with open(out_path, "rb") as f:
                result = f.read()
    finally:
        _CONVERSION_SEMAPHORE.release()

    stem = Path(filename).stem
    return Response(
        content=result,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
    )

# ── IntelliFont — visual font identification ──────────────────────────────────
# Disabled: moved client-side. The native Node addon this called was Windows-only
# (napi-rs .node binary) and would always 503 on a Linux production host. Font
# identification now runs entirely in the browser via the engine's own wasm build
# (app/src/lib/wasm/intellifont/, fed by app/public/intellifont/glyph_signatures.bin),
# matching the project's "everything client-side" architecture. See app/src/lib/intellifont.ts.
#
# INTELLIFONT_PATH = r"d:\IntellifontNPM\Rust\font-resolver\bindings\node\index.js"
#
# # Inline Node.js script — reads JSON from stdin, returns top match on stdout.
# _INTELLIFONT_JS = r"""
# const path = require('path');
# const ifPath = process.argv[2];
# const chunks = [];
# process.stdin.on('data', d => chunks.push(d));
# process.stdin.on('end', () => {
#   try {
#     const { fontBytes, chars } = JSON.parse(Buffer.concat(chunks).toString());
#     const { identifyVisualFontBuffer } = require(ifPath);
#     const buf = Buffer.from(fontBytes, 'base64');
#     const matches = identifyVisualFontBuffer(buf, chars || 'RQWM', 1);
#     process.stdout.write(JSON.stringify(matches || []));
#   } catch (e) {
#     process.stdout.write(JSON.stringify([]));
#   }
# });
# """
#
# class IntelliFontRequest(BaseModel):
#     fontBytes: str   # base64-encoded font file bytes
#     chars: str = "RQWM"
#
# @app.post("/intellifont/identify")
# async def intellifont_identify(body: IntelliFontRequest):
#     if not Path(INTELLIFONT_PATH).exists():
#         raise HTTPException(503, "IntelliFont engine not found at expected path.")
#     payload = json.dumps({"fontBytes": body.fontBytes, "chars": body.chars})
#     try:
#         result = subprocess.run(
#             ["node", "-e", _INTELLIFONT_JS, "--", INTELLIFONT_PATH],
#             input=payload.encode(),
#             capture_output=True,
#             timeout=10,
#         )
#         matches = json.loads(result.stdout or "[]")
#         if matches:
#             top = matches[0]
#             return {"family": top.get("family", ""), "confidence": top.get("confidence", 0)}
#         return {"family": "", "confidence": 0}
#     except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
#         return {"family": "", "confidence": 0}

# ── Translation (deep-translator — free, no API key, no model download) ──────

# langdetect code → 2-letter display code for the frontend
_LANG_MAP: dict = {
    "zh-cn": "zh", "zh-tw": "zt", "zh": "zh",
    "en": "en", "ja": "ja", "ko": "ko",
    "ar": "ar", "hi": "hi", "bn": "bn", "ur": "ur",
    "ru": "ru", "fr": "fr", "de": "de", "es": "es",
    "pt": "pt", "it": "it", "nl": "nl", "pl": "pl",
    "tr": "tr", "vi": "vi", "th": "th", "id": "id",
    "fa": "fa", "uk": "uk", "he": "he", "sv": "sv",
}

# Our frontend uses simple codes; Google needs full locale codes for Chinese
_GOOGLE_LANG: dict = {
    "zh": "zh-CN", "zt": "zh-TW",
}

def _google_code(code: str) -> str:
    return _GOOGLE_LANG.get(code, code)

class TranslateRequest(BaseModel):
    text: str
    to_lang: str = "en"

@app.post("/translate")
async def translate_text(request: Request, body: TranslateRequest):
    _check_rate_limit(request)
    if not CAPS["translation"]:
        raise HTTPException(
            503,
            "Translation libraries not installed. "
            "Run in the server venv: pip install deep-translator langdetect"
        )

    text = body.text.strip()
    if not text:
        return {"translated": "", "detected_lang": "unknown"}

    from langdetect import detect, LangDetectException
    try:
        detected  = detect(text)
        disp_lang = _LANG_MAP.get(detected, detected[:2])
    except LangDetectException:
        disp_lang = "unknown"

    if disp_lang == body.to_lang:
        return {"translated": text, "detected_lang": disp_lang}

    try:
        from deep_translator import GoogleTranslator
        translated = GoogleTranslator(
            source="auto",
            target=_google_code(body.to_lang),
        ).translate(text)
        return {"translated": translated or text, "detected_lang": disp_lang}
    except Exception as e:
        return {"translated": text, "detected_lang": disp_lang, "error": str(e)}


@app.post("/translate/unload")
def translate_unload():
    # deep-translator uses online APIs — no models to unload from memory
    return {"status": "ok", "note": "deep-translator uses no local models; nothing to unload."}

# ── Translate page — returns blocks with bboxes for in-page overlay ──────────

@app.post("/translate/page")
async def translate_page_blocks(
    request: Request,
    file: UploadFile,
    page_index: int  = Form(0),
    target_lang: str = Form("en"),
):
    _check_rate_limit(request)
    if not CAPS["translation"]:
        raise HTTPException(
            503,
            "Translation libraries not installed. "
            "Run in server venv: pip install deep-translator langdetect",
        )

    import fitz
    from deep_translator import GoogleTranslator

    content = await file.read()
    _check_size(content)

    try:
        doc = fitz.open(stream=content, filetype="pdf")
    except Exception as e:
        raise HTTPException(400, f"Could not open PDF: {e}")

    if page_index < 0 or page_index >= len(doc):
        doc.close()
        raise HTTPException(400, f"Page {page_index} out of range ({len(doc)} pages).")

    page        = doc[page_index]
    page_width  = page.rect.width
    page_height = page.rect.height

    # ── 1. Try PyMuPDF text extraction (handles most embedded-font PDFs) ─────
    raw_blocks = page.get_text("dict")["blocks"]
    lines_info = []
    for block in raw_blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text = " ".join(
                s["text"] for s in line.get("spans", []) if s.get("text", "").strip()
            ).strip()
            if text:
                lines_info.append({"text": text, "bbox": list(line["bbox"])})

    # ── 2. Decide if OCR is needed ────────────────────────────────────────────
    # Scanned PDF → no text at all.  CID-font issue → high garbled ratio.
    garbled_count = sum(1 for l in lines_info if _garbled_ratio(l["text"]) > 0.15)
    needs_ocr = (len(lines_info) == 0) or (
        garbled_count / max(len(lines_info), 1) > 0.20
    )

    # Grab a pixmap for OCR while the doc is still open (close happens below)
    ocr_pix = None
    OCR_DPI = 150
    if needs_ocr and CAPS["tesseract"]:
        ocr_pix = page.get_pixmap(
            matrix=fitz.Matrix(OCR_DPI / 72, OCR_DPI / 72),
            colorspace=fitz.csRGB,
        )

    doc.close()

    # ── 3. OCR fallback ───────────────────────────────────────────────────────
    if needs_ocr:
        if ocr_pix:
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = _TESS_BIN

            with tempfile.TemporaryDirectory() as tmp:
                img_path = os.path.join(tmp, "page.png")
                ocr_pix.save(img_path)

                try:
                    avail = set(pytesseract.get_languages(config=""))
                except Exception:
                    avail = {"eng"}

                # Prefer Traditional → Simplified → English; use whatever is installed
                ocr_lang = "+".join(
                    l for l in ["chi_tra", "chi_sim", "eng"] if l in avail
                ) or "eng"

                tsv = pytesseract.image_to_data(
                    img_path,
                    lang=ocr_lang,
                    output_type=pytesseract.Output.DICT,
                    config="--psm 3",
                )

            # Group words into lines by (block_num, par_num, line_num)
            scale = OCR_DPI / 72
            groups: dict = {}
            for i, word in enumerate(tsv["text"]):
                if not word.strip() or int(tsv["conf"][i]) < 20:
                    continue
                key = (tsv["block_num"][i], tsv["par_num"][i], tsv["line_num"][i])
                if key not in groups:
                    groups[key] = {"words": [], "l": [], "t": [], "r": [], "b": []}
                x, y, w, h = (tsv["left"][i], tsv["top"][i],
                               tsv["width"][i], tsv["height"][i])
                groups[key]["words"].append(word)
                groups[key]["l"].append(x);      groups[key]["t"].append(y)
                groups[key]["r"].append(x + w);  groups[key]["b"].append(y + h)

            lines_info = [
                {
                    "text": " ".join(g["words"]),
                    "bbox": [min(g["l"]) / scale, min(g["t"]) / scale,
                             max(g["r"]) / scale, max(g["b"]) / scale],
                }
                for g in (groups[k] for k in sorted(groups))
            ]

        else:
            # Tesseract not available — strip garbled lines, keep the good ones
            lines_info = [l for l in lines_info if _garbled_ratio(l["text"]) <= 0.15]
            if not lines_info:
                raise HTTPException(
                    503,
                    "This PDF page contains no extractable text (scanned image or "
                    "custom font encoding). Install Tesseract OCR for automatic "
                    "recognition: https://github.com/UB-Mannheim/tesseract/wiki — "
                    "then add Chinese language packs (chi_tra.traineddata / chi_sim.traineddata).",
                )

    if not lines_info:
        return {
            "blocks":        [],
            "page_width":    page_width,
            "page_height":   page_height,
            "detected_lang": "unknown",
        }

    # ── 4. Detect language ────────────────────────────────────────────────────
    from langdetect import detect, LangDetectException
    combined = " ".join(item["text"] for item in lines_info)[:5000]
    try:
        detected  = detect(combined)
        disp_lang = _LANG_MAP.get(detected, detected[:2])
    except LangDetectException:
        disp_lang = "unknown"

    # ── 5. Translate all lines (batch → fewer API calls) ─────────────────────
    google_target = _google_code(target_lang)
    texts = [item["text"] for item in lines_info]

    try:
        translator     = GoogleTranslator(source="auto", target=google_target)
        translated_raw = translator.translate_batch(texts)
        if not isinstance(translated_raw, list) or len(translated_raw) != len(texts):
            raise ValueError("batch length mismatch")
        translated_texts = [t or texts[i] for i, t in enumerate(translated_raw)]
    except Exception:
        translated_texts = []
        for text in texts:
            try:
                t = GoogleTranslator(source="auto", target=google_target).translate(text)
                translated_texts.append(t or text)
            except Exception:
                translated_texts.append(text)

    return {
        "blocks": [
            {"text": item["text"], "translated": translated_texts[i], "bbox": item["bbox"]}
            for i, item in enumerate(lines_info)
        ],
        "page_width":    page_width,
        "page_height":   page_height,
        "detected_lang": disp_lang,
    }

# ── Translate PDF — full document translation, returns PDF ───────────────────

@app.post("/convert/translate-pdf")
async def convert_translate_pdf(
    request: Request,
    file: UploadFile,
    source_lang: str = Form("auto"),
    target_lang: str = Form("en"),
):
    _check_rate_limit(request)
    if not CAPS["translation"]:
        raise HTTPException(
            503,
            "Translation libraries not installed. "
            "Run in server venv: pip install deep-translator langdetect",
        )

    import fitz  # PyMuPDF — already in requirements

    content  = await file.read()
    _check_size(content)
    filename = file.filename or "input.pdf"

    # ── 1. Extract text page by page ──────────────────────────────────────────
    src_doc = fitz.open(stream=content, filetype="pdf")
    if len(src_doc) > MAX_TRANSLATE_PAGES:
        src_doc.close()
        raise HTTPException(413, f"PDF exceeds {MAX_TRANSLATE_PAGES}-page translation limit.")
    pages_text = [page.get_text("text").strip() for page in src_doc]
    src_doc.close()

    # ── 2. Detect / resolve source language ──────────────────────────────────
    disp_from = source_lang
    if source_lang == "auto":
        from langdetect import detect, LangDetectException
        combined = " ".join(t for t in pages_text if t)[:5000]
        try:
            detected  = detect(combined)
            disp_from = _LANG_MAP.get(detected, detected[:2])
        except LangDetectException:
            raise HTTPException(
                400, "Could not detect source language — please select it manually."
            )

    if disp_from == target_lang:
        raise HTTPException(
            400,
            f"Document appears to already be in the target language ({target_lang}).",
        )

    google_target = _google_code(target_lang)

    # ── 3. Translate each page (chunks ≤ 4900 chars for Google's limit) ───────
    from deep_translator import GoogleTranslator

    def translate_page(text: str) -> str:
        if not text:
            return ""
        translator = GoogleTranslator(source="auto", target=google_target)
        if len(text) <= 4900:
            return translator.translate(text) or text
        # Split long pages into paragraphs, translate each, rejoin
        parts = [p for p in text.split("\n\n") if p.strip()]
        result = []
        chunk = ""
        for part in parts:
            if len(chunk) + len(part) + 2 > 4900:
                if chunk:
                    result.append(translator.translate(chunk) or chunk)
                chunk = part
            else:
                chunk = (chunk + "\n\n" + part).strip()
        if chunk:
            result.append(translator.translate(chunk) or chunk)
        return "\n\n".join(result)

    translated_pages = []
    for page_text in pages_text:
        try:
            translated_pages.append(translate_page(page_text))
        except Exception:
            translated_pages.append(page_text)  # keep original on error

    # ── 4. Build output PDF (clean text layout, one page per original) ────────
    out_doc   = fitz.open()
    text_rect = fitz.Rect(50, 50, 545, 792)   # ~A4 with margins
    for trans_text in translated_pages:
        page = out_doc.new_page(width=595, height=842)  # A4
        if trans_text:
            page.insert_textbox(
                text_rect, trans_text,
                fontsize=11, fontname="helv", color=(0, 0, 0),
            )

    output = out_doc.tobytes()
    stem   = Path(filename).stem
    return Response(
        content=output,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}-translated.pdf"'},
    )
