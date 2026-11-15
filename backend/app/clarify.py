"""Ask before answering when a question is missing something the answer depends on.

Three cases, checked in this order, one question at a time:
  1. a material word that is not recognised but is close to a known one ("SIBEL" -> SIBAL)
  2. an airflow number with no readable speed unit ("100%air", "airflow 5")
  3. a material and an oxygen level but no airflow at all
Every option carries the full rewritten question, so choosing one needs no hidden state.
Nothing here guesses a number: the options are the user's own number with a unit, or values
taken from the tested range in the structured data.
"""
from __future__ import annotations

import difflib
import re
import statistics

from .conditions import ANY_FLOW, MATERIAL_PATTERNS

# words a user may type for a material, and the material group each one stands for
ALIASES = {"sibal": "SIBAL", "nomex": "Nomex", "pmma": "PMMA slab", "acrylic": "PMMA slab", "plexiglas": "PMMA slab", "candle": "Wax candle"}
UNREADABLE_FLOW = [
    re.compile(r"(?P<num>\d+(?:\.\d+)?)\s*(?P<pct>%|percent)?\s*(?:air\s*flow|airflow|air|flow|wind)\b", re.I),
    re.compile(r"(?:air\s*flow|airflow|flow|wind)\s*(?:of|at|=|is|:)?\s*(?P<num>\d+(?:\.\d+)?)\s*(?P<pct>%|percent)?(?!\s*(?:o2|oxygen))", re.I),
]


def _fmt(v: float) -> str:
    return f"{v:g}"


def _tidy(question: str) -> str:
    return re.sub(r"[\s?.!]+$", "", question.strip())


def _opt(label: str, ask: str) -> dict:
    return {"label": label, "ask": ask}


def _typo(question: str, parsed: dict, known: list[str]) -> dict | None:
    if parsed["materials"]:
        return None
    for tok in re.findall(r"[A-Za-z][A-Za-z-]{3,}", question):
        if tok.lower() in ALIASES:
            continue
        hit = difflib.get_close_matches(tok.lower(), list(ALIASES), n=1, cutoff=0.78)
        if hit and ALIASES[hit[0]] in known:
            canon = ALIASES[hit[0]]
            fixed = re.sub(rf"\b{re.escape(tok)}\b", hit[0].upper() if hit[0] == "sibal" else canon, question, count=1, flags=re.I)
            return {"kind": "material", "prompt": f"I don't recognise \"{tok}\" as a material in the NASA data. Did you mean {canon}?",
                    "hint": "Pick one, or type the material name again.", "options": [_opt(canon, fixed), _opt("Show which materials were tested", "What materials were tested?")]}
    return None


def _unit(question: str, parsed: dict) -> dict | None:
    if parsed["flow_cm_s"] is not None or parsed["any_airflow"]:
        return None
    for rx in UNREADABLE_FLOW:
        m = rx.search(question)
        if not m:
            continue
        num = m.group("num")
        span = m.group(0)
        opts = [_opt(f"{num} {u}", question.replace(span, f"{num} {u} airflow", 1)) for u in ("cm/s", "mm/s", "m/s")]
        opts.append(_opt("Any airflow", question.replace(span, "any airflow", 1)))
        pct = " Airflow is a speed, not a percentage." if m.group("pct") else ""
        return {"kind": "airflow_unit", "prompt": f"I could not read \"{span.strip()}\" as an airflow speed.{pct} What unit did you mean for {num}?",
                "hint": "Airflow in these tests is measured in cm/s. You can also type it yourself, for example 5 cm/s.", "options": opts}
    return None


def _missing_flow(question: str, parsed: dict, cond: dict, store) -> dict | None:
    mat = cond.get("material")
    partial = cond.get("gravity") in ("moon", "mars", "partial")
    if (not mat or cond.get("o2_pct") is None or cond.get("flow_cm_s") is not None or parsed["any_airflow"] or parsed["no_airflow_stated"]
            or partial or parsed["intent"] in ("gap", "compare", "closest") or parsed["wants_certification"]):
        return None
    rng = next((m for m in store.ranges["materials"] if m["material_group"] == mat), None)
    starts = sorted({t["flow_start_cm_s"] for t in store.tests if t["material_group"] == mat and t.get("flow_start_cm_s") is not None})
    base = _tidy(question)
    opts = []
    if rng and rng.get("flow_any_cm_s", {}).get("n"):
        lo, hi = rng["flow_any_cm_s"]["min"], rng["flow_any_cm_s"]["max"]
        mid = round(statistics.median(starts), 1) if starts else None
        picks = [v for v in dict.fromkeys([lo, mid, hi]) if v is not None]
        opts = [_opt(f"{_fmt(v)} cm/s", f"{base}, at {_fmt(v)} cm/s airflow?") for v in picks]
        where = f" The {mat} tests in this corpus ran at {_fmt(lo)} to {_fmt(hi)} cm/s."
    else:
        where = ""
    opts.append(_opt("Any airflow", f"{base}, at any airflow?"))
    return {"kind": "airflow_missing", "prompt": f"What airflow should I use for {mat} at {_fmt(cond['o2_pct'])}% oxygen? Airflow changes the outcome, so I won't guess it.{where}",
            "hint": "Pick one, or type a value with its unit, for example 5 cm/s.", "options": opts}


def needed(question: str, parsed: dict, cond: dict, store) -> dict | None:
    """Return {kind, prompt, hint, options:[{label, ask}]} when a question must be completed first, else None."""
    return _typo(question, parsed, store.material_groups) or _unit(question, parsed) or _missing_flow(question, parsed, cond, store)
