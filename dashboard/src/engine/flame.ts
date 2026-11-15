// Turns the evidence class of the nearest real test into parameters for the illustrative
// flame. Pure function: (controls, rating, tests, outcome map) -> VizState.
// Nothing here is measured physics. The UI labels the scene "Illustrative, not a measurement".

import type { Controls, OutcomeMap, Rating, TestRow } from '../lib/types'
import type { FlameMode, SceneControls, VizState } from '../viz/types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface FlameDriver {
  viz: VizState
  scene: SceneControls
  /** The test whose recorded outcome drives the animation, if any. */
  driver: TestRow | null
  family: string
  /** Why the scene looks the way it does, in one line. */
  caption: string
  estimate: boolean
}

export function familyOf(t: TestRow, map: OutcomeMap): string {
  return map.classes.find((c) => c.outcome_text === t.outcome_text)?.family ?? 'unknown'
}

export function flameDriver(c: Controls, rating: Rating, byId: Map<string, TestRow>, map: OutcomeMap, o2Span: [number, number], flowMax: number): FlameDriver {
  const flow = c.flow_cm_s ?? 0
  const o2 = c.o2_pct ?? o2Span[0]
  const gravity_g = c.gravity === '1g' ? 1 : c.gravity === 'moon' ? 1 / 6 : c.gravity === 'mars' ? 0.38 : 0
  const estimate = c.gravity !== '0g'
  // Only tests that are actually near drive the picture; a far-away test illustrates nothing.
  const noNeighbour = rating.code === 'NO_NEARBY_TEST' || rating.code === 'NO_MATERIAL_TESTS' || rating.code === 'PRESSURE_FAR'
  const driver = noNeighbour ? null : (byId.get(rating.nearest[0]?.test_id ?? '') ?? null)
  const family = driver ? familyOf(driver, map) : 'unknown'
  const mode: FlameMode = driver ? (map.families[family]?.flame ?? 'ghost') : 'ghost'
  const alive = mode !== 'ghost'
  const stop_at = mode === 'steady' ? 1 : mode === 'flash' ? 0.07 : 0.45
  const o2Factor = clamp((o2 - o2Span[0]) / Math.max(1, o2Span[1] - o2Span[0]), 0, 1)
  const flowT = clamp(flow / Math.max(1, flowMax), 0, 1)
  const length = alive ? (0.55 + 0.9 * o2Factor) * (mode === 'flash' ? 0.5 : 0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, flowT * 2.2))) : 0
  const tilt = Math.min(80, (Math.atan2(flow, 10) * 180) / Math.PI)
  const caption = !driver
    ? 'No test is near these conditions, so no flame is drawn.'
    : mode === 'ghost'
      ? `Nearest test ${driver.test_id} has no stated outcome, so no flame is drawn.`
      : `Animation follows the outcome recorded for the nearest test, ${driver.test_id}.`
  return {
    viz: {
      mode,
      anim_speed: alive ? 0.9 + 1.4 * flowT : 0,
      stop_at,
      flame: { alive, length, tilt_deg: mode === 'blow' ? Math.max(tilt, 55) : tilt, aspect: 1 + 1.8 * clamp(gravity_g, 0, 1), intensity: clamp(0.35 + 1.2 * o2Factor, 0.2, 1) },
    },
    scene: { flow_cm_s: flow, o2_pct: o2, gravity_g, material: c.material },
    driver,
    family,
    caption,
    estimate,
  }
}
