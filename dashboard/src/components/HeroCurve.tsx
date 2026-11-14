// Hero chart: spread rate vs airflow (log x). Polyline = engine interpolation
// at the current O2 level. Dots = corpus rows, colored by regime, clickable.

import { boundariesOf, classifyRegime, curveAtO2, selectSubset, subsetAtGravity } from '../viz/engine'
import { FLOW_MAX, FLOW_MIN, H, PAD, W, flowX, rateY } from '../viz/scales'
import { REGIME_COLORS, type Controls, type Test, type VizState } from '../viz/types'

const xOf = flowX
const yOf = rateY

export function HeroCurve({
  viz,
  controls,
  tests,
  onPick,
}: {
  viz: VizState
  controls: Controls
  tests: Test[]
  onPick: (id: string) => void
}) {
  const { subset: materialRows } = selectSubset(tests, controls.material)
  const { rows: subset } = subsetAtGravity(materialRows, controls.gravity_g)
  const b = boundariesOf(subset)
  const curve = curveAtO2(subset, controls.o2_pct, FLOW_MIN, FLOW_MAX, 48)
  const yMax = Math.max(4.5, ...subset.map((t) => t.spread_rate_mm_s)) + 0.5
  const yTicks = [0, 1, 2, 3, 4, 5].filter((v) => v <= yMax)

  const line = curve
    .filter((p) => !(p.rate === 0 && p.flow > (Number.isFinite(b.blowoffFlow) ? b.blowoffFlow : FLOW_MAX)))
    .map((p) => `${xOf(p.flow)},${yOf(p.rate, yMax)}`)
    .join(' ')

  const marker = { x: xOf(controls.flow_cm_s), y: yOf(viz.spread_rate_mm_s, yMax) }

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-800 bg-slate-900/60">
      <div className="flex items-baseline justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Spread rate vs airflow
        </span>
        <span className="font-mono text-[11px] text-orange-400">O2 {controls.o2_pct}%</span>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {/* axes */}
          <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#334155" />
          <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#334155" />
          {[1, 2, 5, 10, 20, 40].map((f) => (
            <g key={f}>
              <line x1={xOf(f)} y1={H - PAD.b} x2={xOf(f)} y2={H - PAD.b + 4} stroke="#475569" />
              <text x={xOf(f)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10" fill="#64748b">
                {f}
              </text>
            </g>
          ))}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.l - 4} y1={yOf(v, yMax)} x2={PAD.l} y2={yOf(v, yMax)} stroke="#475569" />
              <text x={PAD.l - 8} y={yOf(v, yMax) + 3} textAnchor="end" fontSize="10" fill="#64748b">
                {v}
              </text>
            </g>
          ))}
          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#94a3b8">
            airflow (cm/s, log)
          </text>
          <text x={12} y={H / 2} textAnchor="middle" fontSize="10" fill="#94a3b8" transform={`rotate(-90 12 ${H / 2})`}>
            spread rate (mm/s)
          </text>

          {/* interpolation line at current O2 */}
          <polyline points={line} fill="none" stroke="#fb923c" strokeWidth={2} opacity={0.85} />

          {/* corpus rows */}
          {subset.map((t) => {
            const row = classifyRegime({ ...controls, o2_pct: t.o2_pct, flow_cm_s: t.flow_cm_s }, t.spread_rate_mm_s, b)
            return (
              <circle
                key={t.test_id}
                cx={xOf(t.flow_cm_s)}
                cy={yOf(t.spread_rate_mm_s, yMax)}
                r={4.5}
                fill={REGIME_COLORS[row]}
                className="cursor-pointer"
                stroke="#0f172a"
                strokeWidth={1}
                onClick={() => onPick(t.test_id)}
              >
                <title>{`${t.test_id}: ${t.spread_rate_mm_s} mm/s @ ${t.o2_pct}% O2, ${t.flow_cm_s} cm/s`}</title>
              </circle>
            )
          })}

          {/* live marker */}
          <circle cx={marker.x} cy={marker.y} r={7} fill="none" stroke="#38bdf8" strokeWidth={2} />
          <circle cx={marker.x} cy={marker.y} r={2.5} fill="#38bdf8" />
        </svg>
      </div>
      <div className="border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-500">
        Dots are test records (click one to open its dossier). Line is interpolation at the current
        O2. <span className="text-amber-500">Corpus is mock today: swap for PSI extraction with no code change.</span>
      </div>
    </div>
  )
}
