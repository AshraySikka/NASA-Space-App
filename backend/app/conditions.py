"""Deterministic parser: question text -> conditions and intent. No language model."""
from __future__ import annotations

import re

MATERIAL_PATTERNS = [
    (r"\bsibal\b|cotton[\s/-]*fiber\s?glass", "SIBAL"),
    (r"\bnomex\b", "Nomex"),
    (r"pmma\s+rods?|acrylic\s+rods?|\brods?\b", "PMMA rod"),
    (r"pmma\s+films?|acrylic\s+films?", "PMMA film"),
    (r"\bpmma\b|\bacrylic\b|plexiglas", "PMMA slab"),
    (r"\bcandle\b", "Wax candle"),
]
GRAVITY_PATTERNS = [
    (r"\bmoon\b|\blunar\b|1\s*/\s*6\s*-?\s*g|one[- ]sixth", "moon"),
    (r"\bmars\b|\bmartian\b|0?\.38\s*g", "mars"),
    (r"partial[- ]gravity|reduced[- ]gravity", "partial"),
    (r"\b1\s*-?g\b|earth gravity|normal gravity|on earth\b|on the ground", "1g"),
    (r"micro\s?gravity|\b0\s*-?g\b|zero[- ]g|\biss\b|space station|in orbit|freefall|free fall", "0g"),
]
CERTIFY = re.compile(r"\bis (it|this|that|\w+) safe\b|\bsafe to (use|wear|fly)\b|which (one |material |fabric )?should (i|we) (use|pick|choose)|\brecommend\b|\bcertif", re.I)
GAP = re.compile(r"not (been )?tested|hasn'?t (nasa )?tested|untested|what.*\bgaps?\b|never tested|missing data", re.I)
COMPARE = re.compile(r"\bcompare\b|\bversus\b|\bvs\.?\b|difference between", re.I)
CLOSEST = re.compile(r"\bclosest\b|\bnearest\b|\bnear(by)?\b", re.I)
REFERS_BACK = re.compile(r"\b(it|that|same|this (fabric|material|one)|those|instead|what about|and at|how about)\b", re.I)


# airflow units accepted in a question, with the factor that converts them to cm/s
FLOW_UNITS = [
    (r"cm\s*/\s*s(?:ec)?|cm\s*per\s*s(?:ec(?:ond)?)?", 1.0),
    (r"mm\s*/\s*s(?:ec)?|mm\s*per\s*s(?:ec(?:ond)?)?", 0.1),
    (r"(?<![a-z])m\s*/\s*s(?:ec)?|(?<![a-z])m\s*per\s*s(?:ec(?:ond)?)?|meters?\s*per\s*second", 100.0),
    (r"ft\s*/\s*s(?:ec)?|feet\s*per\s*second|feet/s", 30.48),
    (r"in\s*/\s*s(?:ec)?|inch(?:es)?\s*per\s*second", 2.54),
]
NO_FLOW = re.compile(r"\b(?:no|zero|without|nil)\s+(?:forced\s+)?(?:air\s*flow|airflow|flow|wind|ventilation)\b|\bstill air\b|\bquiescent\b")
ANY_FLOW = re.compile(r"\bany\s+(?:air\s*flow|airflow|flow)|regardless of (?:the )?(?:air\s*flow|airflow|flow)|\ball (?:air\s*flow|airflow|flow)s?\b|\bwhatever (?:air\s*flow|airflow|flow)")


def _num(s: str) -> float:
    return float(s)


def parse(question: str, known_materials: list[str]) -> dict:
    q = question.strip()
    ql = q.lower()
    materials = []
    for pat, group in MATERIAL_PATTERNS:
        if re.search(pat, ql) and group in known_materials and group not in materials:
            materials.append(group)
    # "PMMA slab" is the generic PMMA match; drop it if a more specific PMMA form matched
    if "PMMA slab" in materials and any(m in materials for m in ("PMMA rod", "PMMA film")) and not re.search(r"slab|sheet|thick", ql):
        materials.remove("PMMA slab")

    o2 = None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:o2|oxygen)?", ql) or re.search(r"(?:o2|oxygen)\s*(?:of|at|=|is|level of)?\s*(\d+(?:\.\d+)?)", ql)
    if m and 0 < _num(m.group(1)) <= 100:
        o2 = _num(m.group(1))
    flow = None
    for unit_pat, to_cm_s in FLOW_UNITS:
        m = re.search(rf"(\d+(?:\.\d+)?)\s*(?:{unit_pat})(?![a-z])", ql)
        if m:
            flow = round(_num(m.group(1)) * to_cm_s, 3)
            break
    no_flow = bool(NO_FLOW.search(ql))
    if flow is None and no_flow:
        flow = 0.0
    pressure = None
    m = re.search(r"(\d+(?:\.\d+)?)\s*kpa", ql)
    if m:
        pressure = _num(m.group(1))
    else:
        m = re.search(r"(\d+(?:\.\d+)?)\s*psi", ql)
        if m:
            pressure = round(_num(m.group(1)) * 6.894757, 2)
    gravity = None
    for pat, g in GRAVITY_PATTERNS:
        if re.search(pat, ql):
            gravity = g
            break
    intent = "gap" if GAP.search(q) else ("compare" if COMPARE.search(q) and len(materials) >= 2 else ("closest" if CLOSEST.search(q) else "ask"))
    return {
        "materials": materials, "o2_pct": o2, "flow_cm_s": flow, "pressure_kpa": pressure, "gravity": gravity,
        "no_airflow_stated": no_flow, "any_airflow": bool(ANY_FLOW.search(ql)),
        "intent": intent, "wants_certification": bool(CERTIFY.search(q)), "refers_back": bool(REFERS_BACK.search(q)),
        "has_conditions": bool(materials or o2 is not None or flow is not None or pressure is not None or gravity),
    }


def merge(parsed: dict, question: str, last: dict | None, simulator: dict | None, llm: dict | None = None) -> dict:
    """Resolve the final conditions for this turn.

    Order: what the question says > validated LLM extraction > the previous turn's applied
    conditions (follow-ups only) > the simulator's current material. Numbers are never guessed.
    """
    c = {"material": parsed["materials"][0] if parsed["materials"] else None, "o2_pct": parsed["o2_pct"], "flow_cm_s": parsed["flow_cm_s"], "pressure_kpa": parsed["pressure_kpa"], "gravity": parsed["gravity"]}
    follow_up = parsed["refers_back"] and not parsed["materials"]
    for src in (llm, last if follow_up else None):
        if not src:
            continue
        for k in list(c):
            if k != "from_last" and c[k] is None and src.get(k) is not None:
                c[k] = src[k]
                if src is last:
                    c.setdefault("from_last", []).append(k)
    numeric = any(c[k] is not None for k in ("o2_pct", "flow_cm_s", "pressure_kpa")) or c["gravity"] in ("moon", "mars", "partial")
    about_this = re.search(r"\b(this|it|the) (fabric|material|sample)\b|\bwill (this|it)\b|\bdoes (this|it)\b", question.lower())
    if c["material"] is None and simulator and simulator.get("material") and (numeric or follow_up or about_this):
        # "this fabric" / bare conditions refer to whatever the simulator is showing
        c["material"] = simulator["material"]
        c["from_simulator"] = ["material"]
        if about_this or (c["gravity"] is not None and c["o2_pct"] is None and c["flow_cm_s"] is None):
            for k in ("o2_pct", "flow_cm_s", "pressure_kpa"):
                if c[k] is None and simulator.get(k) is not None:
                    c[k] = simulator[k]
                    c["from_simulator"].append(k)
    return c
