import os
import time
from collections import defaultdict
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse

# In-memory rate-limit store: { key: [timestamp, ...] }
_rate_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT = 10   # requests
RATE_WINDOW = 60  # seconds


def get_valid_keys() -> set[str]:
    raw = os.getenv("VALID_LICENSE_KEYS", "")
    return {k.strip() for k in raw.split(",") if k.strip()}


def verify_license_key(request: Request) -> str:
    key = request.headers.get("X-License-Key", "")
    valid = get_valid_keys()
    if not key or key not in valid:
        raise HTTPException(status_code=401, detail="Invalid license key")
    return key


def check_rate_limit(key: str) -> None:
    now = time.time()
    window_start = now - RATE_WINDOW
    timestamps = _rate_store[key]
    # Prune old entries
    _rate_store[key] = [t for t in timestamps if t > window_start]
    if len(_rate_store[key]) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit exceeded — 10 req/min per license key")
    _rate_store[key].append(now)
