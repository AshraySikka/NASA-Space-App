"""Outbound HTTP for the verifier and the live-search layers. Allowlist only, size-limited."""
from __future__ import annotations

import html
import re
from urllib.parse import urljoin, urlparse

import httpx

from . import config
from .verifier import host_allowed

_CACHE: dict[str, str | None] = {}
GOOGLE_REDIRECT_HOST = "vertexaisearch.cloud.google.com"


def html_to_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript|svg|template)\b.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<!--.*?-->", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d|tr|section|article)>", "\n", raw)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw))
    text = "".join(ch for ch in text if ch == "\n" or ord(ch) >= 32)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip()


def fetch_text(url: str) -> str | None:
    """GET an allowlisted https URL and return its text. Returns None on any failure.
    Every redirect hop is re-checked against the allowlist."""
    if url in _CACHE:
        return _CACHE[url]
    allowed = config.allowed_domains()
    text = None
    try:
        cur = url
        with httpx.Client(timeout=config.FETCH_TIMEOUT_S, follow_redirects=False, headers={"User-Agent": "TeamApex-EvidenceVerifier/1.0 (NASA Space Apps 2026)"}) as client:
            for _ in range(4):
                if not host_allowed(cur, allowed):
                    break
                with client.stream("GET", cur) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                        cur = urljoin(cur, r.headers["location"])
                        continue
                    if r.status_code != 200:
                        break
                    buf = b""
                    for part in r.iter_bytes():
                        buf += part
                        if len(buf) > config.FETCH_MAX_BYTES:
                            buf = buf[: config.FETCH_MAX_BYTES]
                            break
                    ctype = r.headers.get("content-type", "").lower()
                    if "pdf" in ctype or buf[:5] == b"%PDF-":
                        import fitz

                        with fitz.open(stream=buf, filetype="pdf") as d:
                            text = "\n".join(p.get_text() for p in d)
                    else:
                        text = html_to_text(buf.decode(r.encoding or "utf-8", "replace"))
                    break
    except Exception:
        text = None
    _CACHE[url] = text
    return text


def resolve_grounding_url(url: str) -> str | None:
    """Gemini grounding returns Google redirect links. Read only the Location header of that
    one known host (no body is downloaded), then apply the allowlist to the real target."""
    host = (urlparse(url).hostname or "").lower()
    if host_allowed(url, config.allowed_domains()):
        return url
    if host != GOOGLE_REDIRECT_HOST:
        return None
    try:
        with httpx.Client(timeout=config.FETCH_TIMEOUT_S, follow_redirects=False) as client:
            r = client.head(url)
            loc = r.headers.get("location")
    except Exception:
        return None
    return loc if loc and host_allowed(loc, config.allowed_domains()) else None


def tier_for(url: str) -> int:
    host = (urlparse(url).hostname or "").lower()
    return 2 if host.endswith(config.TIER2_SUFFIX) else 3
