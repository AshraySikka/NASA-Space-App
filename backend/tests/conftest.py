import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts" / "ingest"))


import pytest


@pytest.fixture(autouse=True)
def _no_real_keys(monkeypatch):
    """Tests never use the developer's real .env keys and never reach a live model or website."""
    for k in ("GEMINI_API_KEY", "GEMINI_MODEL", "ANTHROPIC_API_KEY", "CLAUDE_MODEL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr("app.config.LLM_ALWAYS", False)