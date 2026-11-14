// Flow regime map: airflow (x, log) vs O2 (y) colored by the engine's regime.
// Cell geometry is memoized (static across control changes); only the
// crosshair moves with the sliders. The map is also a controller: click or
// drag anywhere on the plot to set airflow and O2 directly (the sliders,
// 3D scene, and other charts follow through the store).
// Mission O2 levels drawn as dashed lines.

import { useMemo, useRef } from 'react'
import { boundariesOf, classifyRegime, interpolateSpread, selectSubset, subsetAtGravity } from '../viz/engine'
import { FLOW_MAX, FLOW_MIN, H, PAD, W, flowX } from '../viz/scales'
import { useApp } from '../viz/state'
import { REGIME_COLORS, REGIME_LABELS, type Controls, type Regime, type Test, type VizState } from '../viz/types'

const O2_MIN = 15
const O2_MAX = 45
const COLS = 40
const ROWS = 24

const o2Y = (o2: number): number =>
  H - PAD.b - ((o2 - O2_MIN) / (O2_MAX - O2_MIN)) * (H - PAD.t - PAD.b)

interface Cell {
  x: number
  y: number
  w: number
  h: number
  regime: Regime
}

function buildCells(tests: Test[], controls: Controls, gKey: number): Cell[] {
  const { subset: materialRows } = selectSubset(tests, controls.material)
  const { rows } = subsetAtGravity(materialRows, gKey)
  const b = boundariesOf(rows)
  const cells: Cell[] = []
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  for (let i = 0; i < COLS; i++) {
    const t0 = i / COLS
    const t1 = (i + 1) / COLS
    // cell centers for evaluation, edges for drawing (log flow)
    const flowC = FLOW_MIN * Math.pow(FLOW_MAX / FLOW_MIN, (t0 + t1) / 2)
    const x0 = PAD.l + t0 * plotW
    const x1 = PAD.l + t1 * plotW
    for (let j = 0; j < ROWS; j++) {
      const o2C = O2_MIN + ((j + 0.5) / ROWS) * (O2_MAX - O2_MIN)
      const y0 = PAD.t + (1 - (j + 1) / ROWS) * plotH
      const y1 = PAD.t + (1 - j / ROWS) * plotH
      const { rate } = interpolateSpread({ ...controls, flow_cm_s: flowC, o2_pct: o2C }, rows)
      cells.push({
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
        regime: classifyRegime({ ...controls, flow_cm_s: flowC, o2_pct: o2C }, rate, b),
      })
    }
  }
  return cells
}

const MISSION_LINES = [
  { o2: 21, label: 'ISS 21%' },
  { o2: 30, label: 'Lunar base 30%' },
]

export function RegimeMap({ viz, controls, tests, onPick }: {
  viz: VizState
  controls: Controls
  tests: Test[]
  onPick: (id: string) => void
}) {
  const gKey = controls.gravity_g <= 0.5 ? 0 : 1
  const cells = useMemo(() => buildCells(tests, controls, gKey), [tests, controls.material, gKey])
  const { subset: materialRows } = selectSubset(tests, controls.material)
  const { rows } = subsetAtGravity(materialRows, gKey)
  const b = boundariesOf(rows)
  const { setControl } = useApp()

  const crossX = flowX(controls.flow_cm_s)
  const crossY = o2Y(controls.o2_pct)

  // pointer on the SVG -> plot coordinates -> slider values
  const svgRef = useRef<SVGSVGElement>(null)
  const applyPointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(ctm.inverse())
    const plotW = W - PAD.l - PAD.r
    const plotH = H - PAD.t - PAD.b
    const t = Math.min(Math.max((p.x - PAD.l) / plotW, 0), 1)
    const f = Math.min(Math.max((H - PAD.b - p.y) / plotH, 0), 1)
    // snap to slider steps: flow integer (left edge = still air), O2 in 0.5s
    const flow = t < 0.03 ? 0 : Math.min(Math.max(Math.round(FLOW_MIN * Math.pow(FLOW_MAX / FLOW_MIN, t)), 0), 40)
    const o2 = Math.round(Math.min(Math.max(O2_MIN + f * (O2_MAX - O2_MIN), O2_MIN), O2_MAX) * 2) / 2
    setControl('flow_cm_s', flow)
    setControl('o2_pct', o2)
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-800 bg-slate-900/60">
      <div className="flex items-baseline justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Flow regime map
        </span>
        <span
          className="flex items-center gap-1.5 font-mono text-[11px] font-semibold"
          style={{ color: REGIME_COLORS[viz.regime] }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: REGIME_COLORS[viz.regime] }}
          />
          {REGIME_LABELS[viz.regime]} · {gKey === 0 ? '0g' : '1g'} rows
        </span>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-full w-full cursor-crosshair"
          preserveAspectRatio="xMidYMid meet"
        >
          {cells.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={c.w + 0.5} height={c.h + 0.5} fill={REGIME_COLORS[c.regime]} opacity={0.3} />
          ))}

          {/* mission atmosphere lines (O2 only: no mission airflow claim) */}
          {MISSION_LINES.map((m) => (
            <g key={m.o2}>
              <line
                x1={PAD.l}
                y1={o2Y(m.o2)}
                x2={W - PAD.r}
                y2={o2Y(m.o2)}
                stroke="#e2e8f0"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.55}
              />
              <text x={W - PAD.r - 2} y={o2Y(m.o2) - 4} textAnchor="end" fontSize="9" fill="#e2e8f0" opacity={0.8}>
                {m.label}
              </text>
            </g>
          ))}

          {/* interactive capture layer: click or drag to drive the controls.
              sits under the corpus dots so their dossier clicks still land */}
          <rect
            x={PAD.l}
            y={PAD.t}
            width={W - PAD.l - PAD.r}
            height={H - PAD.t - PAD.b}
            fill="transparent"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              applyPointer(e.clientX, e.clientY)
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) applyPointer(e.clientX, e.clientY)
            }}
          />

          {/* corpus rows in this gravity group (click = jump to that test) */}
          {rows.map((t) => (
            <circle
              key={t.test_id}
              cx={flowX(t.flow_cm_s)}
              cy={o2Y(t.o2_pct)}
              r={4}
              fill={REGIME_COLORS[classifyRegime({ ...controls, flow_cm_s: t.flow_cm_s, o2_pct: t.o2_pct }, t.spread_rate_mm_s, b)]}
              className="cursor-pointer"
              stroke="#0f172a"
              strokeWidth={1}
              onClick={() => {
                setControl('flow_cm_s', t.flow_cm_s)
                setControl('o2_pct', t.o2_pct)
                onPick(t.test_id)
              }}
            >
              <title>{`${t.test_id}: ${t.spread_rate_mm_s} mm/s (click to run this test)`}</title>
            </circle>
          ))}

          {/* live crosshair (never intercepts the pointer) */}
          <g pointerEvents="none">
            <line x1={crossX} y1={PAD.t} x2={crossX} y2={H - PAD.b} stroke="#38bdf8" strokeWidth={1.2} opacity={0.9} />
            <line x1={PAD.l} y1={crossY} x2={W - PAD.r} y2={crossY} stroke="#38bdf8" strokeWidth={1.2} opacity={0.9} />
            <circle cx={crossX} cy={crossY} r={5} fill="none" stroke="#38bdf8" strokeWidth={2} />
          </g>

          {/* axes */}
          <g pointerEvents="none">
            <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke="#334155" />
          {[1, 2, 5, 10, 20, 40].map((f) => (
            <text key={f} x={flowX(f)} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="#64748b">
              {f}
            </text>
          ))}
          {[15, 25, 35, 45].map((o) => (
            <text key={o} x={PAD.l - 8} y={o2Y(o) + 3} textAnchor="end" fontSize="10" fill="#64748b">
              {o}
            </text>
          ))}
          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#94a3b8">
            airflow (cm/s, log)
          </text>
          <text x={12} y={H / 2} textAnchor="middle" fontSize="10" fill="#94a3b8" transform={`rotate(-90 12 ${H / 2})`}>
            O2 (%)
          </text>
          </g>
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-500">
        <span className="text-sky-500/90">Click or drag the map to set airflow and O2.</span>
        {(Object.keys(REGIME_COLORS) as Array<keyof typeof REGIME_COLORS>).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: REGIME_COLORS[k] }} />
            {k.replace('_', ' ').toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  )
}
