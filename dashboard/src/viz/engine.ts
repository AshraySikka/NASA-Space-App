// Pure state engine: controls + corpus in, VizState out.
// No React, no fetch: every physics claim in the UI traces through this file.
// All regime boundaries are derived from the corpus, not hard-coded.

import type { Bounds, Controls, Regime, Test, VizState } from './types'

const EPS = 1e-9
// Illustrative tilt reference, not a measured angle: at 0.2 m/s of forced
// flow a 0g flame lies down roughly 60 degrees, so the reference sits near
// 10 cm/s rather than the older, too-gentle 25 cm/s.
const U_REF_CM_S = 10
const MAX_TILT_DEG = 80

export function gravityOf(t: Test): number {
  return t.gravity_g ?? 0 // absent gravity means an ISS microgravity test
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function norm(v: number, lo: number, hi: number): number {
  return hi - lo < EPS ? 0 : (v - lo) / (hi - lo)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Corpus rows for the selected material; falls back to everything with a flag. */
export function selectSubset(tests: Test[], material: string): { subset: Test[]; exact: boolean } {
  const exact = tests.filter((t) => t.material.toLowerCase() === material.toLowerCase())
  return exact.length > 0 ? { subset: exact, exact: true } : { subset: tests, exact: false }
}

/**
 * Rows at the gravity endpoint nearest the requested level (data exists only
 * at 0g and 1g). Falls back to cross-gravity rows when the endpoint has none
 * for this material; the caller marks that as EXTRAPOLATED.
 */
export function subsetAtGravity(subset: Test[], gravity_g: number): { rows: Test[]; matched: boolean } {
  const g = gravity_g <= 0.5 ? 0 : 1
  const rows = subset.filter((t) => gravityOf(t) === g)
  return rows.length > 0 ? { rows, matched: true } : { rows: subset, matched: false }
}

interface Interpolation {
  rate: number
  used: Test[]
}

/** Inverse-distance weighting over (o2, log flow). Exact at corpus rows. */
export function interpolateSpread(controls: Controls, subset: Test[]): Interpolation {
  if (subset.length === 0) return { rate: 0, used: [] }
  const o2s = subset.map((t) => t.o2_pct)
  const logs = subset.map((t) => Math.log10(Math.max(t.flow_cm_s, 0.1)))
  const o2lo = Math.min(...o2s)
  const o2hi = Math.max(...o2s)
  const flo = Math.min(...logs)
  const fhi = Math.max(...logs)
  const tx = norm(Math.log10(Math.max(controls.flow_cm_s, 0.1)), flo, fhi)
  const ty = norm(controls.o2_pct, o2lo, o2hi)

  const weighted = subset.map((t) => {
    const d = Math.hypot(
      norm(Math.log10(Math.max(t.flow_cm_s, 0.1)), flo, fhi) - tx,
      norm(t.o2_pct, o2lo, o2hi) - ty,
    )
    return { t, w: 1 / (d * d + 1e-6), d }
  })
  const wsum = weighted.reduce((s, x) => s + x.w, 0)
  const rate = weighted.reduce((s, x) => s + x.w * x.t.spread_rate_mm_s, 0) / wsum
  const used = [...weighted].sort((a, b) => a.d - b.d).slice(0, 3).map((x) => x.t)
  return { rate, used }
}

export interface Boundaries {
  noIgnitionO2: number // lowest O2 with sustained spread (approximates the LOI edge)
  blowoffFlow: number // lowest flow with zero spread at flammable O2
  minPositiveFlow: number
  sustainedThreshold: number
}

/** Regime boundaries read back out of the corpus. */
export function boundariesOf(subset: Test[]): Boundaries {
  const positive = subset.filter((t) => t.spread_rate_mm_s > 0)
  const positiveO2 = positive.map((t) => t.o2_pct)
  const noIgnitionO2 = positive.length ? Math.min(...positiveO2) : Infinity

  const positiveFlows = positive.map((t) => t.flow_cm_s)
  const minPositiveFlow = positive.length ? Math.min(...positiveFlows) : 0

  const blowoffCandidates = subset.filter(
    (t) => t.spread_rate_mm_s === 0 && t.o2_pct >= noIgnitionO2,
  )
  const blowoffFlow = blowoffCandidates.length
    ? Math.min(...blowoffCandidates.map((t) => t.flow_cm_s))
    : Infinity

  return {
    noIgnitionO2,
    blowoffFlow,
    minPositiveFlow,
    // Half the material's median positive spread marks robust sustained
    // spread; below that the flame creeps (weak). Threshold is read back
    // from the corpus, never hard-coded as an absolute rate.
    sustainedThreshold: 0.5 * median(positive.map((t) => t.spread_rate_mm_s)),
  }
}

export function classifyRegime(
  controls: Controls,
  rate: number,
  b: Boundaries,
): Regime {
  if (controls.o2_pct < b.noIgnitionO2) return 'NO_IGNITION'
  if (controls.flow_cm_s >= b.blowoffFlow) return 'BLOW_OFF'
  return rate >= b.sustainedThreshold ? 'SUSTAINED' : 'WEAK_SPREAD'
}

/** Bounds chart input: endpoints only, middle is an honest gap. */
export function evaluateBounds(controls: Controls, subset: Test[]): Bounds {
  const atGravity = (g: number): number | null => {
    const rows = subset.filter((t) => gravityOf(t) === g)
    if (rows.length === 0) return null
    return interpolateSpread({ ...controls, gravity_g: g }, rows).rate
  }
  return {
    g0_rate: atGravity(0),
    g1_rate: atGravity(1),
    note:
      'Estimate between 0g and 1g bounds. No partial-gravity data in PSI today. LUCI and FM2 will fill this band.',
  }
}

export function evaluateState(controls: Controls, tests: Test[]): VizState {
  const { subset: materialRows, exact } = selectSubset(tests, controls.material)
  const { rows, matched } = subsetAtGravity(materialRows, controls.gravity_g)
  const subset = rows
  const b = boundariesOf(subset)
  const { rate, used } = interpolateSpread(controls, subset)
  const regime = classifyRegime(controls, rate, b)
  const alive = regime === 'SUSTAINED' || regime === 'WEAK_SPREAD'

  const confidence: VizState['confidence'] = !exact || !matched
    ? 'EXTRAPOLATED'
    : used.some((t) => (t.notes ?? '').includes('generated'))
      ? 'INTERPOLATED'
      : 'LITERATURE-ANCHORED'

  // Flame length: grows with O2 above the no-ignition edge, peaks mid-flow,
  // shrinks toward the blow-off limit. Illustrative, driven by corpus shape.
  const o2Headroom = Math.max(40, Math.max(...subset.map((t) => t.o2_pct))) - b.noIgnitionO2
  const o2Factor = clamp(
    (controls.o2_pct - b.noIgnitionO2) / (o2Headroom > EPS ? o2Headroom : 10),
    0,
    1,
  )
  const flowSpan = b.blowoffFlow - b.minPositiveFlow
  const flowT = flowSpan > EPS ? clamp((controls.flow_cm_s - b.minPositiveFlow) / flowSpan, 0, 1) : 0.5
  const flowFactor = 0.4 + 0.6 * Math.sin(Math.PI * flowT)
  const length = alive ? (0.5 + 1.1 * o2Factor) * flowFactor : 0
  const tilt = Math.min(MAX_TILT_DEG, (Math.atan2(controls.flow_cm_s, U_REF_CM_S) * 180) / Math.PI)

  return {
    spread_rate_mm_s: regime === 'NO_IGNITION' || regime === 'BLOW_OFF' ? 0 : rate,
    regime,
    confidence,
    nearest: used,
    flame: {
      alive,
      length,
      tilt_deg: regime === 'BLOW_OFF' || !alive ? Math.max(tilt, 35) : tilt,
      aspect: 1 + 1.8 * clamp(controls.gravity_g, 0, 1),
      intensity: clamp(0.35 + 1.4 * o2Factor, 0.2, 1),
    },
    bounds: evaluateBounds(controls, materialRows),
  }
}

/** Points for the hero curve at a fixed O2 level (one polyline series). */
export function curveAtO2(
  subset: Test[],
  o2: number,
  minFlow: number,
  maxFlow: number,
  steps = 40,
): Array<{ flow: number; rate: number }> {
  const pts: Array<{ flow: number; rate: number }> = []
  for (let i = 0; i <= steps; i++) {
    const flow = minFlow * Math.pow(maxFlow / minFlow, i / steps) // log spacing
    const { rate } = interpolateSpread({ flow_cm_s: flow, o2_pct: o2, gravity_g: 0, material: '' }, subset)
    pts.push({ flow, rate })
  }
  return pts
}
