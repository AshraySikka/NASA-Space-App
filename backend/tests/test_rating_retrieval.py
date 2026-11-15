"""Evidence rating (incl. flow-path logic), condition parsing, retrieval and the pipeline."""
import asyncio

from app import answer, config
from app.conditions import merge, parse
from app.rating import measure, rate
from app.retrieval import get_index
from app.store import get_store

S = get_store()
CFG = S.rating_config
SIBAL = S.ranges["materials"][0]


def r(**kw):
    base = {"material": "SIBAL", "o2_pct": None, "flow_cm_s": None, "pressure_kpa": None, "gravity": "0g"}
    return rate({**base, **kw}, S.tests, CFG)


def test_no_hardcoded_ranges_first_material_is_from_data():
    assert SIBAL["material_group"] == "SIBAL" and SIBAL["n_tests"] == sum(1 for t in S.tests if t["material_group"] == "SIBAL")


def test_flow_is_a_path_not_a_point():
    t = next(t for t in S.tests if t["flow_end_cm_s"] is not None and t["flow_start_cm_s"] is not None and abs(t["flow_start_cm_s"] - t["flow_end_cm_s"]) > 4)
    lo, hi = sorted((t["flow_start_cm_s"], t["flow_end_cm_s"]))
    mid = (lo + hi) / 2
    assert measure(t, t["o2_pct_initial"], mid, None, CFG)["d_flow"] == 0, "a point between start and final flow is on the path"
    assert measure(t, t["o2_pct_initial"], hi + 3, None, CFG)["d_flow"] == 3
    assert measure(t, t["o2_pct_initial"], max(0, lo - 1), None, CFG)["d_flow"] == min(1, lo)


def test_green_inside_tested_range():
    t = next(t for t in S.tests if t["evidence_role"] == "verified" and t["flow_start_cm_s"] is not None)
    out = r(o2_pct=t["o2_pct_initial"], flow_cm_s=t["flow_start_cm_s"])
    assert out["level"] == "GREEN" and t["test_id"] in out["matching_test_ids"]


def test_red_far_from_any_test_and_distance_reported():
    hi = SIBAL["series"][0]["o2_pct_initial"]["max"]
    out = r(o2_pct=hi + 5, flow_cm_s=5)
    assert out["level"] == "RED" and out["code"] == "NO_NEARBY_TEST" and out["nearest"][0]["d_o2"] > CFG["near_o2_points"]


def test_yellow_close_neighbour():
    t = next(t for t in S.tests if t["test_id"] == SIBAL["test_ids"][0])
    out = r(o2_pct=t["o2_pct_initial"] + CFG["match_o2_points"] + 0.6, flow_cm_s=t["flow_start_cm_s"])
    assert out["level"] == "YELLOW"


def test_gravity_not_tested_is_red_for_moon_mars_and_1g():
    for g in ("moon", "mars", "1g", "partial"):
        out = r(o2_pct=18.7, flow_cm_s=5, gravity=g)
        assert out["level"] == "RED" and out["code"] == "GRAVITY_NOT_TESTED" and out["nearest"], g


def test_pressure_is_part_of_the_rating():
    sv = next(t for t in S.tests if t["series"] == "Saffire VI" and t["pressure_kpa"] is not None and t["material_group"] == "SIBAL")
    near_p = r(o2_pct=sv["o2_pct_initial"], pressure_kpa=sv["pressure_kpa"])
    far_p = r(o2_pct=sv["o2_pct_initial"], pressure_kpa=sv["pressure_kpa"] + CFG["far_pressure_kpa"] + 20)
    assert near_p["level"] == "YELLOW", "flow is not published for the event, so it can never be green"
    assert far_p["level"] == "RED" and far_p["code"] == "PRESSURE_FAR"


def test_unpublished_flow_never_green():
    out = rate({"material": "Nomex", "o2_pct": 21.0, "flow_cm_s": 10, "pressure_kpa": None, "gravity": "0g"}, S.tests, CFG)
    assert out["level"] == "YELLOW" and out["code"] == "FLOW_NOT_PUBLISHED"


def test_uncalibrated_context_rows_never_green():
    t = next(t for t in S.tests if t["evidence_role"] == "context" and t["flow_start_cm_s"] is not None)
    out = rate({"material": t["material_group"], "o2_pct": t["o2_pct_initial"], "flow_cm_s": t["flow_start_cm_s"], "pressure_kpa": None, "gravity": "0g"}, S.tests, CFG)
    assert out["level"] != "GREEN"


def test_parser():
    p = parse("What happens to SIBAL at 30% oxygen at 5 cm/s on the Moon at 54.1 kPa?", S.material_groups)
    assert (p["materials"], p["o2_pct"], p["flow_cm_s"], p["gravity"], p["pressure_kpa"]) == (["SIBAL"], 30.0, 5.0, "moon", 54.1)
    assert parse("airflow of 0.2 m/s with nomex", S.material_groups)["flow_cm_s"] == 20.0
    assert parse("Is it safe?", S.material_groups)["wants_certification"]
    assert parse("Which should I use?", S.material_groups)["wants_certification"]
    assert parse("Compare Nomex and SIBAL", S.material_groups)["intent"] == "compare"
    assert parse("What has NASA not tested?", S.material_groups)["intent"] == "gap"
    assert parse("cotton-fiberglass fabric", S.material_groups)["materials"] == ["SIBAL"], "SIBAL is never reduced to 'cotton'"
    assert parse("pure cotton shirt", S.material_groups)["materials"] == []


def test_merge_uses_simulator_for_this_fabric():
    p = parse("Will this burn on the Moon?", S.material_groups)
    c = merge(p, "Will this burn on the Moon?", None, {"material": "SIBAL", "o2_pct": 18.7, "flow_cm_s": 5})
    assert c["material"] == "SIBAL" and c["gravity"] == "moon" and c["o2_pct"] == 18.7


def test_retrieval_bm25_offline():
    res = get_index().search("smoke detector microgravity aerosol", k=5)
    assert res["hits"] and any(h["chunk"]["source_id"].startswith("psi-10") for h in res["hits"])
    assert all("text" in h["chunk"] and "source_id" in h["chunk"] for h in res["hits"])


def ask(q, **kw):
    async def emit(e, d):
        pass

    return asyncio.run(answer.run({"question": q, **kw}, emit))


def test_no_keys_means_local_engine(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    out = ask("What happened to SIBAL at 18.7% oxygen and 5 cm/s?")
    assert out["found"] and out["engine"] == "local data" and out["rating"]["level"] == "GREEN"
    assert all(c["cite"] for c in out["claims"]), "no uncited claim"
    assert all(s["tier"] in (1, 2, 3) and s["quotes"] for s in out["sources"])
    assert out["applied_conditions"] == {"material": "SIBAL", "o2_pct": 18.7, "flow_cm_s": 5.0, "pressure_kpa": None, "gravity": "0g"}


def test_moon_question_truth_rule_c():
    out = ask("Will this burn on the Moon?", simulator={"material": "SIBAL", "o2_pct": 18.7, "flow_cm_s": 5})
    assert out["rating"]["level"] == "RED" and out["rating"]["code"] == "GRAVITY_NOT_TESTED"
    text = out["summary"] + " ".join(c["text"] for c in out["claims"])
    assert "FM2" in text and "JAXA" in out["summary"] and "mm/s" not in text
    assert any(s["tier"] == 2 for s in out["sources"]) and any(s["tier"] == 3 for s in out["sources"])
    assert any("lunar gravity" in g for g in out["gaps"])


def test_uncovered_topic_is_exactly_not_found():
    for q in ("What is the price of bitcoin today?", "who won the world cup", "how does the stock market work"):
        out = ask(q)
        assert out["summary"] == answer.NOT_FOUND == "Not found in NASA sources I can verify" and not out["claims"] and out["searched"]


def test_certification_questions_are_redirected():
    out = ask("Is Nomex safe at 21% oxygen and 10 cm/s?")
    assert out["notice"] and "does not certify" in out["notice"]
    assert "safe" not in out["summary"].lower()


def test_ending_unstated_is_never_upgraded():
    out = ask("What happened to SIBAL at 18.8% oxygen and 10 cm/s?")
    for c in out["claims"]:
        if "ending unstated" in c["text"]:
            assert "burned out" not in c["text"].lower() and "extinguished" not in c["text"].split("Recorded outcome:")[1].lower()
    assert any("unknown" in g for g in out["gaps"])


def test_llm_failure_falls_back_to_template(monkeypatch):
    monkeypatch.setattr("app.config.LLM_ALWAYS", True)
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.setenv("GEMINI_MODEL", "some-model")

    async def boom(*a, **k):
        raise TimeoutError("simulated outage")

    monkeypatch.setattr("app.llm.gemini_text", boom)
    out = ask("What happened to SIBAL at 18.7% oxygen and 5 cm/s?")
    assert out["found"] and out["claims"] and any("assembled directly" in n for n in out["notices"])


def test_llm_hallucination_is_removed(monkeypatch):
    monkeypatch.setattr("app.config.LLM_ALWAYS", True)
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.setenv("GEMINI_MODEL", "some-model")

    async def fake(system, user, json_mode=True):
        return '{"summary": "SIBAL spreads at 3.3 mm/s and is safe.", "claims": [{"text": "SIBAL spread at 3.3 mm/s.", "source_ids": ["S1"], "quote": "the flame spread at 3.3 mm/s", "tier": 1}, {"text": "T4 was quenched after the airflow was reduced.", "source_ids": ["S1"], "quote": "Quenched after reduced airflow", "tier": 1}], "gaps": [], "applied_conditions": null}'

    monkeypatch.setattr("app.llm.gemini_text", fake)
    out = ask("What happened to SIBAL at 18.7% oxygen and 5 cm/s?")
    assert [c["text"] for c in out["claims"]] == ["T4 was quenched after the airflow was reduced."]
    assert out["removed"] and "3.3" not in out["summary"], "unsupported number in the model summary forces the template summary"
    assert out["rating"]["level"] == "GREEN", "the model cannot change the rating"


def test_local_first_makes_no_model_call_when_local_data_answers(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.setenv("GEMINI_MODEL", "some-model")
    calls = []

    async def spy(*a, **k):
        calls.append(1)
        raise AssertionError("a model was called although local data answered")

    monkeypatch.setattr("app.llm.gemini_text", spy)
    monkeypatch.setattr("app.llm.gemini_search_urls", spy)
    out = ask("What happened to SIBAL at 18.7% oxygen and 5 cm/s?")
    assert out["found"] and out["claims"] and not calls


def test_allowlist_default_and_override(monkeypatch):
    assert "ntrs.nasa.gov" in config.allowed_domains()
    monkeypatch.setenv("ALLOWED_DOMAINS", "example.org")
    assert config.allowed_domains() == ["example.org"]


# ---------------------------------------------------------------- clarifying questions
def _ask_full(q, last=None):
    import asyncio

    async def emit(*a, **k):
        pass

    return asyncio.run(answer.run({"question": q, "last_conditions": last}, emit))


def test_missing_airflow_is_asked_for_not_guessed():
    out = _ask_full("What happened to SIBAL at 18.7% oxygen?")
    c = out["clarify"]
    assert c["kind"] == "airflow_missing" and not out["claims"] and out["found"] is False
    asks = [o["ask"] for o in c["options"]]
    assert any("cm/s airflow" in a for a in asks) and any("any airflow" in a for a in asks)
    # the offered values come from the tested range in the data, never invented
    done = _ask_full(asks[0])
    assert "clarify" not in done and done["found"] and done["applied_conditions"]["flow_cm_s"] is not None


def test_airflow_without_a_unit_asks_which_unit():
    out = _ask_full("What happens to SIBAL at 10% oxygen and 100%air")
    c = out["clarify"]
    assert c["kind"] == "airflow_unit" and [o["label"] for o in c["options"][:3]] == ["100 cm/s", "100 mm/s", "100 m/s"]
    done = _ask_full(c["options"][2]["ask"])
    assert done["applied_conditions"]["flow_cm_s"] == 10000.0


def test_misspelt_material_is_confirmed_and_never_falls_back_to_the_previous_material():
    previous = {"material": "Nomex", "o2_pct": 12, "flow_cm_s": 0, "gravity": "moon", "pressure_kpa": None}
    out = _ask_full("what happens to SIBEL when I burn it at 10% oxygen and 5 cm/s", previous)
    assert out["clarify"]["kind"] == "material" and out["clarify"]["options"][0]["label"] == "SIBAL"
    done = _ask_full(out["clarify"]["options"][0]["ask"], previous)
    assert done["applied_conditions"]["material"] == "SIBAL" and done["applied_conditions"]["gravity"] == "0g"


def test_airflow_units_are_converted_and_no_question_is_asked_when_it_is_complete():
    from app.conditions import parse

    groups = ["SIBAL", "Nomex"]
    assert parse("SIBAL at 20% oxygen and 0.5 m/s", groups)["flow_cm_s"] == 50.0
    assert parse("SIBAL at 20% oxygen and 30 mm/s", groups)["flow_cm_s"] == 3.0
    assert parse("SIBAL at 20% oxygen with no airflow", groups)["flow_cm_s"] == 0.0
    assert "clarify" not in _ask_full("What happened to SIBAL at 18.7% oxygen and 2.2 cm/s?")
    assert "clarify" not in _ask_full("What has not been tested for SIBAL?")
    assert "clarify" not in _ask_full("What would happen to Nomex on the Moon at 12% oxygen?"), "partial gravity is outside the data whatever the airflow"
