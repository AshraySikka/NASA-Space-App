# EMBER (Team Apex, NASA Space Apps 2026)
PY ?= python3
API_PORT ?= 8000

.PHONY: help install ingest backend frontend dev test test-backend test-frontend build smoke clean

help:
	@echo "make install    install Python and Node dependencies"
	@echo "make ingest     raw_data/ -> data/processed/*.json, docs/DATA_AUDIT.md (needs raw_data/)"
	@echo "make dev        start the API (:$(API_PORT)) and the frontend (:5173) together"
	@echo "make backend    start only the API"
	@echo "make frontend   start only the frontend"
	@echo "make test       typecheck + backend tests + frontend tests + production build"
	@echo "make smoke      Playwright smoke test against a running build (see README)"

install:
	$(PY) -m pip install -r backend/requirements-dev.txt
	cd dashboard && npm install

ingest:
	$(PY) scripts/ingest/ingest.py --raw raw_data --out data/processed --docs docs --cache .ingest_cache
	$(PY) scripts/make_rating_fixtures.py
	$(PY) scripts/make_docs.py

backend:
	cd backend && $(PY) -m uvicorn app.main:app --reload --port $(API_PORT)

frontend:
	cd dashboard && npm run dev

# one command for both; Ctrl+C stops both
dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd backend && $(PY) -m uvicorn app.main:app --reload --port $(API_PORT)) & \
	(cd dashboard && npm run dev) & \
	wait

test-backend:
	cd backend && $(PY) -m pytest -q

test-frontend:
	cd dashboard && npm run typecheck && npm test

build:
	cd dashboard && npm run build

test: test-backend test-frontend build

# needs: `make backend` with FRONTEND_ORIGIN=http://localhost:4173, and `cd dashboard && npm run build && npm run preview`
smoke:
	cd dashboard && npm run smoke

clean:
	rm -rf dashboard/dist dashboard/public/data .ingest_cache
