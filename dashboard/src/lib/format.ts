import type { TestRow } from './types'

export type FlowUnit = 'cm/s' | 'm/s'
export type O2Unit = '%' | 'kPa'

export const num = (x: number, digits = 1): string => String(Number(x.toFixed(digits)))

export function fmtFlow(cm_s: number | null, unit: FlowUnit, withUnit = true): string {
  if (cm_s == null) return 'not published'
  const v = unit === 'm/s' ? num(cm_s / 100, 3) : num(cm_s, 1)
  return withUnit ? `${v} ${unit}` : v
}

/** Oxygen as % by volume, or as partial pressure when the total pressure is known. */
export function fmtO2(pct: number | null, unit: O2Unit, pressure_kpa: number | null): string {
  if (pct == null) return 'not recorded'
  if (unit === 'kPa' && pressure_kpa != null) return `${num((pct / 100) * pressure_kpa, 1)} kPa O₂`
  return `${num(pct, 1)}%`
}

export function flowPath(t: TestRow, unit: FlowUnit): string {
  if (t.flow_start_cm_s == null) return 'not published'
  if (t.flow_end_cm_s == null) return `${fmtFlow(t.flow_start_cm_s, unit, false)} then unknown ${unit}`
  if (t.flow_end_cm_s === t.flow_start_cm_s) return `${fmtFlow(t.flow_start_cm_s, unit, false)} ${unit} (held)`
  return `${fmtFlow(t.flow_start_cm_s, unit, false)} → ${fmtFlow(t.flow_end_cm_s, unit, false)} ${unit}`
}

export const range = (r: { min: number; max: number } | null, digits = 1): string => (!r ? 'not recorded' : r.min === r.max ? num(r.min, digits) : `${num(r.min, digits)} to ${num(r.max, digits)}`)

export const TEST_ID = /\b(?:SVI-\d+|[A-Z]\d{1,2}[ab]?)\b/g
