// Locked contract (PLAN.md section 5). Team builds against these shapes.
// Extension fields (gravity_g, series, pressure_psi, notes) are optional and
// non-blocking: the engine degrades gracefully when they are absent.

export interface Test {
  test_id: string
  material: string
  o2_pct: number
  flow_cm_s: number
  spread_rate_mm_s: number // 0 means no sustained spread
  source_url: string
  gravity_g?: number // defaults to 0 (all ISS combustion tests are microgravity)
  series?: string
  pressure_psi?: number
  notes?: string
}

// Ranking response shape (returned by Ashray's /rank endpoint).
export interface RankedTest {
  test_id: string
  score: number
  why: string
}

export interface Controls {
  flow_cm_s: number
  o2_pct: number
  gravity_g: number // 0..1, middle labeled as an estimate between bounds
  material: string
}

export type Regime = 'NO_IGNITION' | 'WEAK_SPREAD' | 'SUSTAINED' | 'BLOW_OFF'

export type Confidence = 'LITERATURE-ANCHORED' | 'INTERPOLATED' | 'EXTRAPOLATED'

export interface Bounds {
  g0_rate: number | null
  g1_rate: number | null
  note: string
}

export interface VizState {
  spread_rate_mm_s: number
  regime: Regime
  confidence: Confidence
  nearest: Test[] // the corpus rows that produced this estimate (citation chips)
  flame: {
    alive: boolean
    length: number // world units, 0 when not alive
    tilt_deg: number
    aspect: number // 1.0 sphere-like at 0g, up to ~2.8 teardrop at 1g
    intensity: number // 0..1 brightness factor from O2
  }
  bounds: Bounds
}

export const REGIME_COLORS: Record<Regime, string> = {
  NO_IGNITION: '#22c55e',
  WEAK_SPREAD: '#eab308',
  SUSTAINED: '#f97316',
  BLOW_OFF: '#38bdf8',
}

export const REGIME_LABELS: Record<Regime, string> = {
  NO_IGNITION: 'NO IGNITION',
  WEAK_SPREAD: 'WEAK SPREAD',
  SUSTAINED: 'SUSTAINED SPREAD',
  BLOW_OFF: 'BLOW-OFF EXTINCTION',
}

/** Safety verdict for a set of conditions, derived from the regime. */
export function verdictOf(regime: Regime): 'PASS' | 'MARGINAL' | 'FAIL' {
  if (regime === 'SUSTAINED') return 'FAIL'
  if (regime === 'WEAK_SPREAD') return 'MARGINAL'
  return 'PASS'
}

export const VERDICT_COLORS: Record<'PASS' | 'MARGINAL' | 'FAIL', string> = {
  PASS: '#22c55e',
  MARGINAL: '#eab308',
  FAIL: '#ef4444',
}
