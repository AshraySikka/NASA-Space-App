import { useMemo, useState } from 'react'
import { flowSpan } from '../engine/rating'
import { useDerived } from '../hooks'
import { flowPath, num } from '../lib/format'
import type { TestRow } from '../lib/types'
import { useApp } from '../store'
import { Marker, MarkerIcon } from './Marker'

const W = 640
const H = 400
const PAD = { l: 54, r: 16, t: 18, b: 78 }
const LANE_H = 26 // strip under the axis for tests whose airflow was never published

function ticksLog(lo: number, hi: number): number[] {
  const out: number[] = []
  for (let p = Math.floor(Math.log10(lo)); p <= Math.ceil(Math.log10(hi)); p++) for (const k of [1, 2, 5]) if (k * 10 ** p >= lo && k * 10 ** p <= hi) out.push(k * 10 ** p)
  return out
}

/**
 * One map: X = initial oxygen (%), Y = airflow (cm/s, log). Each real test is drawn as its
 * start-flow -> final-flow path with an end marker for the recorded outcome. No shading is
 * interpolated; hatching marks everything that is not within tolerance of a published test.
 */
export default function FlammabilityMap() {
  const data = useApp((s) => s.data)!
  const controls = useApp((s) => s.controls)
  const prefs = useApp((s) => s.prefs)
  const focusTest = useApp((s) => s.focusTest)
  const seriesFilter = useApp((s) => s.seriesFilter)
  const set = useApp((s) => s.set)
  const d = useDerived()
  const [hover, setHover] = useState<string | null>(null)
  const [extra, setExtra] = useState<string[]>([])
  const cfg = data.ratingConfig

  const model = useMemo(() => {
    if (!d) return null
    const mats = [controls.material, ...extra.filter((m) => m !== controls.material)]
    const seriesList = [...new Set(data.tests.filter((t) => mats.includes(t.material_group)).map((t) => t.series))]
    // Series that record pressure (Saffire VI) get their own view: different oxygen AND pressure, large samples.
    const pressureSeries = seriesList.filter((s) => data.tests.some((t) => t.series === s && t.pressure_kpa != null))
    const view = seriesFilter !== 'all' && seriesList.includes(seriesFilter) ? seriesFilter : (seriesList.find((s) => !pressureSeries.includes(s)) ?? seriesList[0])
    const isPressureView = pressureSeries.includes(view)
    const rows = data.tests.filter((t) => mats.includes(t.material_group) && t.series === view && t.o2_pct_initial != null)
    return { mats, seriesList, view, isPressureView, rows }
  }, [d, data, controls.material, extra, seriesFilter])

  if (!d || !model) return null
  const { rows, isPressureView, view, seriesList, mats } = model
  const fam = (t: TestRow) => data.outcomeMap.families[data.outcomeMap.classes.find((c) => c.outcome_text === t.outcome_text)?.family ?? 'unknown']
  const o2s = rows.map((t) => t.o2_pct_initial as number)
  const userO2 = controls.o2_pct
  const xLo = Math.floor(Math.min(...o2s, 1e9) - 1)
  const xHi = Math.ceil(Math.max(...o2s, -1e9) + 1)
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const x = (o2: number) => PAD.l + ((o2 - xLo) / Math.max(1e-6, xHi - xLo)) * plotW

  // Y axis: airflow on a log scale, or pressure (linear) for the reduced-pressure series
  const spans = rows.map(flowSpan).filter((s): s is [number, number] => s != null)
  const fMaxData = Math.max(...spans.map((s) => s[1]), 10)
  const fLo = 1
  const fHi = Math.max(fMaxData, controls.flow_cm_s ?? 0, 10) * 1.25
  const ps = rows.map((t) => t.pressure_kpa).filter((p): p is number => p != null)
  const pLo = Math.floor(Math.min(...ps, controls.pressure_kpa ?? 1e9, 1e9) - 5)
  const pHi = Math.ceil(Math.max(...ps, controls.pressure_kpa ?? -1e9, -1e9) + 5)
  const yFlow = (f: number) => PAD.t + plotH - (Math.log10(Math.min(Math.max(f, fLo), fHi) / fLo) / Math.log10(fHi / fLo)) * plotH
  const yP = (p: number) => PAD.t + plotH - ((p - pLo) / Math.max(1e-6, pHi - pLo)) * plotH
  const laneY = PAD.t + plotH + LANE_H / 2 + 4

  // tests sharing one oxygen value are fanned out sideways so their paths do not hide each other
  const groups = new Map<number, string[]>()
  for (const t of rows) groups.set(t.o2_pct_initial as number, [...(groups.get(t.o2_pct_initial as number) ?? []), t.test_id])
  const nudge = (t: TestRow) => {
    const g = groups.get(t.o2_pct_initial as number) as string[]
    return (g.indexOf(t.test_id) - (g.length - 1) / 2) * 7
  }
  const pos = (t: TestRow) => {
    const px = x(t.o2_pct_initial as number) + nudge(t)
    if (isPressureView) return { px, y0: t.pressure_kpa != null ? yP(t.pressure_kpa) : laneY, y1: t.pressure_kpa != null ? yP(t.pressure_kpa) : laneY, lane: t.pressure_kpa == null }
    const s = flowSpan(t)
    if (!s) return { px, y0: laneY, y1: laneY, lane: true }
    return { px, y0: yFlow(t.flow_start_cm_s as number), y1: yFlow(t.flow_end_cm_s ?? (t.flow_start_cm_s as number)), lane: false }
  }

  const quenched = rows.filter((t) => t.listed_quenched && t.flow_end_cm_s != null).sort((a, b) => (a.o2_pct_initial as number) - (b.o2_pct_initial as number) || (a.flow_end_cm_s as number) - (b.flow_end_cm_s as number))
  const nearestIds = d.rating.nearest.slice(0, 3).map((n) => n.test_id)
  const userInX = userO2 != null && userO2 >= xLo && userO2 <= xHi
  const ux = userO2 == null ? null : x(Math.min(Math.max(userO2, xLo), xHi))
  const uy = isPressureView ? (controls.pressure_kpa != null ? yP(controls.pressure_kpa) : null) : controls.flow_cm_s != null ? yFlow(controls.flow_cm_s) : null
  const hovered = hover ? rows.find((t) => t.test_id === hover) : null
  const hp = hovered ? pos(hovered) : null
  const familiesShown = [...new Set(rows.map((t) => data.outcomeMap.classes.find((c) => c.outcome_text === t.outcome_text)?.family ?? 'unknown'))]
  const others = data.ranges.materials.map((m) => m.material_group).filter((m) => m !== controls.material)
  const xt: number[] = []
  for (let v = xLo; v <= xHi; v += xHi - xLo > 12 ? 2 : 1) xt.push(v)

  return (
    <section className="map" data-panel="map" aria-label="Flammability map">
      <div className="panel-head">
        <h2>Flammability map</h2>
        <div className="segmented sm" role="group" aria-label="Series">
          {seriesList.map((s) => (
            <button key={s} type="button" className={s === view ? 'seg on' : 'seg'} aria-pressed={s === view} onClick={() => set({ seriesFilter: s })}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="map-filters">
        <span className="hint">Also show:</span>
        {others.map((m) => (
          <label key={m} className="check sm">
            <input type="checkbox" checked={extra.includes(m)} onChange={(e) => setExtra(e.target.checked ? [...extra, m] : extra.filter((x) => x !== m))} /> {m}
          </label>
        ))}
      </div>
      {isPressureView && <p className="note">{view}: large samples in a Cygnus vehicle at reduced pressure, published as event summaries. It is drawn against pressure because airflow is not in the event table. Do not read it on the same scale as the small glovebox tests.</p>}

      <div className="map-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${view} tests for ${mats.join(', ')}: initial oxygen against ${isPressureView ? 'pressure' : 'airflow'}. ${rows.length} tests drawn.`}>
          <defs>
            <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--hatch)" strokeWidth="1.4" />
            </pattern>
            <clipPath id="plot-clip">
              <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          {/* everything is "no data" until a published test says otherwise */}
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="var(--panel)" />
          <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="url(#hatch)" />
          {!isPressureView && (
            <g clipPath="url(#plot-clip)">
              {rows.filter((t) => t.flow_basis.startsWith('published') && mats[0] === t.material_group).map((t) => {
                const s = flowSpan(t) as [number, number]
                const x0 = x((t.o2_pct_initial as number) - cfg.match_o2_points)
                const x1 = x((t.o2_pct_initial as number) + cfg.match_o2_points)
                const yTop = yFlow(s[1] + cfg.match_flow_cm_s)
                const yBot = yFlow(Math.max(fLo, s[0] - cfg.match_flow_cm_s))
                return <rect key={t.test_id} x={x0} y={yTop} width={x1 - x0} height={Math.max(2, yBot - yTop)} fill="var(--tested)" />
              })}
            </g>
          )}
          {/* axes */}
          {xt.map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--grid)" />
              <text x={x(v)} y={H - PAD.b + LANE_H + 22} textAnchor="middle" className="tick">
                {v}
              </text>
            </g>
          ))}
          {(isPressureView ? Array.from({ length: 5 }, (_, i) => pLo + ((pHi - pLo) * i) / 4) : ticksLog(fLo, fHi)).map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={isPressureView ? yP(v) : yFlow(v)} y2={isPressureView ? yP(v) : yFlow(v)} stroke="var(--grid)" />
              <text x={PAD.l - 6} y={(isPressureView ? yP(v) : yFlow(v)) + 4} textAnchor="end" className="tick">
                {isPressureView ? num(v, 0) : prefs.flowUnit === 'm/s' ? num(v / 100, 2) : v === fLo ? `≤${v}` : v}
              </text>
            </g>
          ))}
          <text x={PAD.l + plotW / 2} y={H - 8} textAnchor="middle" className="axis">
            Initial oxygen (% by volume)
          </text>
          <text transform={`translate(13 ${PAD.t + plotH / 2}) rotate(-90)`} textAnchor="middle" className="axis">
            {isPressureView ? 'Pressure (kPa)' : `Airflow (${prefs.flowUnit}, log scale)`}
          </text>
          {/* lane for rows with no published value on the Y axis */}
          <rect x={PAD.l} y={PAD.t + plotH + 4} width={plotW} height={LANE_H} fill="var(--lane)" stroke="var(--grid)" />
          <text x={PAD.l + 6} y={laneY + 4} className="lane-label">
            {isPressureView ? 'pressure not in event table' : 'airflow not published'}
          </text>

          {/* boundary: only through published quenching cases, never extrapolated */}
          {!isPressureView && quenched.length >= 2 && (
            <g>
              <polyline points={quenched.map((t) => `${x(t.o2_pct_initial as number)},${yFlow(t.flow_end_cm_s as number)}`).join(' ')} fill="none" stroke="var(--boundary)" strokeWidth="1.6" strokeDasharray="5 4" />
              <text x={x(quenched[quenched.length - 1].o2_pct_initial as number) + 8} y={yFlow(quenched[quenched.length - 1].flow_end_cm_s as number) + 16} className="boundary-label">
                from {quenched.length} published quenching cases
              </text>
            </g>
          )}

          {/* connectors from the user's point to the nearest tests */}
          {ux != null && uy != null && rows.filter((t) => nearestIds.includes(t.test_id)).map((t) => {
            const p = pos(t)
            return <line key={t.test_id} x1={ux} y1={uy} x2={p.px} y2={p.y1} stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" opacity="0.8" />
          })}

          {/* tests: start flow -> final flow, end marker = recorded outcome */}
          {rows.map((t) => {
            const p = pos(t)
            const f = fam(t)
            const faded = t.material_group !== controls.material
            const label = `${t.test_id}, ${t.material}, oxygen ${num(t.o2_pct_initial as number)} percent, airflow ${flowPath(t, prefs.flowUnit)}, outcome: ${t.outcome_text}`
            return (
              <g key={t.test_id} className="pt" opacity={faded ? 0.55 : 1} tabIndex={0} role="button" aria-label={label} onMouseEnter={() => setHover(t.test_id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(t.test_id)} onBlur={() => setHover(null)}
                onClick={() => focusTest(t.test_id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), focusTest(t.test_id))}>
                {!p.lane && Math.abs(p.y1 - p.y0) > 1 && (
                  <>
                    <line x1={p.px} y1={p.y0} x2={p.px} y2={p.y1} stroke={f.color} strokeWidth="2" opacity="0.85" />
                    <circle cx={p.px} cy={p.y0} r="2.4" fill={f.color} />
                  </>
                )}
                {t.conflict && <circle cx={p.px} cy={p.y1} r="11" fill="none" stroke="var(--warn)" strokeWidth="1.4" strokeDasharray="3 2" />}
                <Marker shape={f.marker} color={f.color} x={p.px} y={p.y1} size={t.test_id === hover ? 7.5 : 6} hollow={t.evidence_role === 'context'} />
                <circle cx={p.px} cy={p.y1} r="12" fill="transparent" />
              </g>
            )
          })}

          {/* the user's point */}
          {ux != null && (
            <g className="cross" aria-hidden>
              <line x1={ux} x2={ux} y1={PAD.t} y2={PAD.t + plotH + LANE_H + 4} stroke="var(--accent)" strokeWidth="1.2" />
              {uy != null && <line x1={PAD.l} x2={W - PAD.r} y1={uy} y2={uy} stroke="var(--accent)" strokeWidth="1.2" />}
              {uy != null && <circle cx={ux} cy={uy} r="6.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" />}
              {!userInX && (
                <text x={ux + (userO2! > xHi ? -6 : 6)} y={PAD.t + 12} textAnchor={userO2! > xHi ? 'end' : 'start'} className="offscale">
                  {userO2! > xHi ? 'your oxygen level is off the right edge →' : '← your oxygen level is off the left edge'}
                </text>
              )}
            </g>
          )}
        </svg>
        {hovered && hp && (
          <div className="hovercard" role="tooltip" style={{ left: `${(hp.px / W) * 100}%`, top: `${(hp.y1 / H) * 100}%` }} data-flip={hp.px > W * 0.62 ? 'x' : undefined}>
            <b className="mono">{hovered.test_id}</b> · {hovered.material}
            <br />
            {hovered.outcome_text}
            <br />
            <span className="mono">
              O₂ {num(hovered.o2_pct_initial as number)} vol% · {flowPath(hovered, prefs.flowUnit)}
              {hovered.pressure_kpa != null ? ` · ${num(hovered.pressure_kpa)} kPa` : ''}
            </span>
            <br />
            <span className="src">
              {d.sources.get(hovered.source_id)?.title ?? hovered.source_id}
              {hovered.pdf_page ? `, PDF p.${hovered.pdf_page}` : ''}
              {hovered.conflict ? ' · conflict row' : ''}
              {hovered.anomaly_flags.length ? ' · a final-O₂ reading is flagged and not used' : ''}
            </span>
          </div>
        )}
      </div>

      <ul className="legend" aria-label="Legend">
        {familiesShown.map((k) => (
          <li key={k}>
            <MarkerIcon shape={data.outcomeMap.families[k].marker} color={data.outcomeMap.families[k].color} /> {data.outcomeMap.families[k].label}
          </li>
        ))}
        <li>
          <span className="swatch hatch" aria-hidden /> No test within tolerance
        </li>
        <li>
          <span className="swatch tested" aria-hidden /> Within tolerance of a published test
        </li>
        <li>
          <span className="swatch crossh" aria-hidden /> Your conditions
        </li>
      </ul>
      <p className="hint">
        A line runs from a test's starting airflow (small dot) to its final airflow (marker). Tests at the same oxygen level are spread sideways so they stay visible. Hollow markers are unreviewed context rows. Nothing between points is filled in or
        estimated. Select a point to open it in Evidence.
      </p>
    </section>
  )
}
