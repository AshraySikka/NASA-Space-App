"""FastAPI app: status, processed data, chat over SSE, rating, and local source PDFs."""
import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sse_starlette.sse import EventSourceResponse

from . import answer, config
from .rating import rate
from .store import DataMissing, get_store

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Flame in Freefall evidence API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.state.limiter = limiter
app.add_middleware(CORSMiddleware, allow_origins=config.FRONTEND_ORIGINS(), allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.exception_handler(RateLimitExceeded)
async def _rate_limited(request: Request, exc: RateLimitExceeded):
    return JSONResponse({"error": "rate_limited", "detail": "Too many questions in a short time. Wait a moment and try again."}, status_code=429)


@app.exception_handler(DataMissing)
async def _data_missing(request: Request, exc: DataMissing):
    return JSONResponse({"error": "data_missing", "detail": str(exc)}, status_code=503)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[dict] = []
    simulator: Optional[dict] = None
    last_conditions: Optional[dict] = None
    live: bool = False


class RateRequest(BaseModel):
    material: str
    o2_pct: Optional[float] = None
    flow_cm_s: Optional[float] = None
    pressure_kpa: Optional[float] = None
    gravity: str = "0g"


@app.get("/api/status")
def status():
    try:
        s = get_store()
        data = {"ok": True, "tests": len(s.tests), "chunks": len(s.chunks), "sources": len(s.sources), "cards": len(s.cards)}
    except DataMissing as e:
        data = {"ok": False, "detail": str(e)}
    return {"data": data, "engines": {"local": data["ok"], "gemini": config.gemini_ready(), "claude": config.claude_ready()},
            "allowed_domains": config.allowed_domains(), "raw_pdfs_available": config.RAW_DIR.is_dir()}


@app.post("/api/rate")
def api_rate(body: RateRequest):
    s = get_store()
    return rate(body.model_dump(), s.tests, s.rating_config)


@app.post("/api/chat")
@limiter.limit(config.CHAT_RATE_LIMIT)
async def chat(request: Request, body: ChatRequest):
    get_store()  # raises DataMissing -> 503 before the stream starts
    queue: asyncio.Queue = asyncio.Queue()

    async def emit(event: str, data: dict):
        await queue.put({"event": event, "data": json.dumps(data)})

    async def work():
        try:
            result = await answer.run(body.model_dump(), emit)
            # stream the summary in small pieces so the first words appear quickly
            words = result["summary"].split(" ")
            for i in range(0, len(words), 4):
                await emit("token", {"text": " ".join(words[i : i + 4]) + (" " if i + 4 < len(words) else "")})
                await asyncio.sleep(0.012)
            await emit("final", result)
        except Exception as e:  # never leak a stack trace to the client
            await emit("error", {"detail": f"The assistant hit an internal error ({type(e).__name__}). Nothing was answered."})
        await queue.put(None)

    async def stream():
        task = asyncio.create_task(work())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            task.cancel()

    return EventSourceResponse(stream())


@app.get("/sources/{source_id}")
def source_pdf(source_id: str):
    """Serve a local source PDF by registry id (never by path). Used for page-anchored links."""
    s = get_store().source_by_id.get(source_id)
    fn = (s or {}).get("local_filename")
    if not fn or not fn.lower().endswith(".pdf"):
        raise HTTPException(404, "No local PDF for this source.")
    path = (config.RAW_DIR / Path(fn).name).resolve()
    if config.RAW_DIR.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "The PDF is not on this server. Use the NASA link instead.")
    return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{source_id}.pdf"', "X-Content-Type-Options": "nosniff"})
