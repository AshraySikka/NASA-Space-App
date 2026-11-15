import { Info } from 'lucide-react'
import { sliderBounds, useDerived } from '../hooks'
import { fmtFlow, fmtO2, range } from '../lib/format'
import type { Gravity } from '../lib/types'
import { useApp } from '../store'

function Slider({ id, label, value, min, max, step, display, onChange, hint }: { id: string; label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        {/* the only place a slider value is printed */}
        <output htmlFor={id} className="mono" data-user-value>
          {display}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  )
}

const GRAVITY: { v: Gravity; label: string; sub: string }[] = [
  { v: '0g', label: '0 g', sub: 'tested' },
  { v: '1g', label: '1 g', sub: 'no test rows' },
  { v: 'moon', label: 'Moon 1/6 g', sub: 'no data' },
]

export function Controls() {
  const data = useApp((s) => s.data)!
  const controls = useApp((s) => s.controls)
  const setControl = useApp((s) => s.setControl)
  const prefs = useApp((s) => s.prefs)
  const d = useDerived()
  if (!d) return null
  const b = sliderBounds(data.ranges.all)
  const m = d.material
  const hasPressureRows = m.pressure_kpa != null
  const expert = prefs.explain === 'expert'

  return (
    <section className="panel controls" data-panel="controls" aria-label="Simulator controls" data-tour="controls">
      <div className="field material">
        <label htmlFor="material">Material</label>
        <div className="material-row">
          <select id="material" value={controls.material} onChange={(e) => setControl('material', e.target.value)}>
            {data.ranges.materials.map((x) => (
              <option key={x.material_group} value={x.material_group}>
                {x.material_group} ({x.n_tests} {x.n_tests === 1 ? 'test' : 'tests'})
              </option>
            ))}
          </select>
          {/* tested ranges live here and nowhere else; every number is read from ranges.json */}
          <div className="tested mono" data-ranges aria-label={`Tested ranges for ${m.material_group}`}>
            {m.series.map((s) => (
              <span key={s.series} className="tested-row">
                <b>{s.series}</b> O₂ {range(s.o2_pct_initial)}%
                {s.flow_any_cm_s ? ` · flow ${range(s.flow_any_cm_s)} cm/s` : ' · flow not published'}
                {s.pressure_kpa ? ` · ${range(s.pressure_kpa)} kPa` : ''}
                {expert ? ` · n=${s.n_tests}` : ''}
              </span>
            ))}
          </div>
        </div>
        {m.evidence_roles.context && !m.evidence_roles.verified && !m.evidence_roles['published-event'] && (
          <p className="hint">Context rows only: outcomes for this material have not been reviewed, and airflow is the raw display reading.</p>
        )}
      </div>

      <div className="slider-grid">
        <Slider id="o2" label="Oxygen" min={b.o2.min} max={b.o2.max} step={0.1} value={controls.o2_pct ?? b.o2.min} display={fmtO2(controls.o2_pct, prefs.o2Unit, controls.pressure_kpa)} onChange={(v) => setControl('o2_pct', v)}
          hint={prefs.o2Unit === 'kPa' && controls.pressure_kpa == null ? 'Shown in % because partial pressure needs a total pressure. Set one below.' : undefined} />
        <Slider id="flow" label="Airflow" min={b.flow.min} max={b.flow.max} step={0.5} value={controls.flow_cm_s ?? 0} display={fmtFlow(controls.flow_cm_s, prefs.flowUnit)} onChange={(v) => setControl('flow_cm_s', v)} />
        {b.pressure && (
          <div className="slider">
            <div className="slider-head">
              <label className="check">
                <input type="checkbox" checked={controls.pressure_kpa != null} onChange={(e) => setControl('pressure_kpa', e.target.checked ? Math.round(m.pressure_kpa?.min ?? b.pressure!.max - 9) : null)} />
                Set pressure
              </label>
              <output className="mono" data-user-value>
                {controls.pressure_kpa == null ? 'not set' : `${controls.pressure_kpa} kPa`}
              </output>
            </div>
            <input type="range" aria-label="Pressure in kilopascals" min={b.pressure.min} max={b.pressure.max} step={0.5} disabled={controls.pressure_kpa == null} value={controls.pressure_kpa ?? b.pressure.max} onChange={(e) => setControl('pressure_kpa', Number(e.target.value))} />
            <p className="hint">{hasPressureRows ? 'Some rows for this material record a pressure, so it counts in the rating.' : 'No row for this material records a pressure.'}</p>
          </div>
        )}
      </div>

      <div className="field">
        <div className="label-row">
          <span id="grav-label">Gravity</span>
          <span className="tip" tabIndex={0} role="note" aria-label="About gravity data">
            <Info size={14} aria-hidden />
            <span className="tip-body">
              All flight data in this corpus is microgravity. There are no structured test rows at 1 g and no measurements at lunar or Mars gravity anywhere in it. Choosing either turns the rating red and marks the picture as an estimate.
            </span>
          </span>
        </div>
        <div className="segmented" role="radiogroup" aria-labelledby="grav-label">
          {GRAVITY.map((g) => (
            <button key={g.v} type="button" role="radio" aria-checked={controls.gravity === g.v} className={controls.gravity === g.v ? 'seg on' : 'seg'} onClick={() => setControl('gravity', g.v)}>
              {g.label}
              <small>{g.sub}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
