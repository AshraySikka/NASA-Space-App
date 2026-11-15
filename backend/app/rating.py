"""Evidence rating. Pure code, no language model anywhere in this file.

The same rules are implemented in dashboard/src/engine/rating.ts for the live sliders.
`make test` checks the two against each other with shared fixtures
(data/processed/rating_fixtures.json).
"""
from __future__ import annotations

from typing import Any

GRAVITY_TEXT = {
    "0g": "microgravity",
    "1g": "normal Earth gravity (1 g)",
    "moon": "lunar gravity (about 1/6 g)",
    "mars": "Mars gravity (about 0.38 g)",
    "partial": "partial gravity",
}
LABELS = {"GREEN": "Inside tested range", "YELLOW": "Near the edge", "RED": "Outside tested data"}


def _span(t: dict) -> tuple[float, float] | None:
    s, e = t.get("flow_start_cm_s"), t.get("flow_end_cm_s")
    if s is None:
        return None
    e = s if e is None else e
    return (min(s, e), max(s, e))


def measure(t: dict, o2: float | None, flow: float | None, pressure: float | None, cfg: dict) -> dict:
    """Distances from the user's point to one test. Flow is a path: inside the path = distance 0."""
    d_o2 = None if o2 is None or t.get("o2_pct_initial") is None else round(abs(o2 - t["o2_pct_initial"]), 3)
    span = _span(t)
    if flow is None or span is None:
        d_flow = None
    else:
        d_flow = 0.0 if span[0] <= flow <= span[1] else round(min(abs(flow - span[0]), abs(flow - span[1])), 3)
    rp = t.get("pressure_kpa")
    if rp is not None and pressure is not None:
        d_p = round(abs(pressure - rp), 3)
        p_state = "match" if d_p <= cfg["match_pressure_kpa"] else ("far" if d_p > cfg["far_pressure_kpa"] else "near")
    else:
        d_p = None
        p_state = "na" if rp is None and pressure is None else ("unspecified" if rp is not None else "row_unknown")
    score = (d_o2 / cfg["near_o2_points"] if d_o2 is not None else 0.0) + (d_flow / cfg["near_flow_cm_s"] if d_flow is not None else (1.0 if flow is not None else 0.0)) + (d_p / cfg["far_pressure_kpa"] if d_p is not None else 0.0)
    return {
        "test_id": t["test_id"], "d_o2": d_o2, "d_flow": d_flow, "d_pressure": d_p, "pressure_state": p_state,
        "flow_known": span is not None, "flow_calibrated": str(t.get("flow_basis", "")).startswith("published"),
        "score": score,
    }


def rate(controls: dict[str, Any], tests: list[dict], cfg: dict) -> dict:
    material, o2, flow = controls.get("material"), controls.get("o2_pct"), controls.get("flow_cm_s")
    pressure, gravity = controls.get("pressure_kpa"), controls.get("gravity") or "0g"
    rows = [t for t in tests if t["material_group"] == material and t.get("o2_pct_initial") is not None]
    out: dict[str, Any] = {"material": material, "n_material_tests": len(rows), "tolerance": cfg, "nearest": [], "reasons": [], "envelope": None}

    def done(level: str, code: str, reason: str) -> dict:
        out.update(level=level, label=LABELS[level], code=code)
        out["reasons"].insert(0, reason)
        return out

    if not rows:
        return done("RED", "NO_MATERIAL_TESTS", f"No structured test of {material or 'this material'} is in the corpus.")

    o2s = [t["o2_pct_initial"] for t in rows]
    flows = [x for t in rows for x in (_span(t) or ())]
    out["envelope"] = {"o2": {"min": min(o2s), "max": max(o2s)}, "flow": {"min": min(flows), "max": max(flows)} if flows else None}
    order = {t["test_id"]: i for i, t in enumerate(tests)}
    ms = sorted((measure(t, o2, flow, pressure, cfg) for t in rows), key=lambda m: (m["score"], order[m["test_id"]]))
    out["nearest"] = ms[: cfg["nearest_n"]]

    if gravity not in cfg["tested_gravity_labels"]:
        return done("RED", "GRAVITY_NOT_TESTED", f"Every structured test in the corpus was run in microgravity. There is no test row at {GRAVITY_TEXT.get(gravity, gravity)}.")
    if o2 is None:
        return done("YELLOW", "CONDITIONS_INCOMPLETE", "No oxygen level was given, so the tests are listed without a distance check.")

    def o2_ok(m):
        return m["d_o2"] is not None and m["d_o2"] <= cfg["match_o2_points"]

    def flow_ok(m):
        return flow is None or (m["d_flow"] is not None and m["d_flow"] <= cfg["match_flow_cm_s"])

    full = [m for m in ms if o2_ok(m) and flow_ok(m) and m["flow_known"] and m["flow_calibrated"] and m["pressure_state"] in ("match", "na") and flow is not None]
    if full:
        out["matching_test_ids"] = [m["test_id"] for m in full]
        return done("GREEN", "INSIDE_TESTED_RANGE", f"{len(full)} test(s) of {material} sit within {cfg['match_o2_points']:g} oxygen points and {cfg['match_flow_cm_s']:g} cm/s of these conditions.")

    near = [m for m in ms if m["d_o2"] is not None and m["d_o2"] <= cfg["near_o2_points"] and (m["d_flow"] is None or m["d_flow"] <= cfg["near_flow_cm_s"])]
    if not near:
        best = ms[0]
        return done("RED", "NO_NEARBY_TEST", f"The closest {material} test ({best['test_id']}) is {best['d_o2']:g} oxygen points away" + (f" and {best['d_flow']:g} cm/s away in airflow" if best["d_flow"] else "") + f"; nothing lies within {cfg['near_o2_points']:g} oxygen points and {cfg['near_flow_cm_s']:g} cm/s.")
    usable = [m for m in near if m["pressure_state"] != "far"]
    if not usable:
        return done("RED", "PRESSURE_FAR", f"The only nearby {material} tests were run more than {cfg['far_pressure_kpa']:g} kPa away from this pressure.")
    b = usable[0]
    env = out["envelope"]
    in_o2 = env["o2"]["min"] <= o2 <= env["o2"]["max"]
    in_flow = flow is None or (env["flow"] is not None and env["flow"]["min"] <= flow <= env["flow"]["max"])
    if o2_ok(b) and flow is None:
        return done("YELLOW", "CONDITIONS_INCOMPLETE", f"{b['test_id']} matches the oxygen level, but no airflow was given to compare.")
    if o2_ok(b) and not b["flow_known"]:
        return done("YELLOW", "FLOW_NOT_PUBLISHED", f"{b['test_id']} matches the oxygen level within {cfg['match_o2_points']:g} points, but no calibrated airflow is published for it, so the airflow axis cannot be confirmed.")
    if o2_ok(b) and flow_ok(b) and not b["flow_calibrated"]:
        return done("YELLOW", "FLOW_UNCALIBRATED", f"{b['test_id']} is close on both axes, but its airflow is a raw display reading, not calibrated flow.")
    if o2_ok(b) and flow_ok(b):
        why = {"unspecified": "the test ran at a recorded pressure and no pressure was given here", "row_unknown": "the test has no recorded pressure to compare"}.get(b["pressure_state"]) or f"its pressure is {b['d_pressure']:g} kPa away"
        return done("YELLOW", "PRESSURE_UNCONFIRMED", f"{b['test_id']} is close in oxygen and airflow, but {why}.")
    if in_o2 != in_flow:
        axis = "oxygen" if in_o2 else "airflow"
        return done("YELLOW", "EDGE_ONE_AXIS", f"These conditions are inside the tested {axis} range for {material} but outside it on the other axis. Closest test: {b['test_id']}.")
    return done("YELLOW", "CLOSE_NEIGHBOURS", f"No {material} test matches within tolerance. The closest, {b['test_id']}, is {b['d_o2']:g} oxygen points" + (f" and {b['d_flow']:g} cm/s" if b["d_flow"] else "") + " away.")
