@echo off
cd /d "%~dp0"
echo Starting Living Documents conversion server on http://127.0.0.1:5050
uvicorn main:app --host 127.0.0.1 --port 5050 --reload
