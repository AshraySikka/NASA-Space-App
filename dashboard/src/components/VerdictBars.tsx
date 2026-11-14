// Material verdict comparison: PASS / MARGINAL / FAIL for each material at the
// current atmosphere and airflow, with the nearest test as the reason.
// This component doubles as the exportable verdict card for the poster/video.

import { evaluateState } from '../viz/engine'
import { MATERIALS } from '../viz/corpus'
import { VERDICT_COLORS, verdictOf, type Controls, type Test } from '../viz/types'

export function VerdictBars({ controls, tests }: { controls: Controls; tests: Test[] }) {
  const rows = MATERIALS.map((m) => {
    const s = evaluateState({ ...controls, material: m }, tests)
    const verdict = verdictOf(s.regime)
    const near = s.nearest[0]
    return { material: m, verdict, rate: s.spread_rate_mm_s, near, regime: s.regime }
  })
  const maxRate = Math.max(1, ...rows.map((r) => r.rate))

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60">
      <div className="flex items-baseline justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Material verdicts
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          {controls.flow_cm_s} cm/s · {controls.o2_pct}% O2
        </span>
      </div>
      <div className="flex flex-col gap-2.5 p-3">
        {rows.map((r) => (
          <div key={r.material} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-200 capitalize">
                {r.material.replace(' fabric', '')}
              </span>
              <span
                className="rounded px-2 py-0.5 text-[11px] font-bold text-slate-950"
                style={{ backgroundColor: VERDICT_COLORS[r.verdict] }}
              >
                {r.verdict}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.max(r.rate > 0 ? 4 : 0, (r.rate / maxRate) * 100)}%`,
                  backgroundColor: VERDICT_COLORS[r.verdict],
                }}
              />
            </div>
            <div className="flex items-baseline justify-between text-[10px] text-slate-500">
              <span>
                {r.rate > 0 ? `${r.rate.toFixed(2)} mm/s spread` : 'no sustained spread'}
              </span>
              <span className="font-mono">
                {r.near
                  ? `nearest ${r.near.test_id}: ${r.near.spread_rate_mm_s} mm/s @ ${r.near.o2_pct}% / ${r.near.flow_cm_s} cm/s`
                  : 'no rows'}
              </span>
            </div>
          </div>
        ))}
        <div className="text-[10px] text-slate-500">
          Verdict derives from the engine regime for each material at these exact conditions.
        </div>
      </div>
    </div>
  )
}
