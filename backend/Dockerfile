# API image. Build from the repo root:  docker build -f backend/Dockerfile -t fif-api .
FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY data/processed data/processed
ENV DATA_DIR=/srv/data/processed PYTHONUNBUFFERED=1
WORKDIR /srv/backend
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
