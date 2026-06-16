# Editar

Editar is a privacy-first, browser-based PDF toolkit. It provides PDF viewing, editing, conversion, and OCR in the style of tools like iLovePDF, with one core difference: files are processed on the user's own device, not uploaded to a server. That guarantee is the product's main differentiator and is preserved as a hard constraint in every design decision.

## Why it is different

Most online PDF tools work by uploading a file to a server, processing it there, and sending back a result. That means a user's documents, which may contain financial records, contracts, medical information, or other sensitive data, pass through a third party's infrastructure. Editar avoids this entirely for the large majority of its features: PDF rendering, annotation, text editing, search, table detection, OCR, and most format conversions all run locally in the browser using WebAssembly and the user's own CPU. Nothing is sent anywhere unless a feature explicitly requires a server-side capability the browser cannot provide, and those cases are clearly isolated.

## Architecture

The repository is split into a client application and two optional backend services.

### Client (`app/`)

A React and TypeScript single-page application built with Vite. This is where almost all functionality lives.

Runs entirely in the browser, with no server round-trip:
- PDF viewing and rendering (PDFium via WebAssembly)
- Annotations and find-in-page
- Table detection
- In-place text editing, including font-faithful redraw using embedded document fonts
- Password-protected PDF unlock
- PDF to Images, PDF to Text (with OCR fallback via an in-browser Tesseract WebAssembly build)
- Images to PDF and image format conversion
- PDF to Word (default mode, OCR-aware for scanned documents)
- Visual font identification (IntelliFont engine, compiled to WebAssembly), used to recognize a document's embedded font family during editing so replacement text can match it

### Conversion server (`server/`)

A FastAPI service, used only for conversions the browser genuinely cannot perform:
- Word and Excel to PDF, via LibreOffice
- PDF to Word, server-assisted mode (opt-in only; in-browser is the default)
- Health and capability reporting

This service holds no state. Uploaded files are processed inside a temporary directory and deleted immediately after the request completes. It applies per-IP rate limiting, upload size limits, and a concurrency cap, since LibreOffice conversions are memory-heavy and not safely run in parallel.

### AI server (`ai-server/`)

A separate, license-gated FastAPI service for optional AI-assisted features (OCR correction, table cleanup, smart extraction). Disabled by default and not required for the core product.

## Repository layout

```
app/        React + TypeScript + Vite client application
server/     FastAPI conversion server (LibreOffice, pdf2docx)
ai-server/  FastAPI AI service (license-gated, optional)
```

## Running locally

### Client

```
cd app
npm install
npm run dev
```

The dev server runs on port 5173.

### Conversion server (optional, only needed for Office-format conversions)

```
cd server
start.bat   # Windows
./start.sh  # macOS / Linux
```

The server runs on port 5050. The client falls back gracefully if it is not running; only Office-to-PDF and the opt-in server-side PDF-to-Word mode require it.

### Configuration

Copy `.env.example` to `.env` in `app/` and `ai-server/` and adjust values as needed. The client reads the conversion server's URL from `VITE_API_URL`, defaulting to `http://localhost:5050` if unset.

## Building for production

```
cd app
npm run build
```

This produces a static build in `app/dist`, deployable to any static host. The conversion server is containerized separately (`server/Dockerfile`) for deployment to a container platform.

## Status

This project is under active development. Some features (translation, an additional OCR backend) are implemented but intentionally disabled pending further reliability work or a decision on hosting cost; the code is retained rather than removed.
