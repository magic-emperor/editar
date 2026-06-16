# Living Documents conversion server — Cloud Run target.
# docx2pdf (Word COM) is Windows-only and unused here; LibreOffice handles docx/xlsx -> PDF.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Linux image: docx2pdf (Word COM) and pytesseract (tesseract binary, force-disabled
# in main.py) are intentionally omitted — LibreOffice covers the docx/xlsx->pdf path.
RUN pip install --no-cache-dir \
    fastapi==0.128.8 uvicorn[standard]==0.39.0 python-multipart==0.0.20 \
    pdf2docx==0.5.8 PyMuPDF==1.23.26 deep-translator==1.11.4 langdetect==1.0.9 pillow==11.3.0

COPY main.py .

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
