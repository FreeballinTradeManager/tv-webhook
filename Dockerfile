# Multi-stage build: Node builds the React frontend, Python runs the FastAPI
# backend and serves the built frontend as static files.

# --- Stage 1: build the React frontend --------------------------------------
FROM node:20-slim AS frontend-builder

WORKDIR /build

# Install deps first (cache-friendly layer)
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy source + build
COPY frontend ./frontend
# vite.config.js has build.outDir = '../app/static' — the build writes into
# /build/app/static because we're building from /build/frontend.
RUN cd frontend && npm run build

# --- Stage 2: Python backend ------------------------------------------------
FROM python:3.12-slim

WORKDIR /app

# System deps for psycopg2 + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source
COPY app ./app

# Copy the built React bundle into app/static so FastAPI's SPA fallback
# route picks it up (see main.py — `_STATIC_DIR = Path(__file__).parent / "static"`)
COPY --from=frontend-builder /build/app/static ./app/static

# Railway injects $PORT
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
