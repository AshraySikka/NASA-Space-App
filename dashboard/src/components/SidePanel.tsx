// Dossier for the clicked test + provenance ribbon + engine debug readout.

import type { Test, VizState } from '../viz/types'
import { isGenerated } from '../viz/corpus'

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 shrink-0 text-slate-500">{k}</span>
      <span className="font-mono break-all text-slate-200">{v}</span>
    </div>
  )
}

export function SidePanel({ viz, activeTest, tests }: {
  viz: VizState
  activeTest: Test | null
  tests: Test[]
}) {
  const generated = tests.filter(isGenerated).length
  const sourced = tests.length - generated

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Test dossier
        </div>
        {activeTest ? (
          <div className="flex flex-col gap-1">
            <Field k="test_id" v={activeTest.test_id} />
            <Field k="material" v={activeTest.material} />
            <Field k="o2_pct" v={`${activeTest.o2_pct} %`} />
            <Field k="flow" v={`${activeTest.flow_cm_s} cm/s`} />
            <Field k="spread rate" v={`${activeTest.spread_rate_mm_s} mm/s`} />
            <Field k="gravity" v={`${activeTest.gravity_g ?? 0} g`} />
            <Field k="series" v={activeTest.series ?? 'n/a'} />
            <Field k="notes" v={activeTest.notes ?? 'n/a'} />
            <a
              href={activeTest.source_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 text-xs break-all text-sky-400 underline hover:text-sky-300"
            >
              {activeTest.source_url}
            </a>
          </div>
        ) : (
          <div className="text-xs text-slate-500">
            Click a chart dot or a citation chip under the 3D view.
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Data provenance
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded">
          <div
            className="bg-emerald-600"
            style={{ width: `${(sourced / tests.length) * 100}%` }}
            title="sourced"
          />
          <div
            className="bg-amber-500"
            style={{ width: `${(generated / tests.length) * 100}%` }}
            title="generated"
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px]">
          <span className="text-emerald-400">{sourced} sourced</span>
          <span className="text-amber-400">{generated} generated (mock)</span>
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Ribbon updates automatically when Moises swaps in the PSI extraction.
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Engine readout
        </div>
        <pre className="max-h-40 overflow-y-auto text-[10px] leading-relaxed text-slate-400">
          {JSON.stringify(
            {
              regime: viz.regime,
              confidence: viz.confidence,
              spread_rate_mm_s: Number(viz.spread_rate_mm_s.toFixed(3)),
              flame: {
                alive: viz.flame.alive,
                length: Number(viz.flame.length.toFixed(2)),
                tilt_deg: Number(viz.flame.tilt_deg.toFixed(1)),
                aspect: Number(viz.flame.aspect.toFixed(2)),
              },
              bounds: {
                g0: viz.bounds.g0_rate,
                g1: viz.bounds.g1_rate,
              },
              based_on: viz.nearest.map((t) => t.test_id),
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  )
}
