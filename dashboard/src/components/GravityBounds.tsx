// Gravity bounds band: 0g and 1g estimates with a hatched unknown middle.
// Honesty rule: the middle is never drawn as data, only as an estimate
// between the two endpoints (per the challenge brief).

import type { Controls, VizState } from '../viz/types'

const W = 470
const H = 96
const PAD = { l: 16, r: 16, t: 26, b: 24 }

export function GravityBounds({ viz, controls }: { viz: VizState; controls: Controls }) {
  const { g0_rate: g0, g1_rate: g1 } = viz.bounds
  const xMax = Math.max(4.5, g0 ?? 0, g1 ?? 0) + 0.3
  const xOf = (v: number) => PAD.l + (v / xMax) * (W - PAD.l - PAD.r)
  const both = g0 !== null && g1 !== null
  const estX = both ? xOf(g0 + (g1 - g0) * controls.gravity_g) : null

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60">
      <div className="flex items-baseline justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Partial-gravity band
        </span>
        <span className="font-mono text-[11px] text-sky-400">{controls.gravity_g.toFixed(2)} g</span>
      </div>
      <div className="p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="7" stroke="#64748b" strokeWidth="1.4" opacity="0.5" />
            </pattern>
          </defs>

          {/* baseline */}
          <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#334155" />
          {[0, 1, 2, 3, 4].filter((v) => v <= xMax).map((v) => (
            <g key={v}>
              <line x1={xOf(v)} y1={H - PAD.b} x2={xOf(v)} y2={H - PAD.b + 4} stroke="#475569" />
              <text x={xOf(v)} y={H - PAD.b + 15} textAnchor="middle" fontSize="9" fill="#64748b">
                {v}
              </text>
            </g>
          ))}
          <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="9" fill="#94a3b8">
            spread rate (mm/s)
          </text>

          {both ? (
            <>
              {/* hatched unknown band between endpoints */}
              <rect
                x={Math.min(xOf(g0), xOf(g1))}
                y={PAD.t}
                width={Math.abs(xOf(g1) - xOf(g0))}
                height={H - PAD.b - PAD.t}
                fill="url(#hatch)"
                stroke="#475569"
                strokeDasharray="3 3"
              />
              {/* endpoints */}
              <line x1={xOf(g0)} y1={PAD.t - 6} x2={xOf(g0)} y2={H - PAD.b} stroke="#22c55e" strokeWidth={2} />
              <text x={xOf(g0)} y={PAD.t - 10} textAnchor="middle" fontSize="10" fill="#22c55e">
                0g: {g0.toFixed(2)}
              </text>
              <line x1={xOf(g1)} y1={PAD.t - 6} x2={xOf(g1)} y2={H - PAD.b} stroke="#38bdf8" strokeWidth={2} />
              <text x={xOf(g1)} y={PAD.t - 10} textAnchor="middle" fontSize="10" fill="#38bdf8">
                1g: {g1.toFixed(2)}
              </text>
              {/* current gravity estimate marker */}
              {estX !== null && (
                <g>
                  <polygon
                    points={`${estX},${H - PAD.b - 2} ${estX - 5},${H - PAD.b - 11} ${estX + 5},${H - PAD.b - 11}`}
                    fill="#fbbf24"
                  />
                  <text x={estX} y={PAD.t + 10} textAnchor="middle" fontSize="9" fill="#fbbf24">
                    est.
                  </text>
                </g>
              )}
            </>
          ) : (
            <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fill="#94a3b8">
              {g0 === null ? 'No 0g rows for this material' : 'No 1g reference rows for this material'}
            </text>
          )}
        </svg>
        <div className="mt-1 text-[10px] leading-snug text-amber-500/90">{viz.bounds.note}</div>
      </div>
    </div>
  )
}
