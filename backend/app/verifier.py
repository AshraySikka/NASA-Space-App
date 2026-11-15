"""Citation verifier. Runs on every answer before anything reaches the user.

A claim survives only if:
 1. every source id it cites is in this request's passage set (which is built from the registry);
 2. its quote is an exact substring of the cited passage after whitespace/case normalisation
    (with a small fuzzy fallback for PDF hyphenation);
 3. every number in the claim text appears in the quote or in the structured test row it cites;
 4. Tier 2/3 web claims: the backend itself re-fetches the URL and finds the quote on the page;
 5. the URL host is on the allowlist.
"""
from __future__ import annotations

import difflib
import re
import unicodedata
from typing import Callable
from urllib.parse import urlparse

_NUM = re.compile(r"(?<![A-Za-z\d.])-?\d+(?:\.\d+)?(?![A-Za-z]*\d)")
MAX_QUOTE_WORDS = 25


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = s.replace("­", "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", s).strip()


def dehyphen(s: str) -> str:
    return re.sub(r"(\w)-\s+(\w)", r"\1\2", s)


def quote_in(quote: str, text: str) -> tuple[bool, str]:
    q, t = norm(quote), norm(text)
    if not q:
        return False, "empty quote"
    if q in t:
        return True, "exact"
    qd, td = norm(dehyphen(quote)).replace("- ", ""), norm(dehyphen(text)).replace("- ", "")
    if qd in td:
        return True, "exact after de-hyphenation"
    # small fuzzy fallback: tolerate a few characters of PDF noise, never a different sentence
    if len(q) >= 30:
        m = difflib.SequenceMatcher(None, q, t, autojunk=False).find_longest_match(0, len(q), 0, len(t))
        if m.size >= 0.6 * len(q):
            window = t[max(0, m.b - m.a) : max(0, m.b - m.a) + len(q)]
            if difflib.SequenceMatcher(None, q, window, autojunk=False).ratio() >= 0.94:
                return True, "fuzzy (>=94% character match)"
    return False, "quote not found"


def numbers(s: str) -> list[str]:
    out = []
    for m in _NUM.finditer(s or ""):
        v = m.group(0).lstrip("-")
        out.append(str(float(v)).rstrip("0").rstrip(".") if "." in v else str(int(v)))
    return out


def row_numbers(row: dict | None) -> set[str]:
    vals: set[str] = set()
    if not row:
        return vals
    for v in row.values():
        if isinstance(v, bool) or v is None:
            continue
        if isinstance(v, (int, float)):
            vals.update(numbers(f"{v:g}"))
        elif isinstance(v, str):
            vals.update(numbers(v))
    return vals


def host_allowed(url: str, allowed: list[str]) -> bool:
    try:
        u = urlparse(url)
    except Exception:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and host in allowed


def verify_claims(claims: list[dict], passages: dict[str, dict], allowed: list[str], fetch_text: Callable[[str], str | None] | None = None) -> dict:
    """passages: {"S1": {"text", "source_id", "tier", "url", "kind", "row"?, "siblings"?: [other passage ids of the same source]}}"""
    kept, removed, decisions = [], [], []
    for c in claims:
        reasons: list[str] = []
        ids = c.get("source_ids") or []
        quote = (c.get("quote") or "").strip()
        if not ids:
            reasons.append("no source cited")
        unknown = [i for i in ids if i not in passages]
        if unknown:
            reasons.append(f"unknown source id(s): {', '.join(unknown)}")
        cited = [passages[i] for i in ids if i in passages]
        if not quote:
            reasons.append("no verbatim quote")
        elif len(quote.split()) > MAX_QUOTE_WORDS:
            reasons.append(f"quote longer than {MAX_QUOTE_WORDS} words")
        how = None
        if cited and quote and not reasons:
            ok = False
            for p in cited:
                ok, how = quote_in(quote, p["text"])
                if ok:
                    break
            if not ok:
                elsewhere = any(quote_in(quote, passages[s]["text"])[0] for p in cited for s in p.get("siblings", []) if s in passages)
                reasons.append("quote is not on the cited page (it appears on a different page of the same source)" if elsewhere else "quote not found in the cited source text")
        if cited and not reasons:
            have = set(numbers(quote))
            for p in cited:
                have |= row_numbers(p.get("row"))
            missing = [n for n in numbers(c.get("text", "")) if n not in have]
            if missing:
                reasons.append(f"number(s) not supported by the quote or the cited test row: {', '.join(sorted(set(missing)))}")
        live = None
        if cited and not reasons:
            for p in cited:
                if p.get("kind") != "web":
                    continue
                if not host_allowed(p.get("url", ""), allowed):
                    reasons.append(f"URL host is not on the allowlist: {p.get('url')}")
                    break
                page = fetch_text(p["url"]) if fetch_text else None
                if page is None:
                    if p.get("snapshot_read_on"):
                        live = f"snapshot read {p['snapshot_read_on']}; live re-check unavailable"
                    else:
                        reasons.append("could not re-fetch the cited page to confirm the quote")
                        break
                elif quote_in(quote, page)[0]:
                    live = "re-fetched and confirmed live"
                else:
                    reasons.append("quote not found on the live page")
                    break
        tier = max((p["tier"] for p in cited), default=c.get("tier", 3))
        d = {"claim": c.get("text", ""), "source_ids": ids, "quote": quote, "passed": not reasons, "match": how, "live_check": live, "reasons": reasons}
        decisions.append(d)
        if reasons:
            removed.append({"text": c.get("text", ""), "reasons": reasons})
        else:
            kept.append({**c, "tier": tier, "match": how, "live_check": live})
    return {"claims": kept, "removed": removed, "decisions": decisions}
