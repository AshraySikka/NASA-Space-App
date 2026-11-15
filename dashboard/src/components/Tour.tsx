import { useEffect, useRef } from 'react'
import { useApp } from '../store'

const STEPS = [
  { title: 'An evidence finder, not a safety certificate', body: 'This tool shows what NASA tested, what was observed, and where nothing has been tested. It never calls a material safe.' },
  { title: 'Set your conditions', body: 'Pick a material, oxygen level, airflow and gravity. The tested range for each material sits next to its name, read straight from the data.' },
  { title: 'Read the evidence rating', body: 'Green, yellow or red is worked out by code from the distance to real tests. The Evidence tab lists those tests, and the Map shows where they sit.' },
  { title: 'Ask the analyst', body: 'Questions are answered only from NASA documents. Every statement carries a numbered source with the page and the exact words quoted.' },
  { title: 'Check any claim yourself', body: 'Open Sources to jump to the NASA page behind a citation. Anything the verifier could not confirm is removed and listed, never hidden.' },
]

export function Tour() {
  const step = useApp((s) => s.tourStep)
  const set = useApp((s) => s.set)
  const end = useApp((s) => s.endTour)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (step == null) return
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && end()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, end])
  if (step == null) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  return (
    <div className="tour" role="dialog" aria-modal="false" aria-label={`Tour step ${step + 1} of ${STEPS.length}`} tabIndex={-1} ref={ref} data-testid="tour">
      <p className="tour-count">
        Step {step + 1} of {STEPS.length}
      </p>
      <h2>{s.title}</h2>
      <p>{s.body}</p>
      <div className="tour-actions">
        <button type="button" className="btn sm" onClick={end} data-testid="tour-skip">
          Skip tour
        </button>
        <span className="spacer" />
        {step > 0 && (
          <button type="button" className="btn sm" onClick={() => set({ tourStep: step - 1 })}>
            Back
          </button>
        )}
        <button type="button" className="btn sm primary" onClick={() => (last ? end() : set({ tourStep: step + 1 }))}>
          {last ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  )
}
