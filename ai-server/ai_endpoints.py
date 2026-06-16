import os
import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from openai import OpenAI
from auth import verify_license_key, check_rate_limit

router = APIRouter(prefix="/ai")

# Model can be overridden per-provider in .env:
#   Groq:    AI_MODEL=llama-3.3-70b-versatile
#   OpenAI:  AI_MODEL=gpt-4o-mini
#   Anthropic (via OpenRouter): AI_MODEL=anthropic/claude-sonnet-4-6
DEFAULT_MODEL = "claude-sonnet-4-6"


def get_client() -> tuple[OpenAI, str]:
    api_key  = os.getenv("AI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    base_url = os.getenv("AI_BASE_URL")   # e.g. https://api.groq.com/openai/v1
    model    = os.getenv("AI_MODEL", DEFAULT_MODEL)
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured — set AI_API_KEY in .env")
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs), model


def chat(messages: list[dict], max_tokens: int) -> str:
    client, model = get_client()
    resp = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=messages,
    )
    return resp.choices[0].message.content.strip()


# ── /ai/health ────────────────────────────────────────────────────────────────

@router.get("/health")
def health():
    model = os.getenv("AI_MODEL", DEFAULT_MODEL)
    base  = os.getenv("AI_BASE_URL", "default")
    return {"status": "ok", "model": model, "provider": base}


# ── /ai/ocr/correct ──────────────────────────────────────────────────────────

class OCRCorrectRequest(BaseModel):
    word:           str
    context_before: str
    context_after:  str
    confidence:     float


@router.post("/ocr/correct")
def ocr_correct(body: OCRCorrectRequest, request: Request):
    key = verify_license_key(request)
    check_rate_limit(key)

    prompt = (
        f'You are correcting a single OCR-misread word from a scanned document.\n'
        f'Context before: "{body.context_before}". Context after: "{body.context_after}".\n'
        f'OCR read "{body.word}" with {body.confidence:.0f}% confidence.\n'
        f'Reply with ONLY the corrected word, nothing else.'
    )
    correction = chat([{"role": "user", "content": prompt}], max_tokens=64)
    return {"correction": correction}


# ── /ai/table/cleanup ─────────────────────────────────────────────────────────

class TableCleanupRequest(BaseModel):
    rows:         list[list[str]]
    page_context: str


@router.post("/table/cleanup")
def table_cleanup(body: TableCleanupRequest, request: Request):
    key = verify_license_key(request)
    check_rate_limit(key)

    rows_str = "\n".join("\t".join(row) for row in body.rows)
    prompt = (
        f'You are reviewing a table extracted via OCR from a scanned document.\n'
        f'Page context: {body.page_context}\n'
        f'Table (tab-separated, row per line):\n{rows_str}\n'
        f'Find cells with likely OCR errors. Return JSON only: {{"row:col": "corrected"}}.\n'
        f'If no corrections needed, return {{}}.'
    )
    text = chat([{"role": "user", "content": prompt}], max_tokens=1024)

    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        corrections = json.loads(text)
    except json.JSONDecodeError:
        corrections = {}

    return {"corrections": corrections}


# ── /ai/extract ───────────────────────────────────────────────────────────────

class ExtractRequest(BaseModel):
    text:       str
    page_count: int


@router.post("/extract")
def extract(body: ExtractRequest, request: Request):
    key = verify_license_key(request)
    check_rate_limit(key)

    text = body.text[:24000] if len(body.text) > 24000 else body.text

    prompt = (
        f'Extract structured data from this document ({body.page_count} pages):\n'
        f'{text}\n'
        f'Return only valid JSON:\n'
        f'{{"dates":[],"amounts":[],"names":[],"reference_numbers":[],"key_totals":[]}}'
    )
    text_out = chat([{"role": "user", "content": prompt}], max_tokens=2048)

    if "```" in text_out:
        text_out = text_out.split("```")[1]
        if text_out.startswith("json"):
            text_out = text_out[4:]
        text_out = text_out.strip()

    try:
        result = json.loads(text_out)
    except json.JSONDecodeError:
        result = {"dates": [], "amounts": [], "names": [], "reference_numbers": [], "key_totals": []}

    return result
