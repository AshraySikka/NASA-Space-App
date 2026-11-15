import { describe, expect, it } from 'vitest'
import { flameDriver } from './flame'
import { designSentence, flowSpan, measure, rate } from './rating'
import type { Controls, TestRow } from '../lib/types'
import { read, realData } from '../test/load'

const data = realData()
const cfg = data.ratingConfig
const byId = new Map<string, TestRow>(data.tests.map((t) => [t.test_id, t]))
const sibal = data.ranges.materials[0]
const base: Controls = { material: sibal.material_group, o2_pct: null, flow_cm_s: null, pressure_kpa: null, gravity: '0g' }

interface Fixture { controls: Controls; level: string; code: string; nearest: string[]; d_o2: (number | null)[]; d_flow: (number | null)[] }

describe('evidence rating (TypeScript) matches the Python engine', () => {
  const fixtures = read<Fixture[]>('rating_fixtures.json')
  it(`agrees on level, code, nearest tests and distances for ${fixtures.length} fixtures`, () => {
    expect(fixtures.length).toBeGreaterThan(300)
    for (const f of fixtures) {
      const r = rate(f.controls, data.tests, cfg)
      const where = JSON.stringify(f.controls)
      expect([r.level, r.code], where).toEqual([f.level, f.code])
      expect(r.nearest.map((n) => n.test_id), where).toEqual(f.nearest)
      r.nearest.forEach((n, i) => {
        if (f.d_o2[i] == null) expect(n.d_o2).toBeNull()
        else expect(n.d_o2).toBeCloseTo(f.d_o2[i] as number, 3)
        if (f.d_flow[i] == null) expect(n.d_flow).toBeNull()
        else expect(n.d_flow).toBeCloseTo(f.d_flow[i] as number, 3)
      })
    }
  })
})

describe('flow is a path, not a point', () => {
  const t = data.tests.find((x) => x.flow_start_cm_s != null && x.flow_end_cm_s != null && Math.abs(x.flow_start_cm_s - x.flow_end_cm_s) > 4) as TestRow
  const [lo, hi] = flowSpan(t) as [number, number]
  it('a point between start and final flow has zero flow distance', () => {
    expect(measure(t, t.o2_pct_initial, (lo + hi) / 2, null, cfg).d_flow).toBe(0)
  })
  it('a point outside the path measures to the nearer end', () => {
    expect(measure(t, t.o2_pct_initial, hi + 3, null, cfg).d_flow).toBe(3)
  })
  it('a test with no published flow has no flow distance and can never be green', () => {
    const nomex = data.tests.find((x) => x.material_group === 'Nomex' && x.flow_start_cm_s == null) as TestRow
    expect(flowSpan(nomex)).toBeNull()
    const r = rate({ ...base, material: 'Nomex', o2_pct: nomex.o2_pct_initial, flow_cm_s: 10 }, data.tests, cfg)
    expect(r.level).toBe('YELLOW')
    expect(r.code).toBe('FLOW_NOT_PUBLISHED')
  })
})

describe('rating rules', () => {
  const t = data.tests.find((x) => x.material_group === sibal.material_group && x.evidence_role === 'verified' && x.flow_start_cm_s != null) as TestRow
  it('green at a real test, with that test listed as matching', () => {
    const r = rate({ ...base, o2_pct: t.o2_pct_initial, flow_cm_s: t.flow_start_cm_s }, data.tests, cfg)
    expect(r.level).toBe('GREEN')
    expect(r.matching_test_ids).toContain(t.test_id)
  })
  it('red beyond the tested oxygen range, and the distance is reported', () => {
    const max = sibal.series[0].o2_pct_initial!.max
    const r = rate({ ...base, o2_pct: max + cfg.near_o2_points + 2, flow_cm_s: 5 }, data.tests, cfg)
    expect(r.level).toBe('RED')
    expect(r.nearest[0].d_o2).toBeGreaterThan(cfg.near_o2_points)
  })
  it('red for the Moon and for 1 g: gravity is not a tested value', () => {
    for (const gravity of ['moon', '1g', 'mars'] as const) {
      const r = rate({ ...base, o2_pct: t.o2_pct_initial, flow_cm_s: t.flow_start_cm_s, gravity }, data.tests, cfg)
      expect([r.level, r.code]).toEqual(['RED', 'GRAVITY_NOT_TESTED'])
      expect(r.nearest.length).toBeGreaterThan(0)
    }
  })
  it('pressure far from the only nearby rows turns the rating red', () => {
    const sv = data.tests.find((x) => x.series === 'Saffire VI' && x.pressure_kpa != null && x.material_group === sibal.material_group) as TestRow
    const r = rate({ ...base, o2_pct: sv.o2_pct_initial, pressure_kpa: (sv.pressure_kpa as number) + cfg.far_pressure_kpa + 20 }, data.tests, cfg)
    expect([r.level, r.code]).toEqual(['RED', 'PRESSURE_FAR'])
  })
  it('only tests of the exact material are used', () => {
    const r = rate({ ...base, o2_pct: 21, flow_cm_s: 5 }, data.tests, cfg)
    expect(r.nearest.every((n) => byId.get(n.test_id)!.material_group === sibal.material_group)).toBe(true)
  })
})

describe('outcome classes drive the flame, and nothing is invented', () => {
  const span: [number, number] = [data.ranges.all.o2_pct_initial!.min, data.ranges.all.o2_pct_initial!.max]
  const drive = (c: Controls) => flameDriver(c, rate(c, data.tests, cfg), byId, data.outcomeMap, span, data.ranges.all.flow_any_cm_s!.max)
  it('every recorded outcome phrase has its own class and a marker family', () => {
    const phrases = new Set(data.tests.map((t) => t.outcome_text))
    expect(new Set(data.outcomeMap.classes.map((c) => c.outcome_class)).size).toBe(phrases.size)
    for (const c of data.outcomeMap.classes) expect(data.outcomeMap.families[c.family], c.outcome_text).toBeTruthy()
  })
  it('"ending unstated" is never mapped to burned-out or quenched', () => {
    const c = data.outcomeMap.classes.filter((x) => /unstated|not stated|not extracted|not reviewed/i.test(x.outcome_text))
    expect(c.length).toBeGreaterThan(0)
    for (const x of c) expect(['burned_out', 'quenched', 'blown_out', 'extinguished']).not.toContain(x.family)
  })
  it('a quenched nearest test gives a flame that dies part-way; no test nearby gives no flame', () => {
    const q = data.tests.find((t) => t.listed_quenched) as TestRow
    const d1 = drive({ ...base, o2_pct: q.o2_pct_initial, flow_cm_s: q.flow_end_cm_s })
    expect(d1.driver).toBeTruthy()
    const far = drive({ ...base, o2_pct: span[1] + 10, flow_cm_s: 5 })
    expect(far.driver).toBeNull()
    expect(far.viz.flame.alive).toBe(false)
  })
  it('partial gravity is always flagged as an estimate', () => {
    expect(drive({ ...base, o2_pct: 18.7, flow_cm_s: 5, gravity: 'moon' }).estimate).toBe(true)
    expect(drive({ ...base, o2_pct: 18.7, flow_cm_s: 5, gravity: '0g' }).estimate).toBe(false)
  })
  it('no spread rate exists in the data, so none can be shown', () => {
    expect(data.tests.every((t) => t.spread_rate_mm_s === null)).toBe(true)
    expect(data.ranges.n_spread_rates_published).toBe(0)
  })
  it('the design sentence is a template and never certifies', () => {
    for (const c of [{ ...base, o2_pct: 18.7, flow_cm_s: 5 }, { ...base, o2_pct: 40, flow_cm_s: 5 }, { ...base, o2_pct: 18.7, flow_cm_s: 5, gravity: 'moon' as const }]) {
      const s = designSentence(rate(c, data.tests, cfg), byId)
      expect(s.startsWith('For design:')).toBe(true)
      expect(s).not.toMatch(/\bis safe\b|\bsafe to\b|recommended|mm\/s/i)
    }
  })
})
