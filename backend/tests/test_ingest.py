"""Ingestion helpers: date-corruption repair, anomaly flagging, outcome mapping, conflicts, Table 7.1."""
import datetime as dt
import json
from pathlib import Path

import lib

D = Path(__file__).resolve().parents[2] / "data" / "processed"
TESTS = json.loads((D / "tests.json").read_text())
OMAP = json.loads((D / "outcome_map.json").read_text())


def test_excel_date_repair():
    assert lib.repair_excel_date(dt.datetime(2026, 5, 1), 2026) == ("5  1", True)  # '5, 1'
    assert lib.repair_excel_date(dt.datetime(2004, 9, 5), 2026) == ("9  5  4", True)  # '9, 5, 4'
    assert lib.repair_excel_date(dt.datetime(2000, 5, 2), 2026) == ("5  2  0", True)  # '5, 2, 0'
    assert lib.repair_excel_date("10   2.5", 2026) == ("10 2.5", False)
    assert lib.repair_excel_date(None, 2026) == (None, False)


def test_final_o2_anomaly_flagging():
    assert lib.final_o2_anomaly(20.7, 0.9, 5.0, 0.3)
    assert lib.final_o2_anomaly(20.7, 40.4, 5.0, 0.3)
    assert lib.final_o2_anomaly(18.8, 18.9, 5.0, 0.3) is None, "sensor noise of 0.1 is not an anomaly"
    assert lib.final_o2_anomaly(22.2, 19.0, 5.0, 0.3) is None
    assert lib.final_o2_anomaly(22.2, None, 5.0, 0.3) is None, "blank is unknown, not zero"


def test_anomalies_in_processed_data_are_nulled_not_kept():
    flagged = [t for t in TESTS if any("implausible_final_o2" in f for f in t["anomaly_flags"])]
    assert len(flagged) >= 1 and all(t["o2_pct_final"] is None for t in flagged)
    assert all(t["o2_pct_final"] is None or 0 < t["o2_pct_final"] <= t["o2_pct_initial"] + 0.3 for t in TESTS)


def test_outcome_mapping_keeps_every_phrase_distinct():
    assert lib.slug_class("Flame observed; ending unstated") == "FLAME_OBSERVED_ENDING_UNSTATED"
    assert lib.slug_class("") == "NOT_STATED"
    phrases = {t["outcome_text"] for t in TESTS}
    classes = {c["outcome_text"]: c["outcome_class"] for c in OMAP["classes"]}
    assert set(classes) == phrases and len(set(classes.values())) == len(phrases), "no two phrases collapse into one class"
    for t in TESTS:
        assert t["outcome_class"] == lib.slug_class(t["outcome_text"])
    unstated = [t for t in TESTS if "unstated" in t["outcome_text"].lower()]
    assert unstated and all(t["outcome_class"] not in ("FUEL_BURNED_OUT",) and "QUENCH" not in t["outcome_class"] for t in unstated)


def test_conflict_flagging():
    d = lib.compare_fields({"flow_end_cm_s": 2.2, "width_cm": 2.2, "o2": None}, {"flow_end_cm_s": 22.0, "width_cm": 2.2, "o2": 17.5}, ["flow_end_cm_s", "width_cm", "o2"])
    assert d == [{"field": "flow_end_cm_s", "a": 2.2, "b": 22.0}]
    conflict_rows = [t for t in TESTS if t["conflict"]]
    assert all(t["conflicts"] for t in conflict_rows)
    assert all(not t["conflicts"] for t in TESTS if not t["conflict"])


def test_table_7_1_parser():
    text = "GMT45-T2 \n2.2 \n10 to 5 \n18.5b \n----------------------------- \nGMT45-T4 \n2.2 \n10 to 2.2 \n18.7 \nQuenched \nGMT190-T23 \n2.2 \n10 \n17.2 \nReused, did not ignite \nGMT96-T8 \n2.2 \n5 \n21 \nBASS \n"
    rows = lib.parse_table_7_1(text)
    assert rows["T4"] == {"gmt": 45, "width_cm": 2.2, "flow_start_cm_s": 10.0, "flow_end_cm_s": 2.2, "o2_pct_initial": 18.7, "published_comment": "Quenched"}
    assert rows["T2"]["flow_end_cm_s"] == 5.0 and rows["T2"]["published_comment"] == ""
    assert rows["T23"]["flow_start_cm_s"] == rows["T23"]["flow_end_cm_s"] == 10.0
    assert "T8" not in rows, "BASS (not BASS-II) rows are excluded"


def test_material_labels_stay_exact():
    assert lib.material_group("2 cm SIBAL") == "SIBAL" and lib.material_group("Nomex natural (nomex III)") == "Nomex"
    assert lib.material_group("100 micron PMMA film   2 cm wide") == "PMMA film" and lib.material_group('1/4" clear rod') == "PMMA rod"
    assert not any(t["material_group"].lower() == "cotton" for t in TESTS)
    assert all("fabric" not in t["material_group"].lower() for t in TESTS if "PMMA" in t["material_group"])


def test_air_display_parsing_and_blank_is_unknown():
    assert lib.parse_air_display("5  1")["end"] == 1.0
    assert lib.parse_air_display("5   down to ext") == {"start": 5.0, "end": None, "clean_list": False, "text": "5 down to ext"}
    assert lib.parse_air_display("")["start"] is None
    assert lib.to_float("") is None and lib.to_float(None) is None and lib.to_float("none") is None


def test_no_mock_rows_and_no_invented_rates():
    assert not any("mock" in json.dumps(t).lower() or "generated" in json.dumps(t).lower() for t in TESTS)
    assert all(t["spread_rate_mm_s"] is None for t in TESTS), "no spread rate exists in the sources, so none may appear"
    assert all(t["gravity_label"].startswith("microgravity") for t in TESTS)
    assert all(t["source_id"] and (t["pdf_page"] or t["evidence_role"] == "context") for t in TESTS)
