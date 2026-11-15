// Evidence rating for the live sliders. Pure code: no network, no language model.
// Mirror of backend/app/rating.py. src/engine/rating.test.ts checks this file against
// data/processed/rating_fixtures.json, which the Python engine writes.

import type { Controls, Level, Measure, Rating, RatingConfig, TestRow } from '../lib/types'

export const GRAVITY_TEXT: Record<string, string> = {
  '0g': 'microgravity',
  '1g': 'normal Earth gravity (1 g)',
  moon: 'lunar gravity (about 1/6 g)',
  mars: 'Mars gravity (about 0.38 g)',
  partial: 'partial gravity',
}
export const LABELS: Record<Level, string> = { GREEN: 'Inside tested range', YELLOW: 'Near the edge', RED: 'Outside tested data' }

const r3 = (x: number) => Math.round(x * 1000) / 1000
const g = (x: number) => String(Number(x.toPrecision(6)))

/** A test's airflow is a path from start flow to final flow, not a single point. */
export function flowSpan(t: TestRow): [number, number] | null {
  if (t.flow_start_cm_s == null) return null
  const e = t.flow_end_cm_s ?? t.flow_start_cm_s
  return [Math.min(t.flow_start_cm_s, e), Math.max(t.flow_start_cm_s, e)]
}

export function measure(t: TestRow, o2: number | null, flow: number | null, pressure: number | null, cfg: RatingConfig): Measure {
  const d_o2 = o2 == null || t.o2_pct_initial == null ? null : r3(Math.abs(o2 - t.o2_pct_initial))
  const span = flowSpan(t)
  let d_flow: number | null = null
  if (flow != null && span) d_flow = span[0] <= flow && flow <= span[1] ? 0 : r3(Math.min(Math.abs(flow - span[0]), Math.abs(flow - span[1])))
  const rp = t.pressure_kpa
  let d_pressure: number | null = null
  let pressure_state: Measure['pressure_state']
  if (rp != null && pressure != null) {
    d_pressure = r3(Math.abs(pressure - rp))
    pressure_state = d_pressure <= cfg.match_pressure_kpa ? 'match' : d_pressure > cfg.far_pressure_kpa ? 'far' : 'near'
  } else {
    pressure_state = rp == null && pressure == null ? 'na' : rp != null ? 'unspecified' : 'row_unknown'
  }
  const score =
    (d_o2 != null ? d_o2 / cfg.near_o2_points : 0) +
    (d_flow != null ? d_flow / cfg.near_flow_cm_s : flow != null ? 1 : 0) +
    (d_pressure != null ? d_pressure / cfg.far_pressure_kpa : 0)
  return { test_id: t.test_id, d_o2, d_flow, d_pressure, pressure_state, flow_known: span != null, flow_calibrated: t.flow_basis.startsWith('published'), score }
}

export function rate(c: Controls, tests: TestRow[], cfg: RatingConfig): Rating {
  const { material, o2_pct: o2, flow_cm_s: flow, pressure_kpa: pressure } = c
  const gravity = c.gravity || '0g'
  const rows = tests.filter((t) => t.material_group === material && t.o2_pct_initial != null)
  const out: Rating = { material, n_material_tests: rows.length, level: 'RED', label: LABELS.RED, code: '', reasons: [], nearest: [], envelope: null }
  const done = (level: Level, code: string, reason: string): Rating => ({ ...out, level, label: LABELS[level], code, reasons: [reason] })

  if (!rows.length) return done('RED', 'NO_MATERIAL_TESTS', `No structured test of ${material || 'this material'} is in the corpus.`)

  const o2s = rows.map((t) => t.o2_pct_initial as number)
  const flows = rows.flatMap((t) => flowSpan(t) ?? [])
  out.envelope = { o2: { min: Math.min(...o2s), max: Math.max(...o2s) }, flow: flows.length ? { min: Math.min(...flows), max: Math.max(...flows) } : null }
  const order = new Map(tests.map((t, i) => [t.test_id, i]))
  const ms = rows.map((t) => measure(t, o2, flow, pressure, cfg)).sort((a, b) => a.score - b.score || (order.get(a.test_id) as number) - (order.get(b.test_id) as number))
  out.nearest = ms.slice(0, cfg.nearest_n)

  if (!cfg.tested_gravity_labels.includes(gravity))
    return done('RED', 'GRAVITY_NOT_TESTED', `Every structured test in the corpus was run in microgravity. There is no test row at ${GRAVITY_TEXT[gravity] ?? gravity}.`)
  if (o2 == null) return done('YELLOW', 'CONDITIONS_INCOMPLETE', 'No oxygen level was given, so the tests are listed without a distance check.')

  const o2Ok = (m: Measure) => m.d_o2 != null && m.d_o2 <= cfg.match_o2_points
  const flowOk = (m: Measure) => flow == null || (m.d_flow != null && m.d_flow <= cfg.match_flow_cm_s)
  const full = ms.filter((m) => o2Ok(m) && flowOk(m) && m.flow_known && m.flow_calibrated && (m.pressure_state === 'match' || m.pressure_state === 'na') && flow != null)
  if (full.length) {
    out.matching_test_ids = full.map((m) => m.test_id)
    return done('GREEN', 'INSIDE_TESTED_RANGE', `${full.length} test(s) of ${material} sit within ${g(cfg.match_o2_points)} oxygen points and ${g(cfg.match_flow_cm_s)} cm/s of these conditions.`)
  }
  const near = ms.filter((m) => m.d_o2 != null && m.d_o2 <= cfg.near_o2_points && (m.d_flow == null || m.d_flow <= cfg.near_flow_cm_s))
  if (!near.length) {
    const b = ms[0]
    return done('RED', 'NO_NEARBY_TEST', `The closest ${material} test (${b.test_id}) is ${g(b.d_o2 as number)} oxygen points away` + (b.d_flow ? ` and ${g(b.d_flow)} cm/s away in airflow` : '') + `; nothing lies within ${g(cfg.near_o2_points)} oxygen points and ${g(cfg.near_flow_cm_s)} cm/s.`)
  }
  const usable = near.filter((m) => m.pressure_state !== 'far')
  if (!usable.length) return done('RED', 'PRESSURE_FAR', `The only nearby ${material} tests were run more than ${g(cfg.far_pressure_kpa)} kPa away from this pressure.`)
  const b = usable[0]
  const env = out.envelope
  const inO2 = env.o2.min <= o2 && o2 <= env.o2.max
  const inFlow = flow == null || (env.flow != null && env.flow.min <= flow && flow <= env.flow.max)
  if (o2Ok(b) && flow == null) return done('YELLOW', 'CONDITIONS_INCOMPLETE', `${b.test_id} matches the oxygen level, but no airflow was given to compare.`)
  if (o2Ok(b) && !b.flow_known) return done('YELLOW', 'FLOW_NOT_PUBLISHED', `${b.test_id} matches the oxygen level within ${g(cfg.match_o2_points)} points, but no calibrated airflow is published for it, so the airflow axis cannot be confirmed.`)
  if (o2Ok(b) && flowOk(b) && !b.flow_calibrated) return done('YELLOW', 'FLOW_UNCALIBRATED', `${b.test_id} is close on both axes, but its airflow is a raw display reading, not calibrated flow.`)
  if (o2Ok(b) && flowOk(b)) {
    const why = b.pressure_state === 'unspecified' ? 'the test ran at a recorded pressure and no pressure was given here' : b.pressure_state === 'row_unknown' ? 'the test has no recorded pressure to compare' : `its pressure is ${g(b.d_pressure as number)} kPa away`
    return done('YELLOW', 'PRESSURE_UNCONFIRMED', `${b.test_id} is close in oxygen and airflow, but ${why}.`)
  }
  if (inO2 !== inFlow) return done('YELLOW', 'EDGE_ONE_AXIS', `These conditions are inside the tested ${inO2 ? 'oxygen' : 'airflow'} range for ${material} but outside it on the other axis. Closest test: ${b.test_id}.`)
  return done('YELLOW', 'CLOSE_NEIGHBOURS', `No ${material} test matches within tolerance. The closest, ${b.test_id}, is ${g(b.d_o2 as number)} oxygen points` + (b.d_flow ? ` and ${g(b.d_flow)} cm/s` : '') + ' away.')
}

/** "What this means for design": a template filled from the rating and the nearest outcomes. Never free text. */
export function designSentence(r: Rating, byId: Map<string, TestRow>): string {
  const m = r.material
  const outs = new Map<string, string[]>()
  for (const n of r.nearest.slice(0, 3)) {
    const t = byId.get(n.test_id)
    if (t) outs.set(t.outcome_text, [...(outs.get(t.outcome_text) ?? []), t.test_id])
  }
  const seen = [...outs].map(([k, v]) => `${k} (${v.join(', ')})`).join('; ')
  if (r.level === 'GREEN') return `For design: NASA ran ${m} tests at essentially these conditions in microgravity. What was recorded: ${seen}. That describes those small-sample tests only. It is not a clearance for a product or a habitat.`
  if (r.level === 'YELLOW') return `For design: there is no ${m} test at exactly these conditions. The closest tests recorded: ${seen}. Treat them as neighbours, not as results for your case, and check the distances shown.`
  if (r.code === 'GRAVITY_NOT_TESTED') return `For design: nothing in this corpus was measured at this gravity level. The nearest microgravity ${m} tests recorded: ${seen}. Use them as context only. This is a gap that needs a test.`
  return `For design: NASA data in this corpus does not cover ${m} near these conditions. Nothing here supports a decision either way. This is a gap that needs a test.`
}
