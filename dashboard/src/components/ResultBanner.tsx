import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { designSentence } from '../engine/rating'
import { useDerived } from '../hooks'
import { num } from '../lib/format'
import { useApp } from '../store'
import { IdText } from './IdText'

const ICON = { GREEN: CircleCheck, YELLOW: TriangleAlert, RED: CircleAlert }

/** The one place the evidence rating and the driving outcome class are stated. */
export function ResultBanner() {
  const cfg = useApp((s) => s.data!.ratingConfig)
  const map = useApp((s) => s.data!.outcomeMap)
  const expert = useApp((s) => s.prefs.explain === 'expert')
  const d = useDerived()
  if (!d) return null
  const { rating, drive, byId } = d
  const known = new Set(d.material.test_ids)
  const Icon = ICON[rating.level]
  const fam = drive.driver ? map.families[drive.family] : null
  return (
    <section className={`panel result lvl-${rating.level.toLowerCase()}`} data-panel="result" aria-live="polite" aria-label="Evidence rating" data-tour="result">
      <div className="result-head">
        <span className="badge" data-testid="rating-badge">
          <Icon size={16} aria-hidden /> {rating.label}
        </span>
        {drive.driver && (
          <span className="outcome">
            <i className="dot" style={{ background: fam?.color }} aria-hidden />
            Nearest recorded outcome: <b>{drive.driver.outcome_text}</b>
            {expert && <code className="mono cls">{drive.driver.outcome_class}</code>}
          </span>
        )}
      </div>
      <p className="reason">
        <IdText text={rating.reasons[0]} known={known} />
      </p>
      <p className="design">
        <IdText text={designSentence(rating, byId)} known={known} />
      </p>
      <p className="hint">
        How the rating is decided: green needs a test of this exact material within ±{num(cfg.match_o2_points)} oxygen points and ±{num(cfg.match_flow_cm_s)} cm/s (a point anywhere on a test's start-to-final airflow path counts as on it). Yellow means a test within ±
        {num(cfg.near_o2_points)} oxygen points and ±{num(cfg.near_flow_cm_s)} cm/s. Otherwise red. Computed by code from {rating.n_material_tests} rows; no AI is involved.
        {expert && ` Pressure: match within ±${num(cfg.match_pressure_kpa)} kPa, far beyond ${num(cfg.far_pressure_kpa)} kPa. Rating code: ${rating.code}.`}
      </p>
    </section>
  )
}
