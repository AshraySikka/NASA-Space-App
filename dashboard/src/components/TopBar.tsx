import { BookOpen, Download, Info, MessageSquareText, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDerived } from '../hooks'
import { download, evidenceCsv } from '../lib/csv'
import { DEFAULT_PREFS, useApp, type Prefs } from '../store'

function Choice<K extends keyof Prefs>({ k, label, options }: { k: K; label: string; options: { v: Prefs[K]; label: string }[] }) {
  const value = useApp((s) => s.prefs[k])
  const setPref = useApp((s) => s.setPref)
  return (
    <fieldset className="pref">
      <legend>{label}</legend>
      <div className="segmented sm wrap">
        {options.map((o) => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? 'seg on' : 'seg'} onClick={() => setPref(k, o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function PrefsMenu({ onClose }: { onClose: () => void }) {
  const prefs = useApp((s) => s.prefs)
  const setPref = useApp((s) => s.setPref)
  const reset = useApp((s) => s.resetPrefs)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-prefs-toggle]') && onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])
  return (
    <div className="menu" role="dialog" aria-label="Personalize" tabIndex={-1} ref={ref} data-testid="prefs-menu">
      <Choice k="theme" label="Theme" options={[{ v: 'mission', label: 'Mission Control' }, { v: 'daylight', label: 'Daylight' }, { v: 'contrast', label: 'High Contrast' }, { v: 'deep', label: 'Deep Space' }]} />
      <Choice k="accent" label="Accent" options={[{ v: 'nasa', label: 'NASA blue' }, { v: 'flame', label: 'Flame orange' }, { v: 'aurora', label: 'Aurora green' }, { v: 'violet', label: 'Violet' }]} />
      <Choice k="density" label="Density" options={[{ v: 'comfortable', label: 'Comfortable' }, { v: 'compact', label: 'Compact' }]} />
      <Choice k="explain" label="Explain mode" options={[{ v: 'plain', label: 'Plain English' }, { v: 'expert', label: 'Expert' }]} />
      <Choice k="flowUnit" label="Airflow units" options={[{ v: 'cm/s', label: 'cm/s' }, { v: 'm/s', label: 'm/s' }]} />
      <Choice k="o2Unit" label="Oxygen units" options={[{ v: '%', label: '% by volume' }, { v: 'kPa', label: 'kPa (needs a pressure)' }]} />
      <Choice k="quality" label="Simulation quality" options={[{ v: 'high', label: 'High' }, { v: 'balanced', label: 'Balanced' }, { v: 'low', label: 'Low' }]} />
      <label className="check">
        <input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => setPref('reduceMotion', e.target.checked)} /> Reduce motion
      </label>
      <button type="button" className="btn sm" onClick={reset} disabled={JSON.stringify(prefs) === JSON.stringify(DEFAULT_PREFS)}>
        Reset to defaults
      </button>
    </div>
  )
}

export function TopBar() {
  const [menu, setMenu] = useState(false)
  const set = useApp((s) => s.set)
  const chatOpen = useApp((s) => s.chatOpen)
  const controls = useApp((s) => s.controls)
  const openSources = useApp((s) => s.openSources)
  const lastSources = useApp((s) => [...s.messages].reverse().find((m) => m.answer?.sources.length)?.answer?.sources ?? null)
  const api = useApp((s) => s.api)
  const data = useApp((s) => s.data)
  const say = useApp((s) => s.say)
  const d = useDerived()
  const exportCsv = () => {
    if (!d) return
    download(`flame-in-freefall-evidence-${controls.material.replace(/\W+/g, '-').toLowerCase()}.csv`, evidenceCsv(controls, d.rating, d.byId, d.sources))
    say('Evidence exported as CSV')
  }
  const status = !data ? 'Loading data' : !api ? 'Checking assistant' : !api.reachable ? 'Assistant offline · local view' : api.engines.gemini || api.engines.claude ? 'Real NASA data · AI search on' : 'Real NASA data · local answers only'
  return (
    <header className="topbar" data-panel="topbar">
      <div className="brand">
        <span className="logo" aria-hidden />
        <div>
          <h1>Flame in Freefall</h1>
          <p>Evidence finder for fabric and spacecraft fire safety</p>
        </div>
      </div>
      <span className={`status ${api && !api.reachable ? 'off' : 'on'}`} role="status" data-testid="data-status" title={data ? `${data.tests.length} structured tests, ${data.sources.length} sources loaded from data/processed` : undefined}>
        <i aria-hidden /> {status}
      </span>
      <nav aria-label="Main actions">
        <button type="button" className="btn" onClick={() => set({ chatOpen: !chatOpen, mobileTab: 'chat' })} aria-pressed={chatOpen} title="Ask the analyst (press /)">
          <MessageSquareText size={15} aria-hidden /> <span>Ask</span>
        </button>
        <button type="button" className="btn" onClick={exportCsv} disabled={!d} data-testid="export-csv" title="Export the evidence on screen as CSV">
          <Download size={15} aria-hidden /> <span>Export</span>
        </button>
        <button type="button" className="btn" onClick={() => openSources(lastSources)} data-tour="sources">
          <BookOpen size={15} aria-hidden /> <span>Sources</span>
        </button>
        <button type="button" className="btn" onClick={() => set({ aboutOpen: true })}>
          <Info size={15} aria-hidden /> <span>About</span>
        </button>
        <div className="menu-anchor">
          <button type="button" className="btn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="dialog" data-prefs-toggle data-testid="prefs-toggle">
            <Settings2 size={15} aria-hidden /> <span>Personalize</span>
          </button>
          {menu && <PrefsMenu onClose={() => setMenu(false)} />}
        </div>
      </nav>
    </header>
  )
}
