"""Pure helpers for the ingestion pipeline. No file IO here so they are unit-testable."""
from __future__ import annotations

import datetime as _dt
import re
from typing import Any, Iterable

# ---------------------------------------------------------------- text utils
_WS = re.compile(r"\s+")


def clean(s: Any) -> str:
    return _WS.sub(" ", str(s)).strip() if s is not None else ""


def to_float(v: Any) -> float | None:
    if v is None or isinstance(v, (_dt.datetime, _dt.date)):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = clean(v)
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        return float(s)
    return None


def slug_class(phrase: str) -> str:
    """Outcome phrase -> OUTCOME_CLASS. Classes are derived from data, never listed in code."""
    s = re.sub(r"[^A-Za-z0-9]+", "_", clean(phrase)).strip("_").upper()
    return s or "NOT_STATED"


# ------------------------------------------------------- Excel date corruption
def repair_excel_date(value: Any, assume_year: int) -> tuple[str | None, bool]:
    """Excel turned entries such as '5, 1' or '9, 5, 4' into dates.

    Returns (repaired_text, was_corrupted). A date in `assume_year` (the year the sheet
    was edited, when Excel had no year to work with) decodes to 'month day'. Any other
    year decodes to 'month day yy'. The caller cross-checks against the untouched CSV.
    """
    if isinstance(value, (_dt.datetime, _dt.date)):
        parts = [value.month, value.day]
        if value.year != assume_year:
            parts.append(value.year % 100)
        return "  ".join(str(p) for p in parts), True
    return (clean(value) or None), False


def numbers_in(text: str | None) -> list[float]:
    if not text:
        return []
    return [float(x) for x in re.findall(r"(?<![\w.])\d+(?:\.\d+)?", text)]


def parse_air_display(text: str | None) -> dict:
    """Raw 'Air display' string -> start/end raw readings. Only when the cell is a clean
    list of numbers; anything with words ('down to ext', 'max', '<1') keeps start only."""
    t = clean(text)
    out = {"start": None, "end": None, "clean_list": False, "text": t or None}
    if not t:
        return out
    if re.fullmatch(r"[\d.,\s]+", t):
        nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", t)]
        if nums:
            out.update(start=nums[0], end=nums[-1], clean_list=True)
        return out
    m = re.match(r"\s*(\d+(?:\.\d+)?)", t)
    if m:
        out["start"] = float(m.group(1))
    return out


# ------------------------------------------------------------------ anomalies
def final_o2_anomaly(initial: float | None, final: float | None, max_drop: float, max_rise: float) -> str | None:
    """A final O2 far below or above the initial reading in a sealed glovebox burn is
    treated as a likely data-entry error. Thresholds come from config, not from this file."""
    if initial is None or final is None:
        return None
    if final - initial > max_rise:
        return f"implausible_final_o2: final {final:g}% is above initial {initial:g}%"
    if initial - final > max_drop:
        return f"implausible_final_o2: final {final:g}% is more than {max_drop:g} points below initial {initial:g}%"
    return None


# ------------------------------------------------------------ material groups
def material_group(label: str) -> str:
    """Map a raw fuel label to a material group. Labels themselves are kept verbatim."""
    s = clean(label).lower()
    if "sibal" in s:
        return "SIBAL"
    if "nomex" in s:
        return "Nomex"
    if "candle" in s:
        return "Wax candle"
    if "rod" in s:
        return "PMMA rod"
    if "spher" in s:
        return "Spherical section"
    if "film" in s or "micron" in s:
        return "PMMA film"
    if "pmma" in s:
        return "PMMA slab"
    return clean(label) or "Unlabelled"


# ----------------------------------------------------------------- conflicts
def compare_fields(a: dict, b: dict, fields: Iterable[str], tol: float = 1e-6) -> list[dict]:
    """Field-by-field comparison of two records of the same test. Returns disagreements."""
    out = []
    for f in fields:
        va, vb = a.get(f), b.get(f)
        if va is None or vb is None:
            continue
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
            if abs(float(va) - float(vb)) > tol:
                out.append({"field": f, "a": va, "b": vb})
        elif clean(va).lower() != clean(vb).lower():
            out.append({"field": f, "a": va, "b": vb})
    return out


# ------------------------------------------------------------------ chunking
def chunk_words(text: str, max_words: int, overlap: int) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [" ".join(words)] if words else []
    out, i = [], 0
    step = max_words - overlap
    while i < len(words):
        out.append(" ".join(words[i : i + max_words]))
        if i + max_words >= len(words):
            break
        i += step
    return out


def looks_garbled(text: str) -> bool:
    """Font-encoding failures give text full of control characters or no real words."""
    if len(text) < 200:
        return False
    ctrl = sum(1 for c in text if ord(c) < 32 and c not in "\n\t\r")
    words = re.findall(r"[A-Za-z]{3,}", text)
    common = sum(1 for w in words if w.lower() in _COMMON)
    return ctrl / len(text) > 0.02 or (len(words) > 40 and common / len(words) < 0.03)


_COMMON = set(
    "the and for with that this from are was were has have not flame fuel test tests data flow "
    "oxygen air sample samples which will can into than between during after each also been "
    "space fire burning combustion experiment results nasa gravity".split()
)


def detect_heading(page_text: str) -> str | None:
    for line in page_text.splitlines()[:25]:
        s = line.strip()
        if re.fullmatch(r"(\d+(\.\d+)*\.?|[IVX]+\.)\s+[A-Z][^\n]{3,80}", s) or re.fullmatch(r"(TABLE|Table|Figure) [A-Z0-9.]+[.—-].{3,90}", s):
            return s
    return None


# ------------------------------------------------------ BASS-II Table 7.1 parse
_T71 = re.compile(
    r"GMT(?P<gmt>\d+)-(?P<id>T\d+[ab]?)\s+(?P<width>\d+(?:\.\d+)?)\s+(?P<flow>\d+(?:\.\d+)?(?:\s+to\s+\d+(?:\.\d+)?)?)\s+(?P<o2>\d+(?:\.\d+)?)b?\s+(?P<comment>[^\n]+(?:\n(?!GMT|a[A-Z]|b[A-Z])[a-z][^\n]*)?)"
)


def parse_table_7_1(page_text: str) -> dict[str, dict]:
    """Parse TM-20210011385 Table 7.1 straight from the PDF text layer."""
    rows: dict[str, dict] = {}
    for m in _T71.finditer(page_text):
        flow = m.group("flow")
        nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", flow)]
        comment = clean(m.group("comment"))
        if set(comment) <= {"-"}:
            comment = ""
        if comment == "BASS":
            continue  # BASS (not BASS-II) rows share ids with BASS-II; out of scope here
        rows[m.group("id")] = {
            "gmt": int(m.group("gmt")),
            "width_cm": float(m.group("width")),
            "flow_start_cm_s": nums[0],
            "flow_end_cm_s": nums[-1],
            "o2_pct_initial": float(m.group("o2")),
            "published_comment": comment,
        }
    return rows
