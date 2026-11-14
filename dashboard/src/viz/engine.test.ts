import { describe, expect, it } from 'vitest'
import { boundariesOf, evaluateState, interpolateSpread, selectSubset, subsetAtGravity } from './engine'
import { verdictOf } from './types'
import { corpus } from './corpus'
import type { Controls } from './types'

const base: Controls = { flow_cm_s: 10, o2_pct: 21, gravity_g: 0, material: 'cotton fabric' }

describe('selectSubset', () => {
  it('filters by material', () => {
    const { subset, exact } = selectSubset(corpus, 'nomex fabric')
    expect(exact).toBe(true)
    expect(subset.every((t) => t.material === 'nomex fabric')).toBe(true)
  })

  it('falls back to the full corpus for an unknown material', () => {
    const { subset, exact } = selectSubset(corpus, 'kevlar fabric')
    expect(exact).toBe(false)
    expect(subset.length).toBe(corpus.length)
  })
})

describe('boundariesOf (derived from corpus, not hardcoded)', () => {
  it('finds the no-ignition O2 edge and the blow-off flow', () => {
    const { subset } = selectSubset(corpus, 'cotton fabric')
    const b = boundariesOf(subset)
    expect(b.noIgnitionO2).toBe(21) // 19% row has zero spread
    expect(b.blowoffFlow).toBe(35) // zero-spread rows at 35 cm/s
  })
})

describe('interpolateSpread', () => {
  it('returns the exact value at a corpus row (within its gravity group)', () => {
    const { subset } = selectSubset(corpus, 'cotton fabric')
    // gravity grouping happens before interpolation: B03 (0g) and G01 (1g)
    // share identical conditions, so mixing them would yield 1.15 not 0.8.
    const { rows } = subsetAtGravity(subset, 0)
    const { rate } = interpolateSpread({ ...base, flow_cm_s: 10, o2_pct: 21 }, rows)
    expect(rate).toBeCloseTo(0.8, 2)
  })
})

describe('evaluateState regimes', () => {
  it('below the O2 edge: NO_IGNITION with a dead flame', () => {
    const s = evaluateState({ ...base, o2_pct: 18 }, corpus)
    expect(s.regime).toBe('NO_IGNITION')
    expect(s.flame.alive).toBe(false)
    expect(s.spread_rate_mm_s).toBe(0)
  })

  it('moderate flow at 21% O2: SUSTAINED with spread matching the row', () => {
    const s = evaluateState(base, corpus)
    expect(s.regime).toBe('SUSTAINED')
    expect(s.flame.alive).toBe(true)
    expect(s.spread_rate_mm_s).toBeCloseTo(0.8, 2)
    expect(s.nearest.map((t) => t.test_id)).toContain('B03')
  })

  it('flow at or beyond the extinction limit: BLOW_OFF with a dead flame', () => {
    const s = evaluateState({ ...base, flow_cm_s: 36 }, corpus)
    expect(s.regime).toBe('BLOW_OFF')
    expect(s.flame.alive).toBe(false)
    expect(s.spread_rate_mm_s).toBe(0)
  })

  it('nomex at 21% O2: no sustained spread', () => {
    const s = evaluateState({ ...base, material: 'nomex fabric' }, corpus)
    expect(s.flame.alive).toBe(false)
    expect(s.regime).not.toBe('SUSTAINED')
  })

  it('higher O2 makes a longer, brighter flame', () => {
    const low = evaluateState(base, corpus)
    const high = evaluateState({ ...base, o2_pct: 35 }, corpus)
    expect(high.flame.length).toBeGreaterThan(low.flame.length)
    expect(high.flame.intensity).toBeGreaterThan(low.flame.intensity)
  })
  it('tilt lies the flame down as flow rises (steeper than the old gentle curve)', () => {
    const still = evaluateState({ ...base, flow_cm_s: 0 }, corpus)
    const mid = evaluateState({ ...base, flow_cm_s: 20 }, corpus)
    expect(still.flame.tilt_deg).toBeCloseTo(0, 5)
    expect(mid.flame.tilt_deg).toBeGreaterThan(55) // ~63 deg at 20 cm/s
    expect(mid.flame.tilt_deg).toBeLessThanOrEqual(80)
  })
})

describe('gravity honesty', () => {
  it('aspect grows with gravity', () => {
    const g0 = evaluateState({ ...base, gravity_g: 0 }, corpus)
    const g1 = evaluateState({ ...base, gravity_g: 1 }, corpus)
    expect(g0.flame.aspect).toBeCloseTo(1, 5)
    expect(g1.flame.aspect).toBeGreaterThan(g0.flame.aspect)
  })

  it('bounds always carry the estimate note and flag missing endpoints', () => {
    const s = evaluateState(base, corpus)
    expect(s.bounds.note).toContain('No partial-gravity data')
    expect(s.bounds.g0_rate).not.toBeNull()
    expect(s.bounds.g1_rate).not.toBeNull() // mock includes a generated 1g row
  })
})

describe('verdictOf', () => {
  it('maps regimes to safety verdicts', () => {
    expect(verdictOf('SUSTAINED')).toBe('FAIL')
    expect(verdictOf('WEAK_SPREAD')).toBe('MARGINAL')
    expect(verdictOf('NO_IGNITION')).toBe('PASS')
    expect(verdictOf('BLOW_OFF')).toBe('PASS')
  })
})

describe('confidence badges', () => {
  it('marks estimates over generated rows as INTERPOLATED', () => {
    const s = evaluateState(base, corpus)
    expect(s.confidence).toBe('INTERPOLATED')
  })

  it('marks unknown materials as EXTRAPOLATED', () => {
    const s = evaluateState({ ...base, material: 'kevlar fabric' }, corpus)
    expect(s.confidence).toBe('EXTRAPOLATED')
  })
})
