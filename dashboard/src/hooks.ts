import { useMemo } from 'react'
import { flameDriver } from './engine/flame'
import { rate } from './engine/rating'
import type { MaterialRange, Source, TestRow } from './lib/types'
import { useApp } from './store'

/** Everything derived from (controls, data). Computed once and shared by every panel. */
export function useDerived() {
  const data = useApp((s) => s.data)
  const controls = useApp((s) => s.controls)
  return useMemo(() => {
    if (!data || !controls.material) return null
    const byId = new Map<string, TestRow>(data.tests.map((t) => [t.test_id, t]))
    const sources = new Map<string, Source>(data.sources.map((s) => [s.id, s]))
    const material = data.ranges.materials.find((m) => m.material_group === controls.material) as MaterialRange
    const rating = rate(controls, data.tests, data.ratingConfig)
    const all = data.ranges.all
    const o2Span: [number, number] = [all.o2_pct_initial?.min ?? 0, all.o2_pct_initial?.max ?? 100]
    const flowMax = all.flow_any_cm_s?.max ?? 1
    const drive = flameDriver(controls, rating, byId, data.outcomeMap, o2Span, flowMax)
    return { byId, sources, material, rating, drive, o2Span, flowMax }
  }, [data, controls])
}

/** Slider bounds are read from the computed ranges, with a fixed margin so untested territory is reachable. */
export function sliderBounds(all: { o2_pct_initial: { min: number; max: number } | null; flow_any_cm_s: { min: number; max: number } | null; pressure_kpa: { min: number; max: number } | null }) {
  const o2 = all.o2_pct_initial ?? { min: 0, max: 100 }
  const flow = all.flow_any_cm_s ?? { min: 0, max: 50 }
  const p = all.pressure_kpa
  return {
    o2: { min: Math.max(0, Math.floor(o2.min) - 2), max: Math.min(100, Math.ceil(o2.max) + 6) },
    flow: { min: 0, max: Math.ceil((flow.max * 1.15) / 5) * 5 },
    pressure: p ? { min: Math.max(1, Math.floor(p.min / 10) * 10 - 20), max: 110 } : null,
  }
}
