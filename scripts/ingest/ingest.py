#!/usr/bin/env python3
"""Ingestion pipeline: raw_data/ -> data/processed/*.json (+ reports).

Run:  python scripts/ingest/ingest.py --raw raw_data --out data/processed --docs docs

Nothing in data/processed is written by hand. Every number in the app is read from the
files this script produces. See docs/ARCHITECTURE.md for the data flow.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lib  # noqa: E402

REPORT: dict[str, list] = defaultdict(list)
CACHE_DIR: Path | None = None


def log(section: str, msg: str) -> None:
    REPORT[section].append(msg)


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# =============================================================== text extraction
def pdf_pages(path: Path, cfg: dict) -> list[dict]:
    """Per-page text with a fallback chain: PyMuPDF -> pdfplumber -> pdftotext -> OCR."""
    import fitz  # PyMuPDF

    low = cfg["low_text_chars"]
    doc = fitz.open(path)
    whole_garbled = lib.looks_garbled(" ".join(p.get_text() for p in doc))
    pages = []
    for i, page in enumerate(doc):
        text, method = page.get_text(), "pymupdf"
        if whole_garbled or len(text.strip()) < low:
            alt = "" if whole_garbled else _pdfplumber_page(path, i)
            if len(alt.strip()) >= low:
                text, method = alt, "pdfplumber"
            else:
                alt = "" if whole_garbled else _pdftotext_page(path, i + 1)
                if len(alt.strip()) >= low:
                    text, method = alt, "pdftotext"
                else:
                    ocr = _ocr_page(page, cfg["ocr_dpi"])
                    if len(ocr.strip()) > len(text.strip()) or whole_garbled:
                        text, method = ocr, "ocr"
        pages.append({"page": i + 1, "text": text, "method": method})
    return pages


def _pdfplumber_page(path: Path, idx: int) -> str:
    try:
        import pdfplumber

        with pdfplumber.open(path) as pdf:
            return pdf.pages[idx].extract_text() or ""
    except Exception:
        return ""


def _pdftotext_page(path: Path, n: int) -> str:
    try:
        r = subprocess.run(["pdftotext", "-f", str(n), "-l", str(n), "-layout", str(path), "-"], capture_output=True, timeout=60)
        return r.stdout.decode("utf-8", "replace")
    except Exception:
        return ""


def _ocr_page(page, dpi: int) -> str:
    try:
        import io

        import pytesseract
        from PIL import Image

        pix = page.get_pixmap(dpi=dpi)
        return pytesseract.image_to_string(Image.open(io.BytesIO(pix.tobytes("png"))))
    except Exception as e:  # OCR is best-effort
        return ""


def docx_pages(path: Path) -> list[dict]:
    import docx

    d = docx.Document(str(path))
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for t in d.tables:  # preserve tables as text rows
        for row in t.rows:
            cells = [lib.clean(c.text) for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return [{"page": None, "text": "\n".join(parts), "method": "python-docx"}]


def pptx_pages(path: Path) -> list[dict]:
    import pptx

    out = []
    for i, slide in enumerate(pptx.Presentation(str(path)).slides, 1):
        bits = []
        for shp in slide.shapes:
            if shp.has_text_frame:
                bits.append(shp.text_frame.text)
            if getattr(shp, "has_table", False) and shp.has_table:
                for row in shp.table.rows:
                    bits.append(" | ".join(lib.clean(c.text) for c in row.cells))
        out.append({"page": i, "text": "\n".join(bits), "method": "python-pptx"})
    return out


def xlsx_pages(path: Path) -> list[dict]:
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    out = []
    for ws in wb:
        rows = []
        for row in ws.iter_rows(values_only=True):
            cells = [lib.clean(c) for c in row if c is not None and lib.clean(c)]
            if cells:
                rows.append(" | ".join(cells))
        # ~25 rows per block keeps table rows together and chunks a sensible size
        for k in range(0, len(rows), 25):
            out.append({"page": None, "sheet": ws.title, "text": f"[sheet: {ws.title}]\n" + "\n".join(rows[k : k + 25]), "method": "openpyxl"})
    return out


def csv_pages(path: Path) -> list[dict]:
    rows = list(csv.reader(path.open(encoding="utf-8-sig", errors="replace")))
    head, out = rows[0], []
    for k in range(1, len(rows), 15):
        lines = [" | ".join(f"{h.strip()}: {v.strip()}" for h, v in zip(head, r) if v.strip()) for r in rows[k : k + 15]]
        out.append({"page": None, "text": "\n".join(lines), "method": "csv"})
    return out


EXTRACTORS = {".pdf": pdf_pages, ".docx": lambda p, c: docx_pages(p), ".pptx": lambda p, c: pptx_pages(p), ".xlsx": lambda p, c: xlsx_pages(p), ".csv": lambda p, c: csv_pages(p)}


# ==================================================================== sources
def build_sources(raw: Path, registry: dict, cfg: dict):
    files = sorted(p for p in raw.iterdir() if p.is_file())
    by_hash: dict[str, Path] = {}
    kept: list[Path] = []
    for p in files:
        h = sha(p)
        if h in by_hash:
            # keep the name without a "(1)" suffix
            a, b = by_hash[h], p
            keep, drop = (a, b) if "(1)" not in a.name else (b, a)
            by_hash[h] = keep
            if drop in kept:
                kept.remove(drop)
                kept.append(keep)
            log("Duplicates dropped (same SHA-256)", f"`{drop.name}` is byte-identical to `{keep.name}`")
        else:
            by_hash[h] = p
            kept.append(p)
    hashes = {p: h for h, p in by_hash.items()}

    sources, pages_by_source = [], {}
    for p in sorted(kept):
        ext = p.suffix.lower()
        if p.name in registry["skip"]:
            log("Skipped files", f"`{p.name}`: {registry['skip'][p.name]}")
            continue
        if ext in (".mp4", ".zip", ".jpg", ".png"):
            log("Skipped files", f"`{p.name}`: media or archive. Video is never ingested into the search index (BASS B-series clips are PMMA film, not fabric).")
            continue
        meta = registry["files"].get(p.name)
        if meta is None:
            log("Skipped files", f"`{p.name}`: no entry in source_registry.json. Add one to ingest it.")
            continue
        src = {
            "id": meta["id"], "title": meta["title"], "publisher": meta["publisher"], "year": meta.get("year"),
            "document_type": meta["type"], "url": meta["url"], "pdf_url": meta.get("pdf_url"), "doi": None,
            "local_filename": p.name, "content_hash": hashes[p], "tier": 1, "notes": meta.get("notes"),
            "printed_page_offset": meta.get("printed_page_offset"), "indexed": meta.get("index", True),
        }
        if ext in EXTRACTORS:
            cache = CACHE_DIR / f"{hashes[p]}.json" if CACHE_DIR else None
            if cache and cache.exists():
                pages = json.loads(cache.read_text())
            else:
                pages = EXTRACTORS[ext](p, cfg)
                if cache:
                    cache.write_text(json.dumps(pages))
            pages_by_source[src["id"]] = pages
            if ext == ".pdf":
                src["page_count"] = len(pages)
                methods = Counter(pg["method"] for pg in pages)
                src["extraction_methods"] = dict(methods)
                empty = [pg["page"] for pg in pages if len(pg["text"].strip()) < cfg["low_text_chars"]]
                if empty:
                    log("Pages where extraction returned almost nothing", f"`{p.name}` ({src['id']}): pages {empty} still under {cfg['low_text_chars']} characters after every fallback (mostly figures or blank pages)")
                if methods.get("ocr"):
                    log("OCR fallback used", f"`{p.name}` ({src['id']}): {methods['ocr']} of {len(pages)} pages read by OCR. OCR text can contain recognition errors; quotes from these pages are checked against the OCR text, not the image.")
                # A DOI counts as the document's own only if printed on its first page.
                m = re.search(r"(?:doi\.org/|doi:\s*)(10\.\d{4,9}/[^\s\"<>]+)", pages[0]["text"], re.I)
                if m:
                    src["doi"] = m.group(1).rstrip(".,;)")
        sources.append(src)
    return sources, pages_by_source


# ===================================================================== chunks
def build_chunks(sources: list[dict], pages_by_source: dict, cfg: dict) -> list[dict]:
    c = cfg["chunk"]
    chunks = []
    for src in sources:
        if not src.get("indexed", True):
            continue
        off = src.get("printed_page_offset")
        n = 0
        for pg in pages_by_source.get(src["id"], []):
            text = pg["text"]
            if lib.looks_garbled(text):
                continue
            heading = lib.detect_heading(text)
            for piece in lib.chunk_words(text, c["max_words"], c["overlap_words"]):
                if len(piece.split()) < c["min_words"]:
                    continue
                n += 1
                printed = None
                if pg["page"] and off is not None:
                    m = re.search(r"NASA/TM-20210011385\s+(\d+|[ivxl]+)\b", text)
                    printed = m.group(1) if m else None
                chunks.append({
                    "id": f"{src['id']}#{n}", "source_id": src["id"], "pdf_page": pg["page"] if src["local_filename"].lower().endswith(".pdf") else None,
                    "slide": pg["page"] if src["local_filename"].lower().endswith(".pptx") else None, "sheet": pg.get("sheet"),
                    "printed_page": printed, "section": heading, "extraction": pg["method"], "tier": src["tier"], "text": piece,
                })
    return chunks


# ====================================================================== tests
def read_verified(raw: Path) -> dict[str, dict]:
    import openpyxl

    wb = openpyxl.load_workbook(raw / "BASS_II_Verified_Fabric_Outcomes.xlsx", data_only=True)

    def table(ws):
        rows = list(ws.iter_rows(values_only=True))
        hi = next(i for i, r in enumerate(rows) if r and lib.clean(r[0]) == "Test ID")
        head = [lib.clean(h) for h in rows[hi]]
        return [dict(zip(head, r)) for r in rows[hi + 1 :] if r and r[0]], rows[:hi]

    outcomes, o_pre = table(wb["Outcomes"])
    conds, c_pre = table(wb["Conditions"])
    cond = {lib.clean(r["Test ID"]): r for r in conds}
    recs = {}
    for r in outcomes:
        tid = lib.clean(r["Test ID"])
        c = cond.get(tid, {})
        recs[tid] = {
            "test_id": tid, "material_label_reviewed": lib.clean(r["Material"]), "outcome_text": lib.clean(r["Recorded outcome"]),
            "what_happened": lib.clean(r["What happened"]), "o2_pct_initial": lib.to_float(r["Initial O2 (%)"]),
            "printed_page": lib.to_float(r["Printed page"]), "pdf_page": lib.to_float(r["PDF page"]), "review_note": lib.clean(r["Review note"]),
            "flow_start_cm_s": lib.to_float(c.get("Published starting flow (cm/s)")), "flow_end_cm_s": lib.to_float(c.get("Published final flow (cm/s)")),
            "width_cm": lib.to_float(c.get("Sample width (cm)")), "reused": lib.clean(c.get("Reused flag in Table 7.1")),
            "listed_quenched": lib.clean(c.get("Listed as quenched in Table 7.1")), "raw_air_display": lib.clean(c.get("Raw Air display")),
            "raw_material_label": lib.clean(c.get("Raw material label")), "data_qualification": lib.clean(c.get("Data qualification")),
        }
    header_notes = [lib.clean(x) for row in (o_pre + c_pre) for x in row if x is not None and lib.clean(x)]
    return recs, header_notes


def read_psi_csv(raw: Path) -> list[dict]:
    rows = list(csv.reader((raw / "PSI-25_Experimental table_BASS-II.csv").open(encoding="utf-8-sig", errors="replace")))
    head = [lib.clean(h) for h in rows[0]]
    return [dict(zip(head, [v.strip() for v in r])) for r in rows[1:] if len(r) > 1 and r[1].strip()]


def read_working_sheet(raw: Path):
    """Team working copy: detect and repair Excel date corruption, read the partial 'verified tests' tab."""
    import openpyxl

    wb = openpyxl.load_workbook(raw / "NASA Hackathon - Data - Fabric Research  (1).xlsx", data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    dates = [c for r in rows[1:] for c in (r[7], r[8]) if isinstance(c, dt.datetime)]
    assume_year = Counter(d.year for d in dates).most_common(1)[0][0] if dates else dt.date.today().year
    repaired = {}
    for r in rows[1:]:
        if not r[1]:
            continue
        for col, name in ((7, "Fan display"), (8, "Air display")):
            text, bad = lib.repair_excel_date(r[col], assume_year)
            if bad:
                repaired[(lib.clean(r[1]), name)] = {"cell_value": r[col].isoformat(), "repaired": text}
    vt = []
    if "verified tests" in wb.sheetnames:
        vrows = list(wb["verified tests"].iter_rows(values_only=True))
        vhead = [lib.clean(h) for h in vrows[0]]
        vt = [dict(zip(vhead, r)) for r in vrows[1:] if r and r[0]]
    return repaired, vt, assume_year


def build_tests(raw: Path, sources: list[dict], pages_by_source: dict, cfg: dict, visuals: dict):
    src_ids = {s["id"] for s in sources}
    tm_pages = {pg["page"]: pg["text"] for pg in pages_by_source.get("ntrs-20210011385", [])}
    verified, header_notes = read_verified(raw)
    psi = read_psi_csv(raw)
    psi_by_id = {r["Test #"]: r for r in psi}
    repaired, working_verified, assume_year = read_working_sheet(raw)
    an = cfg["anomaly"]

    # ---- Excel date-corruption repair, cross-checked against the untouched CSV
    for (tid, col), info in sorted(repaired.items()):
        truth = psi_by_id.get(tid, {}).get(col, "")
        ok = lib.numbers_in(info["repaired"]) == lib.numbers_in(truth)
        log("Excel date corruption repaired (working sheet)", f"{tid} `{col}`: cell held date {info['cell_value'][:10]} -> decoded `{info['repaired']}`; untouched PSI-25 CSV says `{truth}` -> {'MATCH' if ok else 'MISMATCH, CSV value used'}")
    log("Excel date corruption repaired (working sheet)", f"Decode rule: Excel read 'm, d' as a date in {assume_year} and 'm, d, yy' as a date in year yy. The app never reads airflow from the corrupted sheet; the PSI-25 CSV is the raw source and Table 7.1 is the published source.")

    # ---- Table 7.1 parsed from the PDF text layer, used to cross-check the review sheet
    t71_page = next((p for p, t in tm_pages.items() if "TABLE 7.1" in t and "GMT45-T1" in t), None)
    t71 = lib.parse_table_7_1(tm_pages[t71_page]) if t71_page else {}
    log("Cross-checks", f"Table 7.1 located on PDF page {t71_page} of TM-20210011385; {len(t71)} BASS-II rows parsed from the PDF text layer.")

    tests, conflicts_n, crosschecked = [], 0, 0
    for tid, v in verified.items():
        p = psi_by_id.get(tid, {})
        flags, conflicts = [], []
        group = lib.material_group(v["raw_material_label"] or v["material_label_reviewed"])
        # review sheet vs PDF table
        if tid in t71:
            d = lib.compare_fields(v, t71[tid], ["o2_pct_initial", "flow_start_cm_s", "flow_end_cm_s", "width_cm"])
            crosschecked += 1
            for x in d:
                conflicts.append({"field": x["field"], "review_sheet": x["a"], "table_7_1_pdf": x["b"], "kept": x["b"], "why": "page-referenced report value preferred"})
                v[x["field"]] = x["b"]
        # review sheet vs raw PSI CSV (initial O2)
        csv_o2 = lib.to_float(p.get("Calibrated initial O2 % by vol"))
        if csv_o2 is not None and v["o2_pct_initial"] is not None and abs(csv_o2 - v["o2_pct_initial"]) > 1e-6:
            conflicts.append({"field": "o2_pct_initial", "review_sheet": v["o2_pct_initial"], "psi_25_csv": csv_o2, "kept": v["o2_pct_initial"], "why": "page-referenced report value preferred"})
        # width: Table 7.1 vs raw label
        m = re.search(r"(\d+(?:\.\d+)?)\s*cm", v["raw_material_label"])
        if m and tid in t71 and abs(float(m.group(1)) - round(t71[tid]["width_cm"])) > 0.5:
            conflicts.append({"field": "width_cm", "table_7_1_pdf": t71[tid]["width_cm"], "raw_label": v["raw_material_label"], "kept": None, "why": "Table 7.1 and the raw sample label disagree; width left unknown"})
            v["width_cm"] = None
        # team working sheet 'verified tests' tab
        for w in working_verified:
            if lib.clean(w.get("Test ID")) != tid:
                continue
            wrec = {"o2_pct_initial": lib.to_float(w.get("Oxygen (%)")), "flow_start_cm_s": lib.to_float(w.get("Starting airflow (cm/s)")), "flow_end_cm_s": lib.to_float(w.get("Final airflow (cm/s)")), "width_cm": lib.to_float(w.get("Fabric width (cm)"))}
            d = lib.compare_fields(wrec, v, list(wrec))
            for x in d:
                conflicts.append({"field": x["field"], "working_sheet": x["a"], "review_sheet": x["b"], "kept": x["b"], "why": "page-referenced report value preferred"})
            res = lib.clean(w.get("Result"))
            log("Working-sheet 'verified tests' tab vs verified-outcomes file", f"{tid}: numeric fields {'DISAGREE ' + json.dumps(d) if d else 'agree'}" + (f"; result wording differs (`{res}` vs `{v['outcome_text']}`), the verified-outcomes wording is used because it does not over-state the ending" if res and res.lower() != v["outcome_text"].lower() else ""))
        # final O2 from the raw table, with plausibility check
        o2f = lib.to_float(p.get("Calibrated final O2 % by vol"))
        a = lib.final_o2_anomaly(v["o2_pct_initial"], o2f, an["final_o2_max_drop_points"], an["final_o2_max_rise_points"])
        if a:
            flags.append(a)
            log("Anomalies flagged (never plotted)", f"{tid} ({group}): PSI-25 'Calibrated final O2' = {o2f:g} with initial {v['o2_pct_initial']:g}. Treated as a likely data-entry error; o2_pct_final set to null.")
            o2f_keep = None
        else:
            o2f_keep = o2f
        if "date requires review" in v["data_qualification"]:
            flags.append("source_date_requires_review")
        if conflicts:
            conflicts_n += 1
            for cf in conflicts:
                log("Conflicts (both values stored on the row)", f"{tid}: {json.dumps(cf)}")
        ppage = int(v["pdf_page"]) if v["pdf_page"] else None
        tests.append({
            "test_id": tid, "series": "BASS-II", "material": v["raw_material_label"] or v["material_label_reviewed"], "material_group": group,
            "o2_pct_initial": v["o2_pct_initial"], "o2_pct_final": o2f_keep, "pressure_kpa": None,
            "flow_start_cm_s": v["flow_start_cm_s"], "flow_end_cm_s": v["flow_end_cm_s"],
            "flow_basis": "published (Table 7.1)" if v["flow_start_cm_s"] is not None else "not established (raw air display only)",
            "raw_air_display": v["raw_air_display"] or None, "width_cm": v["width_cm"], "gravity_label": "microgravity (ISS)",
            "outcome_class": lib.slug_class(v["outcome_text"]), "outcome_text": v["outcome_text"], "what_happened": v["what_happened"],
            "published_comment": t71.get(tid, {}).get("published_comment") or None,
            "report_observation": report_observation(tm_pages.get(ppage, ""), tid),
            "spread_rate_mm_s": None, "source_id": "ntrs-20210011385", "reviewed_in": "apex-verified-outcomes",
            "pdf_page": ppage, "printed_page": int(v["printed_page"]) if v["printed_page"] else None,
            "conditions_pdf_page": t71_page if tid in t71 else ppage, "review_note": v["review_note"], "data_qualification": v["data_qualification"],
            "reused": v["reused"] == "Yes", "listed_quenched": v["listed_quenched"] == "Yes", "anomaly_flags": flags,
            "conflict": bool(conflicts), "conflicts": conflicts, "evidence_role": "verified", "tier": 1,
        })
    log("Cross-checks", f"{crosschecked} of {sum(1 for t in tests if t['material_group']=='SIBAL')} SIBAL review-sheet rows were compared field by field (O2, start flow, final flow, width) with Table 7.1 as parsed from the PDF.")

    # Nomex rows: confirm the calibrated O2 values appear on the cited appendix page
    for t in tests:
        if t["material_group"] == "Nomex" and t["pdf_page"]:
            txt = tm_pages.get(t["pdf_page"], "")
            ok = t["test_id"] in txt and f"{t['o2_pct_initial']:g}" in txt
            log("Cross-checks", f"{t['test_id']} (Nomex): id and initial O2 {t['o2_pct_initial']:g}% {'found' if ok else 'NOT found'} in the text of PDF page {t['pdf_page']}.")

    # ---- context rows: every other PSI-25 test stays in its own material group
    for r in psi:
        tid = r["Test #"]
        if tid in verified:
            continue
        label = r["Fuel Sample Material"]
        o2i, o2f = lib.to_float(r["Calibrated initial O2 % by vol"]), lib.to_float(r["Calibrated final O2 % by vol"])
        flags = []
        a = lib.final_o2_anomaly(o2i, o2f, an["final_o2_max_drop_points"], an["final_o2_max_rise_points"])
        if a:
            flags.append(a)
            log("Anomalies flagged (never plotted)", f"{tid} ({lib.material_group(label)}): PSI-25 'Calibrated final O2' = {o2f:g} with initial {o2i:g}. Treated as a likely data-entry error; o2_pct_final set to null.")
            o2f = None
        air = lib.parse_air_display(r["Air display"])
        tests.append({
            "test_id": tid, "series": "BASS-II", "material": label, "material_group": lib.material_group(label),
            "o2_pct_initial": o2i, "o2_pct_final": o2f, "pressure_kpa": None,
            "flow_start_cm_s": air["start"], "flow_end_cm_s": air["end"] if air["clean_list"] else None,
            "flow_basis": "raw air display (uncalibrated)" if air["start"] is not None else "not recorded",
            "raw_air_display": air["text"], "width_cm": None, "gravity_label": "microgravity (ISS)",
            "outcome_class": lib.slug_class("Outcome not reviewed"), "outcome_text": "Outcome not reviewed", "what_happened": None, "published_comment": None, "report_observation": None,
            "spread_rate_mm_s": None, "source_id": "psi-25-table", "reviewed_in": None, "pdf_page": None, "printed_page": None, "conditions_pdf_page": None,
            "review_note": "Context row from the PSI-25 table. The table has no outcome column and this row has not been checked against the report.",
            "data_qualification": "Raw table values; airflow is the raw air-display reading, not calibrated flow" + ("" if air["clean_list"] or air["start"] is None else "; the air-display cell contains text, so only the first reading is used and the final flow is unknown"),
            "reused": None, "listed_quenched": False, "anomaly_flags": flags, "conflict": False, "conflicts": [], "evidence_role": "context", "tier": 1,
        })

    # ---- Saffire VI published events (from the cards workbook), verified against the paper if present
    import openpyxl

    wb = openpyxl.load_workbook(raw / "NASA_Fire_Research_Cards.xlsx", data_only=True)
    events = []
    if "Saffire VI" in wb.sheetnames:
        rows = list(wb["Saffire VI"].iter_rows(values_only=True))
        hi = next(i for i, r in enumerate(rows) if r and lib.clean(r[0]) == "Event")
        head = [lib.clean(h) for h in rows[hi]]
        events = [dict(zip(head, r)) for r in rows[hi + 1 :] if r and r[0] is not None]
    paper_id = "ntrs-20250002675"
    paper_pages = pages_by_source.get(paper_id, [])
    for e in events:
        o2, kpa = lib.to_float(e.get("Initial O2 (%)")), lib.to_float(e.get("Pressure (kPa)"))
        label = lib.clean(e.get("Material"))
        found_page = None
        for pg in sorted(paper_pages, key=lambda g: 0 if re.search(r"Table 1\.\s+Summary", g["text"]) else 1):
            t = pg["text"]
            if o2 is not None and re.search(rf"(?<!\d){o2:.1f}\s*%", t) and (kpa is None or re.search(rf"(?<!\d){kpa:.1f}\s*kPa", lib.clean(t), re.I)) and "Table 1" in t:
                found_page = pg["page"]
                break
        in_corpus = paper_id in src_ids
        if found_page:
            tier, qual = 1, f"Values confirmed in the text of {paper_id} PDF page {found_page} (Table 1)."
        elif in_corpus:
            tier, qual = 3, "Paper is in the local corpus but these values were not found in its text layer; downgraded to Tier 3."
        else:
            tier, qual = 3, "source document not in local corpus. Add `Vehicle Modeling_FINAL.pdf` from https://ntrs.nasa.gov/api/citations/20250002675/downloads/Vehicle%20Modeling_FINAL.pdf to raw_data and rerun ingestion."
        log("Saffire VI published events", f"Event {e['Event']} ({label}, {o2:g}% O2{'' if kpa is None else f', {kpa:g} kPa'}): {qual}")
        out = lib.clean(e.get("Reported outcome"))
        tests.append({
            "test_id": f"SVI-{int(e['Event'])}", "series": "Saffire VI", "material": label, "material_group": lib.material_group(label),
            "o2_pct_initial": o2, "o2_pct_final": None, "pressure_kpa": kpa, "flow_start_cm_s": None, "flow_end_cm_s": None,
            "flow_basis": "not in the event table", "raw_air_display": None, "width_cm": lib.to_float(e.get("Width (cm)")),
            "length_cm": lib.to_float(e.get("Length (cm)")), "thickness_cm": lib.to_float(e.get("Thickness (cm)")),
            "gravity_label": "microgravity (Cygnus)", "outcome_class": lib.slug_class(out), "outcome_text": out, "what_happened": None,
            "published_comment": None, "report_observation": None, "spread_rate_mm_s": None, "source_id": paper_id, "reviewed_in": "apex-research-cards",
            "pdf_page": found_page, "printed_page": found_page, "conditions_pdf_page": found_page,
            "review_note": "Published flight-event summary, not a raw dataset. Large sample in a Cygnus vehicle at reduced pressure: compare sample size and pressure as well as oxygen." + ("" if kpa is not None else " Pressure for this event is not given in the event table and stays unknown."),
            "data_qualification": qual, "reused": None, "listed_quenched": False, "anomaly_flags": [], "conflict": False, "conflicts": [],
            "evidence_role": "published-event", "tier": tier,
        })

    # ---- outcome mapping table (classes come from the data)
    phrases = sorted({t["outcome_text"] for t in tests})
    mapping = []
    for ph in phrases:
        fam = visuals["phrases"].get(ph)
        if fam is None:
            fam = "unknown"
            log("Outcome mapping", f"Phrase `{ph}` has no entry in outcome_visuals.json; drawn as 'unknown'.")
        mapping.append({"outcome_text": ph, "outcome_class": lib.slug_class(ph), "family": fam, "n_tests": sum(1 for t in tests if t["outcome_text"] == ph)})
    log("Outcome mapping", f"{len(phrases)} distinct recorded outcome phrases found; each keeps its own class (see outcome_map.json).")
    for n in header_notes:
        if "unknown" in n.lower():
            log("Review notes carried into the UI", f"Verified-outcomes sheet header: “{n}”")
    return tests, {"classes": mapping, "families": visuals["families"]}, t71_page


def report_observation(page_text: str, tid: str) -> str | None:
    """Verbatim 'Test observations' text for one test from the TM appendix page (best effort)."""
    if not page_text:
        return None
    flat = lib.clean(page_text)
    m = re.search(rf"(?<![\w-]){re.escape(tid)}\s+\d{{2,3}}[mM]?\s", flat)
    if not m:
        return None
    rest = flat[m.end():]
    nxt = re.search(r"\s\d{1,2}/\d{1,2}/\d{2,4}\s", rest)
    row = rest[: nxt.start()] if nxt else rest[:900]
    row = re.split(r"\sa(?:Greenwich|Solid)|\sbSolid", row)[0]
    # observation = the trailing prose after the last run of numeric gas readings
    tail = None
    for mm in re.finditer(r"(?:[–-]?\d+(?:\.\d+)?|-{2,})\s+(?:[–-]?\d+(?:\.\d+)?|-{2,})\s+(?=[A-Z][a-z])", row):
        tail = row[mm.end():]
    return lib.clean(tail)[:400] if tail and len(tail) > 8 else None


# ===================================================================== ranges
def build_ranges(tests: list[dict]) -> dict:
    def stats(rows):
        def mm(key):
            vals = [r[key] for r in rows if r.get(key) is not None]
            return {"min": min(vals), "max": max(vals), "n": len(vals)} if vals else None

        ends = [r["flow_end_cm_s"] if r["flow_end_cm_s"] is not None else r["flow_start_cm_s"] for r in rows if r["flow_start_cm_s"] is not None]
        allf = [x for r in rows for x in (r["flow_start_cm_s"], r["flow_end_cm_s"]) if x is not None]
        return {
            "n_tests": len(rows), "o2_pct_initial": mm("o2_pct_initial"), "flow_start_cm_s": mm("flow_start_cm_s"), "flow_end_cm_s": mm("flow_end_cm_s"),
            "flow_any_cm_s": {"min": min(allf), "max": max(allf), "n": len(allf)} if allf else None, "pressure_kpa": mm("pressure_kpa"),
            "n_flow_changed": sum(1 for r in rows if r["flow_start_cm_s"] is not None and r["flow_end_cm_s"] is not None and r["flow_start_cm_s"] != r["flow_end_cm_s"]),
            "flow_basis": sorted({r["flow_basis"] for r in rows}), "outcomes": dict(Counter(r["outcome_text"] for r in rows).most_common()),
            "n_listed_quenched": sum(1 for r in rows if r["listed_quenched"]), "n_anomaly_flagged": sum(1 for r in rows if r["anomaly_flags"]),
            "n_conflict": sum(1 for r in rows if r["conflict"]), "evidence_roles": dict(Counter(r["evidence_role"] for r in rows)),
            "gravity_labels": sorted({r["gravity_label"] for r in rows}), "test_ids": [r["test_id"] for r in rows],
        }

    by_m, by_ms = defaultdict(list), defaultdict(list)
    for t in tests:
        by_m[t["material_group"]].append(t)
        by_ms[(t["material_group"], t["series"])].append(t)
    order = sorted(by_m, key=lambda m: (-sum(1 for t in by_m[m] if t["evidence_role"] != "context"), -len(by_m[m]), m))
    return {
        "generated_from": "data/processed/tests.json",
        "all": stats(tests),
        "materials": [{"material_group": m, "labels": sorted({t["material"] for t in by_m[m]}), **stats(by_m[m]),
                       "series": [{"series": s, **stats(rows)} for (mm_, s), rows in sorted(by_ms.items()) if mm_ == m]} for m in order],
        "series": sorted({t["series"] for t in tests}),
        "gravity_labels": sorted({t["gravity_label"] for t in tests}),
        "n_spread_rates_published": sum(1 for t in tests if t["spread_rate_mm_s"] is not None),
    }


# ====================================================================== cards
def build_cards(raw: Path, sources: list[dict], registry: dict) -> tuple[list[dict], list[dict]]:
    import openpyxl

    wb = openpyxl.load_workbook(raw / "NASA_Fire_Research_Cards.xlsx", data_only=True)
    rows = list(wb["Cards"].iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and lib.clean(r[0]) == "Study")
    head = [lib.clean(h) for h in rows[hi]]
    cards = {lib.clean(r[0]): {"study": lib.clean(r[0]), "aim": lib.clean(r[1]), "location": lib.clean(r[2]), "data_available": lib.clean(r[3]), "important_limit": lib.clean(r[4]),
                               "fields": [], "dois": [], "source_links": [], "limits": []} for r in rows[hi + 1 :] if r and r[0]}
    rrows = list(wb["Research"].iter_rows(values_only=True))
    rhi = next(i for i, r in enumerate(rrows) if r and lib.clean(r[0]) == "Study")
    web_sources: dict[str, dict] = {}
    for r in rrows[rhi + 1 :]:
        if not r or not r[0] or lib.clean(r[0]) not in cards:
            continue
        c = cards[lib.clean(r[0])]
        field, note = lib.clean(r[1]), lib.clean(r[2])
        ids = [x for x in str(r[5] or "").split("\n") if x.strip()]
        urls = [x for x in str(r[6] or "").split("\n") if x.strip()]
        for sid, url in zip(ids, urls):
            link = {"source_ref": sid.strip(), "url": url.strip()}
            if link not in c["source_links"]:
                c["source_links"].append(link)
            web_sources.setdefault(sid.strip(), {"url": url.strip()})
        m = re.fullmatch(r"10\.\d{4,9}/\S+", note)
        if field.endswith("DOI"):
            if m:  # print a DOI only when the file actually contains one
                c["dois"].append({"label": field, "doi": note})
            else:
                c["fields"].append({"field": field, "note": note})
        elif field == "Limit or source issue":
            c["limits"].append(note)
        elif field == "Source locator":
            for sid in ids:
                web_sources.setdefault(sid.strip(), {}).setdefault("title", note)
        else:
            c["fields"].append({"field": field, "note": note, "value": lib.to_float(r[3]), "unit": lib.clean(r[4]) or None})
    out = []
    for c in cards.values():
        mats = next((f["note"] for f in c["fields"] if f["field"] == "Materials"), "")
        kind = "solid fabric / plastic" if re.search(r"fabric|SIBAL|Nomex|PMMA", mats) else ("liquid droplet" if "droplet" in (c["aim"] + mats).lower() else ("smoke / aerosol" if "smoke" in (c["aim"] + mats).lower() else "gas flame"))
        c["evidence_kind"] = kind
        c["is_fabric_study"] = kind == "solid fabric / plastic"
        out.append(c)
    # sources that exist only as web references in the cards workbook
    local_urls = {s["url"] for s in sources}
    extra = []
    for sid, info in sorted(web_sources.items()):
        url = info.get("url")
        if not url or url in local_urls:
            continue
        reg = registry["web_only"].get(sid, {})
        extra.append({"id": "web-" + re.sub(r"[^a-z0-9]+", "-", sid.lower()).strip("-"), "title": reg.get("title") or info.get("title") or sid, "publisher": "NASA" if "nasa.gov" in url else "primary source",
                      "year": None, "document_type": "web page", "url": url, "pdf_url": None, "doi": None, "local_filename": None, "content_hash": None, "tier": 3,
                      "notes": "Referenced by the research cards. Source document not in local corpus, so nothing from it is quoted as verified.", "indexed": False})
    for c in out:
        for d in c["dois"]:
            ref = d["label"].replace(" DOI", "")
            for e in extra:
                if e["id"] == "web-" + ref.lower():
                    e["doi"] = d["doi"]
    return out, extra


# ===================================================================== audit
def write_audit(path: Path, ranges: dict, tests: list[dict], outcome_map: dict) -> None:
    L = ["# Data audit", "", "Generated by `scripts/ingest/ingest.py` from `raw_data/`. Do not edit by hand.", "",
         f"- Structured test rows: **{ranges['all']['n_tests']}**", f"- Series: {', '.join(ranges['series'])}", f"- Gravity labels present: {', '.join(ranges['gravity_labels'])} (no partial-gravity rows, no 1 g rows)",
         f"- Rows with a published spread rate: **{ranges['n_spread_rates_published']}**", f"- Anomaly-flagged rows: {ranges['all']['n_anomaly_flagged']}; conflict rows: {ranges['all']['n_conflict']}", ""]

    def rng(r, unit=""):
        return "not recorded" if not r else (f"{r['min']:g}{unit}" if r["min"] == r["max"] else f"{r['min']:g} to {r['max']:g}{unit}") + f" (n={r['n']})"

    for m in ranges["materials"]:
        L += [f"## {m['material_group']}", "", f"Raw labels: {'; '.join(m['labels'])}", ""]
        L += ["| Series | Tests | Initial O2 (%) | Start flow (cm/s) | Final flow (cm/s) | Flow changed | Pressure (kPa) | Flow basis |", "|---|---|---|---|---|---|---|---|"]
        for s in m["series"]:
            L.append(f"| {s['series']} | {s['n_tests']} | {rng(s['o2_pct_initial'])} | {rng(s['flow_start_cm_s'])} | {rng(s['flow_end_cm_s'])} | {s['n_flow_changed']} | {rng(s['pressure_kpa'])} | {'; '.join(s['flow_basis'])} |")
        L += ["", "Recorded outcome phrases:", ""] + [f"- {k}: {v}" for k, v in m["outcomes"].items()] + [""]
    L += ["## Outcome classes (derived from the data)", "", "| Recorded phrase | outcome_class | Tests | Marker family |", "|---|---|---|---|"]
    L += [f"| {c['outcome_text']} | `{c['outcome_class']}` | {c['n_tests']} | {c['family']} |" for c in outcome_map["classes"]]
    L += ["", "## Anomaly-flagged rows", ""] + [f"- {t['test_id']} ({t['material_group']}): {'; '.join(t['anomaly_flags'])}" for t in tests if t["anomaly_flags"]]
    L += ["", "## Conflict rows", ""] + ([f"- {t['test_id']}: {json.dumps(t['conflicts'])}" for t in tests if t["conflict"]] or ["- none"])
    path.write_text("\n".join(L) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="raw_data")
    ap.add_argument("--out", default="data/processed")
    ap.add_argument("--docs", default="docs")
    ap.add_argument("--cache", default=None, help="optional folder to cache per-file text extraction (speeds up reruns)")
    a = ap.parse_args()
    raw, out, docs = Path(a.raw), Path(a.out), Path(a.docs)
    global CACHE_DIR
    if a.cache:
        CACHE_DIR = Path(a.cache)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not raw.is_dir():
        sys.exit(f"raw data folder not found: {raw}. Ingestion needs the original files; the committed data/processed files still run the app.")
    out.mkdir(parents=True, exist_ok=True)
    docs.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((HERE / "config.json").read_text())
    registry = json.loads((HERE / "source_registry.json").read_text())
    visuals = json.loads((HERE / "outcome_visuals.json").read_text())
    web = json.loads((HERE / "web_context.json").read_text())

    sources, pages = build_sources(raw, registry, cfg)
    tests, outcome_map, t71_page = build_tests(raw, sources, pages, cfg, visuals)
    ranges = build_ranges(tests)
    cards, extra_sources = build_cards(raw, sources, registry)
    chunks = build_chunks(sources, pages, cfg)

    # dated web snapshots: searchable, but always labelled with their tier and read date
    for e in web["entries"]:
        sources.append({"id": e["id"], "title": e["title"], "publisher": e["publisher"], "year": int(e["read_on"][:4]), "document_type": "web page (snapshot)", "url": e["url"], "pdf_url": None, "doi": None,
                        "local_filename": None, "content_hash": None, "tier": e["tier"], "notes": f"Not in raw_data. Quote read on the live page on {e['read_on']}. {e['note']}", "indexed": True, "snapshot_read_on": e["read_on"]})
        for i, q in enumerate(e["quotes"], 1):
            chunks.append({"id": f"{e['id']}#{i}", "source_id": e["id"], "pdf_page": None, "slide": None, "sheet": None, "printed_page": None, "section": e["title"], "extraction": "web snapshot", "tier": e["tier"], "text": q, "snapshot_read_on": e["read_on"]})
    sources += extra_sources

    def dump(name, obj):
        (out / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")

    dump("sources.json", sources)
    dump("chunks.json", chunks)
    dump("tests.json", tests)
    dump("cards.json", cards)
    dump("ranges.json", ranges)
    dump("outcome_map.json", outcome_map)
    dump("web_context.json", web["entries"])
    dump("rating_config.json", cfg["rating"])
    write_audit(docs / "DATA_AUDIT.md", ranges, tests, outcome_map)

    n_local = sum(1 for s in sources if s["local_filename"])
    L = ["# Extraction report", "", "Generated by `scripts/ingest/ingest.py`. Do not edit by hand.", "",
         f"- Local source files ingested: {n_local}", f"- Web-only references (not in local corpus): {len(sources) - n_local}", f"- Text chunks: {len(chunks)} ({sum(1 for c in chunks if c['extraction']=='ocr')} from OCR)",
         f"- Structured tests: {len(tests)}; research cards: {len(cards)}", ""]
    order = ["Skipped files", "Duplicates dropped (same SHA-256)", "Pages where extraction returned almost nothing", "OCR fallback used", "Cross-checks", "Excel date corruption repaired (working sheet)",
             "Working-sheet 'verified tests' tab vs verified-outcomes file", "Conflicts (both values stored on the row)", "Anomalies flagged (never plotted)", "Saffire VI published events", "Outcome mapping", "Review notes carried into the UI"]
    for sec in order + [s for s in REPORT if s not in order]:
        L += [f"## {sec}", ""] + ([f"- {m}" for m in REPORT.get(sec, [])] or ["- none"]) + [""]
    L += ["## Per-source extraction", "", "| Source id | File | Pages | Methods | Chunks |", "|---|---|---|---|---|"]
    cc = Counter(c["source_id"] for c in chunks)
    for s in sources:
        if s["local_filename"]:
            L.append(f"| {s['id']} | {s['local_filename']} | {s.get('page_count','')} | {json.dumps(s.get('extraction_methods','')) if s.get('extraction_methods') else ''} | {cc.get(s['id'],0)} |")
    (out / "extraction_report.md").write_text("\n".join(L) + "\n")
    print(f"sources={len(sources)} chunks={len(chunks)} tests={len(tests)} cards={len(cards)}  Table 7.1 on PDF p.{t71_page}")
    print(json.dumps({m["material_group"]: {"n": m["n_tests"], "o2": m["o2_pct_initial"]} for m in ranges["materials"]}, indent=1))


if __name__ == "__main__":
    main()
