// Shared chart scales so the hero curve and the regime map align pixel for
// pixel: same width, same airflow axis, crosshairs land in the same place.

export const W = 470
export const H = 230
export const PAD = { l: 44, r: 12, t: 14, b: 30 }
export const FLOW_MIN = 1
export const FLOW_MAX = 40

/** Airflow x-position (log scale), shared by every chart. */
export function flowX(flow: number): number {
  const t =
    (Math.log10(Math.max(flow, FLOW_MIN)) - Math.log10(FLOW_MIN)) /
    (Math.log10(FLOW_MAX) - Math.log10(FLOW_MIN))
  return PAD.l + t * (W - PAD.l - PAD.r)
}

/** Spread-rate y-position for a chart with the given maximum. */
export function rateY(rate: number, yMax: number): number {
  return H - PAD.b - (rate / yMax) * (H - PAD.t - PAD.b)
}
