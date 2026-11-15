"""Citation verifier fixtures: pass, fail, hallucinated number, wrong page, off-allowlist URL."""
from app.verifier import host_allowed, quote_in, verify_claims

ALLOWED = ["ntrs.nasa.gov", "www.nasa.gov", "psi.nasa.gov"]
ROW = {"test_id": "T4", "o2_pct_initial": 18.7, "flow_start_cm_s": 10.0, "flow_end_cm_s": 2.2, "outcome_text": "Quenched after reduced airflow", "material": "2 cm SIBAL"}
PASSAGES = {
    "S1": {"text": "Test T4\nrecorded outcome: Quenched after reduced airflow\nwhat happened: After airflow reduction, the flame shrank and extinguished.", "source_id": "ntrs-20210011385", "tier": 1, "kind": "test", "row": ROW, "siblings": []},
    "S2": {"text": "Fuel characteristics (SIBAL fabric) 25% fiberglass, 75% cotton blend. Simple weave pattern.", "source_id": "ntrs-20130012832", "tier": 1, "kind": "chunk", "siblings": ["S3"]},
    "S3": {"text": "These tests show the enhanced flamma-\nbility in microgravity for this geometry.", "source_id": "ntrs-20130012832", "tier": 1, "kind": "chunk", "siblings": ["S2"]},
    "S4": {"text": "FM2 is the first-ever combustion experiment to be performed on another planetary body.", "source_id": "web-nasa-fm2", "tier": 2, "kind": "web", "url": "https://www.nasa.gov/fm2/", "siblings": []},
    "S5": {"text": "Miracle fabric never burns.", "source_id": "live:evil", "tier": 3, "kind": "web", "url": "https://evil.example.com/page", "siblings": []},
    "S6": {"text": "materials can be more flammable in microgravity", "source_id": "web-jaxa", "tier": 3, "kind": "web", "url": "https://www.nasa.gov/x", "snapshot_read_on": "2026-11-14", "siblings": []},
}


def run(claim, fetch=None):
    return verify_claims([claim], PASSAGES, ALLOWED, fetch)


def test_pass_structured_row_numbers():
    r = run({"text": "T4: initial O2 18.7%, airflow changed from 10 to 2.2 cm/s. Quenched.", "source_ids": ["S1"], "quote": "After airflow reduction, the flame shrank and extinguished."})
    assert len(r["claims"]) == 1 and not r["removed"] and r["decisions"][0]["passed"]


def test_pass_whitespace_case_and_hyphenation():
    assert run({"text": "SIBAL is a cotton and fiberglass blend.", "source_ids": ["S2"], "quote": "25%  FIBERGLASS,\n75% cotton blend"})["claims"]
    assert run({"text": "Microgravity enhanced flammability in this geometry.", "source_ids": ["S3"], "quote": "enhanced flammability in microgravity"})["claims"]


def test_fail_quote_not_in_source():
    r = run({"text": "The flame burned to completion.", "source_ids": ["S1"], "quote": "The flame burned to completion and all fuel was consumed."})
    assert not r["claims"] and "not found" in r["removed"][0]["reasons"][0]


def test_fail_hallucinated_number():
    r = run({"text": "T4 spread at 1.8 mm/s before quenching at 18.7% O2.", "source_ids": ["S1"], "quote": "After airflow reduction, the flame shrank and extinguished."})
    assert not r["claims"]
    assert "1.8" in r["removed"][0]["reasons"][0] and "18.7" not in r["removed"][0]["reasons"][0]


def test_fail_wrong_page():
    # the quote exists in the same document but on a different page (passage S2, cited S3)
    r = run({"text": "SIBAL is a cotton and fiberglass blend.", "source_ids": ["S3"], "quote": "25% fiberglass, 75% cotton blend"})
    assert not r["claims"] and "different page" in r["removed"][0]["reasons"][0]


def test_fail_unknown_source_and_missing_quote():
    assert "unknown source" in run({"text": "x y z", "source_ids": ["S99"], "quote": "anything"})["removed"][0]["reasons"][0]
    assert not run({"text": "A claim with no quote.", "source_ids": ["S1"], "quote": ""})["claims"]
    assert not run({"text": "A claim with no source.", "source_ids": [], "quote": "Quenched after reduced airflow"})["claims"]


def test_fail_off_allowlist_url():
    r = run({"text": "Miracle fabric never burns.", "source_ids": ["S5"], "quote": "Miracle fabric never burns."}, fetch=lambda u: "Miracle fabric never burns.")
    assert not r["claims"] and "allowlist" in r["removed"][0]["reasons"][0]


def test_tier2_refetch_confirms_or_rejects():
    claim = {"text": "FM2 is described as the first combustion experiment on another planetary body.", "source_ids": ["S4"], "quote": "first-ever combustion experiment to be performed on another planetary body"}
    ok = run(claim, fetch=lambda u: "<p>FM2 is the first-ever combustion experiment to be performed on another planetary body.</p>")
    assert ok["claims"] and ok["claims"][0]["live_check"].startswith("re-fetched")
    assert not run(claim, fetch=lambda u: "This page changed and says something else.")["claims"]
    assert not run(claim, fetch=lambda u: None)["claims"], "a live web claim that cannot be re-fetched is removed"


def test_snapshot_is_labelled_when_offline():
    r = run({"text": "Materials can be more flammable in microgravity.", "source_ids": ["S6"], "quote": "materials can be more flammable in microgravity"}, fetch=lambda u: None)
    assert r["claims"] and "snapshot" in r["claims"][0]["live_check"]


def test_all_fail_leaves_nothing():
    r = verify_claims([{"text": "Invented 99.", "source_ids": ["S1"], "quote": "invented"}, {"text": "Also invented.", "source_ids": ["S2"], "quote": "nope nope nope"}], PASSAGES, ALLOWED)
    assert r["claims"] == [] and len(r["removed"]) == 2 and len(r["decisions"]) == 2


def test_allowlist():
    assert host_allowed("https://ntrs.nasa.gov/citations/20210011385", ALLOWED)
    assert not host_allowed("http://ntrs.nasa.gov/citations/1", ALLOWED), "https only"
    assert not host_allowed("https://ntrs.nasa.gov.evil.com/x", ALLOWED)
    assert not host_allowed("https://evil.com/?u=ntrs.nasa.gov", ALLOWED)
    assert not host_allowed("https://sub.ntrs.nasa.gov/", ALLOWED), "exact hosts, no wildcard subdomains"
    assert not host_allowed("file:///etc/passwd", ALLOWED) and not host_allowed("not a url", ALLOWED)


def test_quote_in_rejects_paraphrase():
    assert not quote_in("the flame got smaller and then it went out after the air was reduced", PASSAGES["S1"]["text"])[0]
