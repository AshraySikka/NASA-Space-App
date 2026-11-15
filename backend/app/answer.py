"""Question -> grounded answer. Layered retrieval, deterministic composition, verification.

Layer 1  local structured tests + BM25 over local chunks (always first, works offline)
Layer 2  Gemini with Google Search grounding, allowlisted hosts only
Layer 3  Claude with its web search tool restricted to the same hosts
Layer 4  honest empty: exactly NOT_FOUND
"""
from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Awaitable, Callable

from . import clarify, config, llm, web
from .conditions import merge, parse
from .rating import GRAVITY_TEXT, rate
from .retrieval import best_quote, get_index, quote_coverage, tokens
from .store import Store, get_store
from .verifier import numbers, row_numbers, verify_claims

NOT_FOUND = "Not found in NASA sources I can verify"
REDIRECT = "This tool shows what NASA tested and what was observed. It does not certify a material as safe and it does not recommend one. Here is the evidence."
QUOTE_COVERAGE_OK = 0.45
Emit = Callable[[str, dict], Awaitable[None]]


def fmt(x) -> str:
    return "not recorded" if x is None else f"{x:g}"


def rng(r: dict | None) -> str:
    return "not recorded" if not r else (fmt(r["min"]) if r["min"] == r["max"] else f"{fmt(r['min'])} to {fmt(r['max'])}")


class Passages:
    """The numbered passage set (S1, S2, ...) for one request. Nothing outside it can be cited."""

    def __init__(self, store: Store):
        self.store = store
        self.items: dict[str, dict] = {}
        self._key: dict[str, str] = {}

    def _add(self, key: str, p: dict) -> str:
        if key in self._key:
            return self._key[key]
        pid = f"S{len(self.items) + 1}"
        p["id"] = pid
        self.items[pid] = p
        self._key[key] = pid
        return pid

    def _src(self, sid: str) -> dict:
        s = self.store.source_by_id.get(sid, {})
        return {"source_id": sid, "title": s.get("title", sid), "publisher": s.get("publisher"), "year": s.get("year"), "url": s.get("url"), "pdf_url": s.get("pdf_url"),
                "doi": s.get("doi"), "local_file": bool(s.get("local_filename", "") and str(s.get("local_filename", "")).lower().endswith(".pdf")), "notes": s.get("notes")}

    def add_test(self, t: dict) -> str:
        flow = "not published" if t["flow_start_cm_s"] is None else (fmt(t["flow_start_cm_s"]) if t["flow_end_cm_s"] in (None, t["flow_start_cm_s"]) else f"{fmt(t['flow_start_cm_s'])} to {fmt(t['flow_end_cm_s'])}")
        parts = [f"Test {t['test_id']}", f"series: {t['series']}", f"material: {t['material']}", f"initial O2 %: {fmt(t['o2_pct_initial'])}", f"airflow cm/s ({t['flow_basis']}): {flow}",
                 f"pressure kPa: {fmt(t['pressure_kpa'])}", f"gravity: {t['gravity_label']}", f"recorded outcome: {t['outcome_text']}"]
        for label, key in (("what happened", "what_happened"), ("report table comment", "published_comment"), ("report observation", "report_observation"), ("review note", "review_note"), ("data qualification", "data_qualification")):
            if t.get(key):
                parts.append(f"{label}: {t[key]}")
        p = {**self._src(t["source_id"]), "kind": "test", "tier": t["tier"], "pdf_page": t.get("pdf_page"), "printed_page": t.get("printed_page"), "text": "\n".join(parts), "row": t, "test_id": t["test_id"],
             "via": "Team Apex page-referenced review sheet" if t.get("reviewed_in") else "PSI-25 table row"}
        return self._add("test:" + t["test_id"], p)

    def add_chunk(self, c: dict) -> str:
        p = {**self._src(c["source_id"]), "kind": "web" if c.get("snapshot_read_on") else "chunk", "tier": c["tier"], "pdf_page": c.get("pdf_page"), "printed_page": c.get("printed_page"), "text": c["text"],
             "section": c.get("section"), "extraction": c.get("extraction"), "snapshot_read_on": c.get("snapshot_read_on"), "chunk_id": c["id"]}
        return self._add("chunk:" + c["id"], p)

    def add_ranges(self, material: dict) -> str:
        lines = []
        for s in material["series"]:
            head = f"{material['material_group']} | {s['series']}"
            lines.append(f"{head} | tests: {s['n_tests']} | initial O2 %: {rng(s['o2_pct_initial'])} | pressure kPa: {rng(s['pressure_kpa'])}")
            lines.append(f"{head} | start airflow cm/s: {rng(s['flow_start_cm_s'])} | final airflow cm/s: {rng(s['flow_end_cm_s'])} | tests where airflow changed: {s['n_flow_changed']}")
            lines.append(f"{head} | gravity: {', '.join(s['gravity_labels'])} | airflow basis: {'; '.join(s['flow_basis'])}")
            for phrase, n in s["outcomes"].items():
                lines.append(f"{head} | recorded outcome: {phrase} | tests: {n}")
        p = {"source_id": "computed-ranges", "title": "Tested ranges computed from the structured test table (tests.json)", "publisher": "Computed by this tool from page-referenced rows", "year": None, "url": None, "pdf_url": None,
             "doi": None, "local_file": False, "notes": "Counts and ranges are calculated by code from tests.json; open the Evidence tab for the rows behind them.", "kind": "computed", "tier": 1, "pdf_page": None, "printed_page": None, "text": "\n".join(lines)}
        return self._add("ranges:" + material["material_group"], p)

    def add_corpus_facts(self) -> str:
        r = self.store.ranges
        lines = [f"All structured tests | tests: {r['all']['n_tests']} | gravity labels: {', '.join(r['gravity_labels'])}",
                 f"All structured tests | rows with a published flame spread rate: {r['n_spread_rates_published']}",
                 f"All structured tests | series: {', '.join(r['series'])}"]
        p = {"source_id": "computed-ranges", "title": "Corpus facts computed from the structured test table (tests.json)", "publisher": "Computed by this tool", "year": None, "url": None, "pdf_url": None, "doi": None, "local_file": False,
             "notes": None, "kind": "computed", "tier": 1, "pdf_page": None, "printed_page": None, "text": "\n".join(lines)}
        return self._add("corpus", p)

    def add_card(self, card: dict) -> str:
        lines = [f"{card['study']} | aim: {card['aim']}", f"{card['study']} | where: {card['location']}", f"{card['study']} | data available: {card['data_available']}", f"{card['study']} | important limit: {card['important_limit']}"]
        lines += [f"{card['study']} | {f['field']}: {f['note']}" for f in card["fields"]] + [f"{card['study']} | limit: {x}" for x in card["limits"]]
        url = card["source_links"][0]["url"] if card["source_links"] else None
        p = {**self._src("apex-research-cards"), "kind": "chunk", "tier": 1, "pdf_page": None, "printed_page": None, "text": "\n".join(lines), "url": url, "via": f"Team Apex research card for {card['study']}; the card links each NASA source"}
        return self._add("card:" + card["study"], p)

    def add_web(self, url: str, title: str, text: str, tier: int) -> str:
        p = {"source_id": "live:" + url, "title": title or url, "publisher": re.sub(r"^www\.", "", url.split("/")[2]), "year": None, "url": url, "pdf_url": None, "doi": None, "local_file": False, "notes": "Found by live search and fetched by the backend.",
             "kind": "web", "tier": tier, "pdf_page": None, "printed_page": None, "text": text}
        return self._add(f"web:{url}:{hash(text)}", p)

    def link_siblings(self) -> None:
        by_src: dict[str, list[str]] = {}
        for pid, p in self.items.items():
            if p["kind"] == "chunk":
                by_src.setdefault(p["source_id"], []).append(pid)
        for pid, p in self.items.items():
            p["siblings"] = [x for x in by_src.get(p["source_id"], []) if x != pid] if p["kind"] == "chunk" else []


# ------------------------------------------------------------ claim builders
def line_quote(text: str, needle: str) -> str:
    for line in text.splitlines():
        if needle in line:
            return " ".join(line.split()[:25])
    return ""


def test_claim(pid: str, t: dict) -> dict:
    flow = "airflow not published" if t["flow_start_cm_s"] is None else (f"airflow {fmt(t['flow_start_cm_s'])} cm/s" if t["flow_end_cm_s"] in (None, t["flow_start_cm_s"]) else f"airflow changed from {fmt(t['flow_start_cm_s'])} to {fmt(t['flow_end_cm_s'])} cm/s")
    pres = f", {fmt(t['pressure_kpa'])} kPa" if t["pressure_kpa"] is not None else ""
    # prefer NASA's own words (appendix observation, then the Table 7.1 comment) over the review sheet's wording
    nasa = next((q for q in (t.get("report_observation"), t.get("published_comment")) if q and len(q.split()) <= 25), None)
    quote = nasa or next((q for q in (t.get("what_happened"), t.get("outcome_text")) if q and len(q.split()) <= 25), t["outcome_text"])
    # the Table 7.1 comment sits on the table's page, not on the appendix page of the row
    page = t.get("conditions_pdf_page") if nasa and nasa == t.get("published_comment") and nasa != t.get("report_observation") else None
    return {"review_wording": nasa is None and bool(t.get("reviewed_in")), "page_override": page, "text": f"{t['test_id']} ({t['material']}, {t['series']}): initial O2 {fmt(t['o2_pct_initial'])}%{pres}, {flow}. Recorded outcome: {t['outcome_text']}.", "source_ids": [pid], "quote": quote, "tier": t["tier"], "test_id": t["test_id"]}


def range_claims(pid: str, text: str, material: dict) -> list[dict]:
    out = []
    for s in material["series"]:
        head = f"{material['material_group']} | {s['series']}"
        q = line_quote(text, f"{head} | tests:")
        out.append({"text": f"{material['material_group']} in {s['series']}: {s['n_tests']} structured test(s), initial O2 {rng(s['o2_pct_initial'])}%" + (f", pressure {rng(s['pressure_kpa'])} kPa" if s["pressure_kpa"] else "") + ".", "source_ids": [pid], "quote": q, "tier": 1})
        if s["flow_start_cm_s"]:
            out.append({"text": f"{material['material_group']} in {s['series']}: start airflow {rng(s['flow_start_cm_s'])} cm/s, final airflow {rng(s['flow_end_cm_s'])} cm/s; airflow changed during {s['n_flow_changed']} test(s).", "source_ids": [pid],
                        "quote": line_quote(text, f"{head} | start airflow"), "tier": 1})
    return out


def chunk_claim(pid: str, p: dict, question: str) -> dict | None:
    """Extractive claim: the claim text IS the quote. Nothing is paraphrased without a model."""
    if p.get("extraction") in ("openpyxl", "csv"):
        return None  # table rows are served through the structured table, not as prose quotes
    q = best_quote(p["text"], question)
    if not q:
        return None
    return {"text": q, "source_ids": [pid], "quote": q, "tier": p["tier"], "extractive": True}


def outcome_claims(pid: str, text: str, material: dict) -> list[dict]:
    out = []
    for s in material["series"]:
        head = f"{material['material_group']} | {s['series']}"
        for phrase, n in list(s["outcomes"].items())[:4]:
            out.append({"text": f"{material['material_group']} in {s['series']}: “{phrase}” was recorded for {n} test(s).", "source_ids": [pid], "quote": line_quote(text, f"{head} | recorded outcome: {phrase} |"), "tier": 1})
    return out


def design_sentence(rating: dict | None, store: Store) -> str | None:
    """'What this means for design', assembled by template from the rating and nearest outcomes."""
    if not rating:
        return None
    m = rating["material"]
    near = [store.test_by_id[n["test_id"]] for n in rating["nearest"][:3]]
    outs: dict[str, list[str]] = {}
    for t in near:
        outs.setdefault(t["outcome_text"], []).append(t["test_id"])
    seen = "; ".join(f"{k} ({', '.join(v)})" for k, v in outs.items())
    if rating["level"] == "GREEN":
        return f"For design: NASA ran {m} tests at essentially these conditions in microgravity. What was recorded: {seen}. That describes those small-sample tests only. It is not a clearance for a product or a habitat."
    if rating["level"] == "YELLOW":
        return f"For design: there is no {m} test at exactly these conditions. The closest tests recorded: {seen}. Treat them as neighbours, not as results for your case, and check the distances shown."
    if rating["code"] == "GRAVITY_NOT_TESTED":
        return f"For design: nothing in this corpus was measured at this gravity level. The nearest microgravity {m} tests recorded: {seen}. Use them as context only. This is a gap that needs a test."
    return f"For design: NASA data in this corpus does not cover {m} near these conditions. Nothing here supports a decision either way. This is a gap that needs a test."


# ----------------------------------------------------------------- pipeline
async def run(req: dict, emit: Emit) -> dict:
    store = get_store()
    index = get_index()
    question = (req.get("question") or "").strip()[:2000]
    history = [h for h in (req.get("history") or []) if isinstance(h, dict)][-6:]
    simulator = req.get("simulator") or None
    last = req.get("last_conditions") or None
    live_requested = bool(req.get("live"))
    searched: list[str] = []
    notices: list[str] = []
    engine = "local data"

    await emit("status", {"stage": "local", "text": "Searching local data"})
    parsed = parse(question, store.material_groups)
    llm_cond = None
    if config.LLM_ALWAYS and not parsed["has_conditions"] and len(question.split()) > 3 and (config.gemini_ready() or config.claude_ready()):
        llm_cond = await llm.extract_conditions(question, store.material_groups)
    cond = merge(parsed, question, last, simulator, llm_cond)
    ask_first = clarify.needed(question, parsed, cond, store)
    if ask_first:
        return {"found": False, "summary": ask_first["prompt"], "notice": None, "claims": [], "sources": [], "gaps": [], "rating": None, "design_note": None, "applied_conditions": None,
                "engine": "local data", "searched": [], "notices": [], "removed": [], "verifier": [], "clarify": ask_first}
    if cond.get("from_last"):
        names = {"material": "material", "o2_pct": "oxygen", "flow_cm_s": "airflow", "pressure_kpa": "pressure", "gravity": "gravity"}
        notices.append("Carried over from your previous question: " + ", ".join(f"{names[k]} {cond[k]}" for k in cond["from_last"]) + ". Name them in the question to change them.")
    if cond.get("from_simulator"):
        notices.append("Taken from the simulator's current settings: " + ", ".join(cond["from_simulator"]) + ".")
    materials = parsed["materials"] or ([cond["material"]] if cond["material"] else [])
    mat_ranges = {m["material_group"]: m for m in store.ranges["materials"]}

    P = Passages(store)
    claims: list[dict] = []
    gaps: list[str] = []
    rating = None
    gravity = cond["gravity"]
    partial = gravity in ("moon", "mars", "partial")

    # ---- (b) structured table + rating, computed in code
    wants_rating = cond["material"] and (cond["o2_pct"] is not None or cond["flow_cm_s"] is not None or gravity is not None)
    if wants_rating:
        rating = rate({**cond, "gravity": gravity or "0g"}, store.tests, store.rating_config)
        searched.append(f"structured test table: {rating['n_material_tests']} {cond['material']} rows")
        for n in rating["nearest"][:3]:
            t = store.test_by_id[n["test_id"]]
            claims.append(test_claim(P.add_test(t), t))
    elif parsed["intent"] == "closest" and cond["o2_pct"] is not None:
        pool = [t for t in store.tests if t["o2_pct_initial"] is not None and (not materials or t["material_group"] in materials) and (materials or t["evidence_role"] != "context")]
        pool.sort(key=lambda t: abs(t["o2_pct_initial"] - cond["o2_pct"]))
        searched.append(f"structured test table: {len(pool)} rows ranked by distance in oxygen")
        for t in pool[:4]:
            claims.append(test_claim(P.add_test(t), t))

    # ---- computed ranges for gap / compare / material-only questions
    if parsed["intent"] in ("gap", "compare") or (materials and not wants_rating):
        targets = materials or [m["material_group"] for m in store.ranges["materials"] if m["evidence_roles"].get("verified") or m["evidence_roles"].get("published-event")]
        for m in targets:
            if m in mat_ranges:
                pid = P.add_ranges(mat_ranges[m])
                claims += range_claims(pid, P.items[pid]["text"], mat_ranges[m])
                if parsed["intent"] == "compare" or (materials and parsed["intent"] != "gap"):
                    claims += outcome_claims(pid, P.items[pid]["text"], mat_ranges[m])
        searched.append("tested ranges computed from the structured test table")
    if parsed["intent"] == "gap" or partial or gravity == "1g":
        pid = P.add_corpus_facts()
        r = store.ranges
        claims.append({"text": f"All {r['all']['n_tests']} structured tests in this corpus were run in microgravity.", "source_ids": [pid], "quote": line_quote(P.items[pid]["text"], "gravity labels"), "tier": 1})
        if parsed["intent"] == "gap":
            claims.append({"text": f"Rows with a published flame spread rate in the structured table: {r['n_spread_rates_published']}.", "source_ids": [pid], "quote": line_quote(P.items[pid]["text"], "spread rate"), "tier": 1})

    # ---- research cards: questions that name an investigation
    named = sorted((c for c in store.cards if re.search(rf"(?<![\w-]){re.escape(c['study'])}(?![\w-])", question, re.I)), key=lambda c: -len(c["study"]))
    if named and not wants_rating:
        card = named[0]
        pid = P.add_card(card)
        notes = [next((f["note"] for f in card["fields"] if f["field"] == k), None) for k in ("What it does", "Materials", "Published finding")] + [card["data_available"], card["important_limit"]] + card["limits"][:2]
        for note in [n for n in notes if n]:
            q = " ".join(note.split()[:25])
            claims.append({"text": q, "source_ids": [pid], "quote": q, "tier": 1, "extractive": True})
        searched.append(f"research card: {card['study']}")
        cond["_card"] = f"From the team's research card for {card['study']}, which links each NASA source. The statements below are quoted from the card word for word."
        if not card["is_fabric_study"]:
            gaps.append(f"{card['study']} is a {card['evidence_kind']} study. It is not direct evidence about fabric.")

    # ---- Truth rule C: partial gravity has no data; show dated context, never a curve
    if partial:
        for c in store.chunks:
            if c.get("snapshot_read_on"):
                pid = P.add_chunk(c)
                src = store.source_by_id[c["source_id"]]
                claims.append({"text": c["text"], "source_ids": [pid], "quote": " ".join(c["text"].split()[:25]), "tier": c["tier"], "extractive": True})
        searched.append("dated web context for partial gravity (NASA FM2, JAXA FLARE)")

    # ---- (c) BM25 over local chunks
    q_for_search = question
    if parsed["refers_back"] and history:
        prev = next((h.get("content", "") for h in reversed(history) if h.get("role") == "user"), "")
        q_for_search = f"{question} {prev}"[:600]
    quote_query = question
    if partial or gravity == "1g":
        # gravity questions: look for what the documents say about gravity, not for the word "burn"
        q_for_search = quote_query = "materials flammable lower oxygen microgravity partial gravity than normal gravity Earth"
    res = index.search(q_for_search, k=6, max_tier=1)
    searched.append(f"BM25 over {len(index.chunks)} local passages")
    structured = bool(claims)
    n_chunk_claims = 0
    for h in res["hits"]:
        pid = P.add_chunk(h["chunk"])
        cl = chunk_claim(pid, P.items[pid], quote_query)
        # a passage is only quoted if one sentence of it really is about the question
        if cl and quote_coverage(cl["quote"], quote_query, index) >= QUOTE_COVERAGE_OK and n_chunk_claims < (2 if structured else 4) and parsed["intent"] not in ("closest",):
            claims.append(cl)
            n_chunk_claims += 1
    topical = n_chunk_claims > 0

    local_sufficient = structured or topical

    # ---- Layers 2 and 3: live search on allowlisted hosts
    if (not local_sufficient or live_requested):
        domains = config.allowed_domains()
        found: list[dict] = []
        if config.gemini_ready():
            await emit("status", {"stage": "gemini", "text": "Searching NASA sources"})
            try:
                raw = await llm.gemini_search_urls(question, domains)
                for r in raw[:8]:
                    u = await asyncio.to_thread(web.resolve_grounding_url, r["url"])
                    if u:
                        found.append({"url": u, "title": r["title"]})
                searched.append(f"Gemini live search: {len(raw)} cited page(s), {len(found)} on the allowlist")
                if found:
                    engine = "Gemini live search"
            except Exception as e:
                notices.append(f"Gemini live search failed ({type(e).__name__}).")
        if not found and config.claude_ready():
            await emit("status", {"stage": "claude", "text": "Searching NASA sources (fallback)"})
            try:
                raw = await llm.claude_search_urls(question, domains)
                found = [r for r in raw if web.host_allowed(r["url"], domains)][:6]
                searched.append(f"Claude web search (fallback): {len(raw)} result(s), {len(found)} on the allowlist")
                if found:
                    engine = "Claude fallback"
            except Exception as e:
                notices.append(f"Claude web search failed ({type(e).__name__}).")
        if not (config.gemini_ready() or config.claude_ready()):
            notices.append("Live NASA search is off: no API keys are configured. Answering from local data only.")
        seen_urls = set()
        for f in found:
            if f["url"] in seen_urls:
                continue
            seen_urls.add(f["url"])
            text = await asyncio.to_thread(web.fetch_text, f["url"])
            if not text:
                continue
            # choose the most relevant windows of the fetched page as passages
            words = text.split()
            wins = [" ".join(words[i : i + 220]) for i in range(0, max(1, len(words) - 60), 160)][:60]
            qt = set(tokens(question))
            wins.sort(key=lambda w: -len(qt & set(tokens(w))))
            for w in wins[:2]:
                pid = P.add_web(f["url"], f["title"], w, web.tier_for(f["url"]))
                cl = chunk_claim(pid, P.items[pid], question)
                # same relevance gate as local passages: a live page is only quoted if a sentence of it is about the question
                if cl and quote_coverage(cl["quote"], question, index) >= QUOTE_COVERAGE_OK:
                    claims.append(cl)

    P.link_siblings()

    # ---- gaps (computed)
    if partial:
        gaps.append(f"No test in this corpus was run at {GRAVITY_TEXT[gravity]}. Flight data here is microgravity only.")
        gaps.append("NASA's FM2 lunar experiment is described as planned; this corpus holds no results from it.")
    if gravity == "1g":
        gaps.append("The structured test table has no 1 g rows. Normal-gravity comparisons exist only as statements in the documents.")
    if rating and rating["level"] != "GREEN":
        gaps.append(rating["reasons"][0])
    if store.ranges["n_spread_rates_published"] == 0 and re.search(r"spread rate|how fast|speed", question.lower()):
        gaps.append("No flame spread rate is recorded in the structured test table, so none is shown.")
    if any(c.get("test_id") and "ending unstated" in store.test_by_id[c["test_id"]]["outcome_text"].lower() for c in claims):
        gaps.append("For some of these tests the report does not say how the burn ended. A blank ending is unknown, not 'burned out' and not 'extinguished'.")

    applied = None
    if cond["material"] and wants_rating:
        applied = {"material": cond["material"], "o2_pct": cond["o2_pct"], "flow_cm_s": cond["flow_cm_s"], "pressure_kpa": cond["pressure_kpa"], "gravity": gravity or "0g"}

    if not claims:
        return empty(question, searched, notices, rating, store, engine, gaps)

    # ---- generation: LLM over passages only, or the deterministic template
    summary_det = deterministic_summary(parsed, cond, rating, claims, store, partial)
    gen_engine, llm_errors = None, []
    final_claims, summary = claims, summary_det
    if (config.gemini_ready() or config.claude_ready()) and (config.LLM_ALWAYS or live_requested or not local_sufficient):
        await emit("status", {"stage": "draft", "text": "Drafting from retrieved passages"})
        prompt = build_prompt(question, rating, P, history)
        ans, gen_engine, llm_errors = await llm.generate_answer(prompt)
        if ans:
            final_claims = [c.model_dump() for c in ans.claims]
            summary = ans.summary
            gaps = list(dict.fromkeys(gaps + [g for g in ans.gaps if g and not numbers(g)]))
        else:
            notices.append("The language model was unavailable or returned invalid output twice. This answer was assembled directly from the retrieved passages.")

    await emit("status", {"stage": "verify", "text": "Verifying citations"})
    fetcher = web.fetch_text
    v = await asyncio.to_thread(verify_claims, final_claims, P.items, config.allowed_domains(), fetcher)
    if gen_engine and not v["claims"]:
        # the model's claims all failed: fall back to the deterministic claims and verify those
        notices.append("Every model-written statement failed verification and was removed. Showing statements assembled directly from the passages instead.")
        removed_llm = v["removed"]
        v = await asyncio.to_thread(verify_claims, claims, P.items, config.allowed_domains(), fetcher)
        v["removed"] = removed_llm + v["removed"]
        summary, gen_engine = summary_det, None
    if not v["claims"]:
        out = empty(question, searched, notices, rating, store, engine, gaps)
        out["removed"] = v["removed"]
        out["verifier"] = v["decisions"]
        return out
    if gen_engine:
        # a model-written summary may not introduce numbers the verified evidence does not contain
        ok_nums = set()
        for c in v["claims"]:
            ok_nums |= set(numbers(c["quote"])) | set(numbers(c["text"]))
            for sid in c["source_ids"]:
                ok_nums |= row_numbers(P.items[sid].get("row"))
        if rating:
            ok_nums |= set(numbers(json.dumps(rating)))
        if [n for n in numbers(summary) if n not in ok_nums]:
            notices.append("The model's summary contained a number that the verified evidence does not, so the summary was replaced with the template version.")
            summary = summary_det
        engine = {"gemini": "Gemini", "claude": "Claude"}[gen_engine] + (" over local data" if engine == "local data" else f" + {engine}")
    if any(c.get("live_check", "") and "snapshot" in c["live_check"] for c in v["claims"]):
        notices.append("Web context shown as a dated snapshot: the backend could not re-fetch those pages just now.")
    if partial and not any(P.items[s]["kind"] == "web" for c in v["claims"] for s in c["source_ids"]):
        gaps.append("FM2 and JAXA FLARE context could not be verified right now, so it is not shown.")

    cited = []
    order: dict[str, int] = {}
    for c in v["claims"]:
        c["cite"] = []
        for sid in c["source_ids"]:
            if sid not in order:
                order[sid] = len(order) + 1
                p = P.items[sid]
                cited.append({"n": order[sid], "passage_id": sid, "source_id": p["source_id"], "title": p["title"], "publisher": p["publisher"], "year": p["year"], "tier": p["tier"], "kind": p["kind"], "pdf_page": p["pdf_page"],
                              "printed_page": p["printed_page"], "url": p["url"], "pdf_url": p.get("pdf_url"), "doi": p.get("doi"), "local_pdf": f"/sources/{p['source_id']}#page={p['pdf_page']}" if p.get("local_file") and p.get("pdf_page") and source_file_exists(store, p["source_id"]) else None,
                              "notes": p.get("notes"), "via": p.get("via"), "test_id": p.get("test_id"), "snapshot_read_on": p.get("snapshot_read_on"), "extraction": p.get("extraction"), "quotes": []})
            c["cite"].append(order[sid])
            src = cited[order[sid] - 1]
            if c["quote"] not in src["quotes"]:
                src["quotes"].append(c["quote"])
            if c.get("live_check"):
                src["live_check"] = c["live_check"]
            if c.get("review_wording"):
                src["review_wording"] = True
            if c.get("page_override") and c["page_override"] != src["pdf_page"]:
                off = store.source_by_id.get(src["source_id"], {}).get("printed_page_offset")
                src["pdf_page"] = c["page_override"]
                src["printed_page"] = c["page_override"] + off if off is not None else None
                if src["local_pdf"]:
                    src["local_pdf"] = f"/sources/{src['source_id']}#page={c['page_override']}"
    return {"found": True, "summary": summary, "notice": REDIRECT if parsed["wants_certification"] else None, "claims": [{k: c[k] for k in ("text", "quote", "tier", "cite") if k in c} | {"match": c.get("match"), "extractive": c.get("extractive", False)} for c in v["claims"]],
            "sources": cited, "gaps": gaps, "rating": rating, "design_note": design_sentence(rating, store), "applied_conditions": applied, "engine": engine, "searched": searched, "notices": notices + [e for e in llm_errors[:2]],
            "removed": v["removed"], "verifier": v["decisions"]}


def source_file_exists(store: Store, sid: str) -> bool:
    fn = store.source_by_id.get(sid, {}).get("local_filename")
    return bool(fn) and (config.RAW_DIR / fn).is_file()


def deterministic_summary(parsed: dict, cond: dict, rating: dict | None, claims: list[dict], store: Store, partial: bool) -> str:
    m = cond.get("material")
    if partial:
        g = GRAVITY_TEXT[cond["gravity"]]
        s = f"No direct measurement at {g} exists in this corpus. Every structured test here was run in microgravity, so the rating is “{rating['label']}”. " if rating else f"No direct measurement at {g} exists in this corpus. Every structured test here was run in microgravity. "
        s += (f"The nearest microgravity evidence for {m} is listed below, with what was recorded for each test. " if m else "")
        s += "NASA describes its FM2 experiment as a planned first combustion test on the Moon, and a JAXA leaflet says materials can be more flammable at reduced gravity; neither gives a measured result. No estimate is drawn between microgravity and Earth gravity."
        return s
    if rating:
        near = [store.test_by_id[n["test_id"]] for n in rating["nearest"][:3]]
        outs = "; ".join(f"{t['test_id']}: {t['outcome_text']}" for t in near)
        return f"{rating['label']}. {rating['reasons'][0]} Recorded outcomes of the closest tests: {outs}."
    if parsed["intent"] == "gap":
        return "Here is what the structured NASA test data in this corpus covers. Anything outside these ranges has not been tested in the data I hold: all rows are microgravity, and no row records a flame spread rate."
    if parsed["intent"] == "compare":
        return "Side by side, from the structured test table: the tested ranges and recorded outcomes for each material are listed below. They were not tested at the same conditions, so this is a comparison of coverage, not of performance."
    if parsed["intent"] == "closest":
        return "The tests closest to that oxygen level, with what was recorded for each, are listed below."
    if cond.get("_card"):
        return cond["_card"]
    if parsed["materials"]:
        return f"Here is what the corpus holds on {', '.join(parsed['materials'])}: tested ranges from the structured table, then the most relevant passages."
    return "The most relevant passages in the local NASA corpus are quoted below, word for word."


def build_prompt(question: str, rating: dict | None, P: Passages, history: list[dict]) -> str:
    parts = []
    prev = [h.get("content", "")[:300] for h in history if h.get("role") == "user"][-2:]
    if prev:
        parts.append("Earlier questions in this session (context only, not evidence): " + " | ".join(prev))
    parts.append(f"Question: {question}")
    if rating:
        slim = {k: rating[k] for k in ("level", "label", "code", "reasons", "nearest", "envelope", "tolerance")}
        parts.append("Evidence rating computed by code (do not change it): " + json.dumps(slim))
    parts.append("Passages:")
    for pid, p in P.items.items():
        where = f", PDF page {p['pdf_page']}" if p.get("pdf_page") else ""
        parts.append(f"[{pid}] (Tier {p['tier']}; {p['title']}{where})\n{p['text'][:1800]}")
    return "\n\n".join(parts)


def empty(question: str, searched: list[str], notices: list[str], rating: dict | None, store: Store, engine: str, gaps: list[str]) -> dict:
    g = gaps or ["Nothing in the local corpus or on the allowlisted NASA sites could be verified for this question."]
    return {"found": False, "summary": NOT_FOUND, "notice": None, "claims": [], "sources": [], "gaps": g, "rating": rating, "design_note": None, "applied_conditions": None, "engine": engine, "searched": searched,
            "notices": notices, "removed": [], "verifier": []}