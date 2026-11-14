// Right panel app: airflow sliders, live 3D flame scene, and charts, all
// derived from one zustand store. The SI analyst chat pane arrives with
// Phase 4 and is intentionally absent here.

import { useEffect, useMemo, useRef } from 'react'
import { ControlBar } from './components/ControlBar'
import { HeroCurve } from './components/HeroCurve'
import { RegimeMap } from './components/RegimeMap'
import { VerdictBars } from './components/VerdictBars'
import { GravityBounds } from './components/GravityBounds'
import { SidePanel } from './components/SidePanel'
import { Scene3D } from './viz/Scene3D'
import { SAMPLE_HALF, type FrontState } from './viz/Flame'
import { evaluateState } from './viz/engine'
import { useApp } from './viz/state'

export default function App() {
  const { controls, tests, activeTestId, setActiveTest } = useApp()
  const viz = useMemo(() => evaluateState(controls, tests), [controls, tests])
  const activeTest = tests.find((t) => t.test_id === activeTestId) ?? null

  // The flame front lives above Scene3D so any future chart markers can
  // share one sweep state. Changing material starts a fresh test run.
  const front = useRef<FrontState>({ x: -SAMPLE_HALF, phase: 'burning', doneAt: 0 })
  useEffect(() => {
    front.current = { x: -SAMPLE_HALF, phase: 'burning', doneAt: 0 }
  }, [controls.material])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-100">
            Microgravity Fabric Flammability Analyzer
          </h1>
          <p className="text-xs text-slate-500">
            How does airflow change the way fire spreads across this fabric in space? NASA Space
            Apps 2026.
          </p>
        </div>
        <div className="rounded border border-amber-600/50 bg-amber-950/60 px-2 py-1 text-[10px] text-amber-400">
          SYNTHETIC CORPUS (mock data, PSI swap pending)
        </div>
      </header>

      {/* single column: sliders, then 3D scene, then charts. The SI analyst
          pane joins on the left in Phase 4 */}
      <main className="flex min-h-0 flex-1 flex-col gap-3">
        <ControlBar />
        <div className="min-h-[320px] flex-[3]">
          <Scene3D viz={viz} controls={controls} onCite={setActiveTest} front={front} />
        </div>
        <div className="grid min-h-0 flex-[2] grid-cols-1 content-start gap-3 overflow-y-auto pb-1 xl:grid-cols-2">
          <div className="h-64">
            <HeroCurve viz={viz} controls={controls} tests={tests} onPick={setActiveTest} />
          </div>
          <div className="h-64">
            <RegimeMap viz={viz} controls={controls} tests={tests} onPick={setActiveTest} />
          </div>
          <VerdictBars controls={controls} tests={tests} />
          <GravityBounds viz={viz} controls={controls} />
          <div className="xl:col-span-2">
            <SidePanel viz={viz} activeTest={activeTest} tests={tests} />
          </div>
        </div>
      </main>
    </div>
  )
}
