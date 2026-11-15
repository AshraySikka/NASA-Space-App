import { Pause, Play, RotateCcw } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useDerived } from '../hooks'
import { useApp } from '../store'
import { SAMPLE_HALF, type FrontState } from '../viz/Flame'
import { TestChip } from './IdText'

const Scene3D = lazy(() => import('../viz/Scene3D'))

function sceneBackground(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim()
  return v || '#070a0f'
}

export function Simulator() {
  const prefs = useApp((s) => s.prefs)
  const paused = useApp((s) => s.paused)
  const replayKey = useApp((s) => s.replayKey)
  const set = useApp((s) => s.set)
  const d = useDerived()
  const front = useRef<FrontState>({ x: -SAMPLE_HALF, phase: 'burning', doneAt: 0 })
  const [bg, setBg] = useState('#070a0f')

  useEffect(() => {
    front.current = { x: -SAMPLE_HALF, phase: 'burning', doneAt: 0 }
  }, [replayKey, d?.drive.viz.mode])
  useEffect(() => setBg(sceneBackground()), [prefs.theme])

  if (!d) return null
  const { drive } = d
  const still = paused || prefs.reduceMotion
  return (
    <section className="panel scene" data-panel="scene" aria-label="Illustrative flame simulator" data-tour="scene">
      <div className="scene-stage">
        <Suspense fallback={<div className="skeleton scene-skel" aria-label="Loading 3D scene" />}>
          <Scene3D viz={drive.viz} controls={drive.scene} front={front} quality={prefs.quality} paused={still} background={bg} />
        </Suspense>
        <p className="scene-label" data-disclaimer="illustrative">
          Illustrative, not a measurement
        </p>
        {drive.estimate && (
          <p className="scene-estimate" role="status">
            ESTIMATE, NOT MEASURED
          </p>
        )}
        <div className="scene-actions">
          <button type="button" className="icon-btn" onClick={() => set({ paused: !paused })} aria-label={paused ? 'Play animation' : 'Pause animation'} title={paused ? 'Play' : 'Pause'}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button type="button" className="icon-btn" onClick={() => set({ replayKey: replayKey + 1, paused: false })} aria-label="Replay animation" title="Replay">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      <p className="scene-caption">
        {drive.driver ? (
          <>
            {drive.viz.mode === 'ghost' ? 'No flame is drawn: the nearest test, ' : 'The animation follows the outcome recorded for the nearest test, '}
            <TestChip id={drive.driver.test_id} />
            {drive.viz.mode === 'ghost' ? ', has no stated outcome.' : '. Flame size, tilt and colour are artistic cues, not data. The strip is schematic: where the flame stops shows the outcome type only, not time or distance.'}
          </>
        ) : (
          'No flame is drawn: no test of this material is near these conditions.'
        )}
        {prefs.reduceMotion && ' Motion is reduced, so the scene is a still frame.'}
      </p>
    </section>
  )
}
