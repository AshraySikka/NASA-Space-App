import { useApp } from '../viz/state'
import { MATERIALS } from '../viz/corpus'

const O2_PRESETS = [
  { label: 'ISS 21%', v: 21 },
  { label: 'Lunar base 30%', v: 30 },
  { label: 'High O2 35%', v: 35 },
]

const G_PRESETS = [
  { label: '0g', v: 0 },
  { label: 'Lunar 0.16', v: 0.16 },
  { label: 'Mars 0.38', v: 0.38 },
  { label: '1g', v: 1 },
]

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex min-w-[190px] flex-1 flex-col gap-0.5">
      <span className="flex justify-between text-[11px] text-slate-400">
        <span className="font-semibold tracking-wide uppercase">{label}</span>
        <span className="font-mono text-slate-200">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-orange-500"
      />
    </label>
  )
}

export function ControlBar() {
  const { controls, setControl } = useApp()
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-2 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <Slider
        label="Airflow"
        value={controls.flow_cm_s}
        min={0}
        max={40}
        step={1}
        unit=" cm/s"
        onChange={(v) => setControl('flow_cm_s', v)}
      />
      <Slider
        label="Oxygen"
        value={controls.o2_pct}
        min={15}
        max={45}
        step={0.5}
        unit="%"
        onChange={(v) => setControl('o2_pct', v)}
      />
      <Slider
        label="Gravity"
        value={controls.gravity_g}
        min={0}
        max={1}
        step={0.01}
        unit=" g"
        onChange={(v) => setControl('gravity_g', v)}
      />

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Atmosphere
        </span>
        <div className="flex gap-1">
          {O2_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setControl('o2_pct', p.v)}
              className={`rounded px-2 py-1 text-[11px] ${
                controls.o2_pct === p.v
                  ? 'bg-orange-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Gravity detents
        </span>
        <div className="flex gap-1">
          {G_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setControl('gravity_g', p.v)}
              className={`rounded px-2 py-1 text-[11px] ${
                controls.gravity_g === p.v
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Material
        </span>
        <div className="flex gap-1">
          {MATERIALS.map((m) => (
            <button
              key={m}
              onClick={() => setControl('material', m)}
              className={`rounded px-2.5 py-1 text-[11px] capitalize ${
                controls.material === m
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {m.replace(' fabric', '')}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
