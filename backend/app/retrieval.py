"""Layer 1 retrieval: BM25 over chunks.json. Works fully offline."""
from __future__ import annotations

import math
import re
from functools import lru_cache

from rank_bm25 import BM25Okapi

from .store import Store

STOP = set("a an the of and or to in on at for with by from is are was were be been it its this that these those what which who how does do did will would can could should has have had not no as about into than then there their they them you your we our i me my if so but also such any all some more most very only over under between during after before nasa happened happen tell show give please know data test tests tested testing why go goes out behave behaves used use level levels when where while work works make makes get gets say says said like much many long often happens".split())
SYN = {"moon": ["lunar"], "lunar": ["moon"], "burn": ["flame", "burned", "burning"], "o2": ["oxygen"], "oxygen": ["o2"], "airflow": ["flow"], "extinguish": ["extinguished", "quenched", "extinction"], "smoke": ["aerosol"], "made": ["blend", "composition"], "upper": ["uloi"], "limit": ["uloi", "limiting"], "composition": ["blend"], "nomex": ["nomex"], "fabric": ["fabric"]}
_TOK = re.compile(r"[a-z]+(?:-[a-z]+)*|\d+(?:\.\d+)?")


def tokens(text: str) -> list[str]:
    out = []
    for t in _TOK.findall(text.lower()):
        if t in STOP or len(t) == 1 and not t.isdigit():
            continue
        out.append(t[:-1] if len(t) > 4 and t.endswith("s") and not t.endswith("ss") else t)
    return out


class Index:
    def __init__(self, store: Store):
        self.chunks = [c for c in store.chunks if c.get("text")]
        self.docs = [tokens(c["text"]) for c in self.chunks]
        self.bm25 = BM25Okapi(self.docs)
        n = len(self.docs)
        df: dict[str, int] = {}
        for d in self.docs:
            for t in set(d):
                df[t] = df.get(t, 0) + 1
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.max_idf = math.log(1 + (n + 0.5) / 0.5)

    def search(self, query: str, k: int = 6, source_ids: set[str] | None = None, max_tier: int = 3) -> dict:
        q = tokens(query)
        expanded = q + [s for t in q for s in SYN.get(t, [])]
        if not q:
            return {"hits": [], "coverage": 0.0, "query_terms": []}
        scores = self.bm25.get_scores(expanded)
        idx = [i for i in sorted(range(len(scores)), key=lambda i: -scores[i]) if scores[i] > 0 and self.chunks[i]["tier"] <= max_tier and (not source_ids or self.chunks[i]["source_id"] in source_ids)]
        hits, per_source = [], {}
        for i in idx:
            sid = self.chunks[i]["source_id"]
            if per_source.get(sid, 0) >= 2:  # keep variety across documents
                continue
            per_source[sid] = per_source.get(sid, 0) + 1
            hits.append({"chunk": self.chunks[i], "score": float(scores[i])})
            if len(hits) >= k:
                break
        # Coverage: idf-weighted share of the question's content words found in the best passages.
        uniq = list(dict.fromkeys(q))
        total = sum(self.idf.get(t, self.max_idf) for t in uniq)
        seen = set()
        for h in hits[:3]:
            seen |= set(tokens(h["chunk"]["text"]))
        got = sum(self.idf.get(t, self.max_idf) for t in uniq if t in seen or any(s in seen for s in SYN.get(t, [])))
        unknown = [t for t in uniq if t not in self.idf and not any(s in self.idf for s in SYN.get(t, []))]
        return {"hits": hits, "coverage": round(got / total, 3) if total else 0.0, "query_terms": uniq, "unknown_terms": unknown}


@lru_cache(maxsize=1)
def get_index() -> Index:
    from .store import get_store

    return Index(get_store())


_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9“\"(])")
_WORD = re.compile(r"[A-Za-z][a-z]{1,}[a-z,;:.)]*$|^[A-Z]{2,6}[:,.]?$|^[a-z]+-[a-z]+")


def prose_ratio(words: list[str]) -> float:
    return sum(1 for w in words if _WORD.match(w)) / max(1, len(words))


def quote_coverage(quote: str, query: str, index: "Index") -> float:
    """idf-weighted share of the question's content words that appear in one quoted sentence."""
    q = list(dict.fromkeys(tokens(query)))
    total = sum(index.idf.get(t, index.max_idf) for t in q)
    have = set(tokens(quote))
    got = sum(index.idf.get(t, index.max_idf) for t in q if t in have or any(x in have for x in SYN.get(t, [])))
    n_hit = sum(1 for t in q if t in have or any(x in have for x in SYN.get(t, [])))
    if len(q) >= 2 and n_hit < 2:
        return 0.0  # one shared word is a coincidence, not an answer
    return got / total if total else 0.0


def best_quote(text: str, query: str, max_words: int = 24) -> str | None:
    """Pick the passage sentence that best matches the question. Always a contiguous,
    verbatim slice of the passage, at most max_words long. Reference lists, figure debris
    and table rows are skipped. Slide-style text with no sentences falls back to a window."""
    q = set(tokens(query)) | {x for t in tokens(query) for x in SYN.get(t, [])}
    best, best_score = None, 0.0
    for s in _SENT.split(text):
        words = s.split()
        if len(words) < 8 or "|" in s or re.search(r"\[\d+\]|^References\b|et al\.", s):
            continue
        pr = prose_ratio(words)
        if pr < 0.72:
            continue
        overlap = len(q & set(tokens(s)))
        score = overlap * pr / (1 + abs(len(words) - 18) / 30)
        if score > best_score:
            best, best_score = s, score
    if best is None or best_score < 1.2:
        words = text.split()
        for i in range(0, max(1, len(words) - 8), 4):
            w = words[i : i + 20]
            joined = " ".join(w)
            if "|" in w or prose_ratio(w) < 0.5 or re.search(r"References|pp\.|Vol\.|\[\d+\]|Journal|Proceedings", joined) or len(re.findall(r"\b(?:19|20)\d\d\b", joined)) >= 2:
                continue
            score = len(q & set(tokens(" ".join(w)))) * 0.8
            if score > best_score:
                best, best_score = " ".join(w), score
    if not best:
        return None
    words = best.split()
    if len(words) > max_words:
        w0 = max(range(0, len(words) - max_words + 1), key=lambda i: len(q & set(tokens(" ".join(words[i : i + max_words])))))
        words = words[w0 : w0 + max_words]
    return " ".join(words).strip()
