"""Runtime configuration. Everything comes from the environment; nothing secret is hardcoded."""
from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except Exception:  # python-dotenv is optional at runtime
    pass

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT / "data" / "processed"))
RAW_DIR = Path(os.getenv("RAW_DATA_DIR", ROOT / "raw_data"))

DEFAULT_ALLOWED = "psi.nasa.gov,ntrs.nasa.gov,www.nasa.gov,sma.nasa.gov,spinoff.nasa.gov,humans-in-space.jaxa.jp,discovery.ucl.ac.uk,par.nsf.gov,doi.org"


def allowed_domains() -> list[str]:
    return [d.strip().lower() for d in os.getenv("ALLOWED_DOMAINS", DEFAULT_ALLOWED).split(",") if d.strip()]


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


GEMINI_KEY = lambda: env("GEMINI_API_KEY")  # noqa: E731
ANTHROPIC_KEY = lambda: env("ANTHROPIC_API_KEY")  # noqa: E731
GEMINI_MODEL = lambda: env("GEMINI_MODEL")  # noqa: E731  (no default on purpose: take the current name from Google's docs)
CLAUDE_MODEL = lambda: env("CLAUDE_MODEL")  # noqa: E731  (no default on purpose: take the current name from Anthropic's docs)
CLAUDE_WEB_SEARCH_TOOL = lambda: env("CLAUDE_WEB_SEARCH_TOOL", "web_search_20250305")  # noqa: E731
FRONTEND_ORIGINS = lambda: [o.strip() for o in env("FRONTEND_ORIGIN", "http://localhost:5173").split(",") if o.strip()]  # noqa: E731
LLM_TIMEOUT_S = float(env("LLM_TIMEOUT_S", "25"))
# Local-first: models are used only when local data cannot answer (or "Search NASA live" is ticked).
# Set LLM_ALWAYS=1 to also let a model rewrite answers that local data already covers (slower).
LLM_ALWAYS = env("LLM_ALWAYS", "0").strip() == "1"
FETCH_TIMEOUT_S = float(env("FETCH_TIMEOUT_S", "10"))
FETCH_MAX_BYTES = int(env("FETCH_MAX_BYTES", str(3_000_000)))
CHAT_RATE_LIMIT = env("CHAT_RATE_LIMIT", "20/minute")

# Domains whose pages count as Tier 2 (NASA / primary) when the verifier confirms the quote.
TIER2_SUFFIX = "nasa.gov"


def gemini_ready() -> bool:
    return bool(GEMINI_KEY() and GEMINI_MODEL())


def claude_ready() -> bool:
    return bool(ANTHROPIC_KEY() and CLAUDE_MODEL())
