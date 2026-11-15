#!/usr/bin/env python3
"""Write data/processed/rating_fixtures.json: a grid of conditions and the rating the Python
engine gives each one. The TypeScript engine is tested against this file, so the live
sliders and the chat can never disagree about a rating."""
import itertools
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.rating import rate  # noqa: E402

D = ROOT / "data" / "processed"
tests = json.loads((D / "tests.json").read_text())
cfg = json.loads((D / "rating_config.json").read_text())
ranges = json.loads((D / "ranges.json").read_text())

cases = []
for m in ranges["materials"]:
    o2r = m["o2_pct_initial"]
    o2s = sorted({o2r["min"], o2r["max"], round((o2r["min"] + o2r["max"]) / 2, 1), round(o2r["min"] - 3, 1), round(o2r["max"] + 3, 1), round(o2r["min"] + 0.4, 1)})
    fr = m["flow_any_cm_s"]
    flows = [None, 0.5, 5, 10, 30] + ([fr["max"], fr["max"] + 25] if fr else [])
    pr = m["pressure_kpa"]
    pressures = [None] + ([pr["min"], pr["min"] + 40] if pr else [101.3])
    for o2, flow, p, g in itertools.product(o2s, flows, pressures, ["0g", "1g", "moon"]):
        if g != "0g" and (flow not in (None, 5) or p is not None):
            continue
        c = {"material": m["material_group"], "o2_pct": o2, "flow_cm_s": flow, "pressure_kpa": p, "gravity": g}
        r = rate(c, tests, cfg)
        cases.append({"controls": c, "level": r["level"], "code": r["code"], "nearest": [n["test_id"] for n in r["nearest"]], "d_o2": [n["d_o2"] for n in r["nearest"]], "d_flow": [n["d_flow"] for n in r["nearest"]]})
cases.append({"controls": {"material": "No such material", "o2_pct": 21, "flow_cm_s": 5, "pressure_kpa": None, "gravity": "0g"}, "level": "RED", "code": "NO_MATERIAL_TESTS", "nearest": [], "d_o2": [], "d_flow": []})
(D / "rating_fixtures.json").write_text(json.dumps(cases) + "\n")
from collections import Counter

print(len(cases), "fixtures", dict(Counter((c["level"], c["code"]) for c in cases)))
