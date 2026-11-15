import { ClipboardCopy, ExternalLink, FileText } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useDerived } from '../hooks'
import { API_BASE } from '../lib/api'
import { copyText, testCitation } from '../lib/csv'
import { flowPath, num } from '../lib/format'
import type { Measure, Source, TestRow } from '../lib/types'
import { useApp } from '../store'
import { MarkerIcon } from './Marker'

function TierBadge({ tier }: { tier: number }) {
  return <span className={`tier t${tier}`}>{tier === 1 ? 'Tier 1 · local verified' : tier === 2 ? 'Tier 2 · NASA web' : 'Tier 3 · context'}</span>
}

function Detail({ t, s, localPdf }: { t: TestRow; s: Source | undefined; localPdf: boolean }) {
  return (
    <div className="ev-detail">
      {t.conflict && <p className="flag conflict">Conflict: sources disagree on {t.conflicts.map((c) => String(c.field)).join(', ')}. Both values are stored; the page-referenced report value is preferred. {t.conflicts.map((c) => String(c.why)).join(' ')}</p>}
      {t.anomaly_flags.length > 0 && <p className="flag anomaly">Flagged value, never plotted: {t.anomaly_flags.join('; ')}.</p>}
      {t.what_happened && (
        <p>
          <b>What happened:</b> {t.what_happened}
        </p>
      )}
      {t.report_observation && (
        <p>
          <b>NASA report observation (verbatim):</b> “{t.report_observation}”
        </p>
      )}
      {t.published_comment && (
        <p>
          <b>Report table comment:</b> “{t.published_comment}”
        </p>
      )}
      <p>
        <b>Review note:</b> {t.review_note}
      </p>
      {t.data_qualification && (
        <p>
          <b>Data qualification:</b> {t.data_qualification}
        </p>
      )}
      <p className="ev-source">
        <TierBadge tier={t.tier} />
        <span>
          {s?.title ?? t.source_id}
          {s?.year ? ` (${s.year})` : ''}
          {t.pdf_page ? `, PDF p.${t.pdf_page}` : ''}
          {t.printed_page && t.printed_page !== t.pdf_page ? ` (printed p.${t.printed_page})` : ''}
          {s?.notes ? ` · ${s.notes}` : ''}
        </span>
        {s?.url && (
          <a className="btn sm" href={s.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} aria-hidden /> NASA source
          </a>
        )}
        {localPdf && s?.local_filename?.toLowerCase().endsWith('.pdf') && t.pdf_page && (
          <a className="btn sm" href={`${API_BASE}/sources/${s.id}#page=${t.pdf_page}`} target="_blank" rel="noopener noreferrer">
            <FileText size={13} aria-hidden /> Local PDF at page
          </a>
        )}
      </p>
    </div>
  )
}

/** Owner of the nearest-test detail. Other panels only show chips that point here. */
export function EvidencePanel() {
  const data = useApp((s) => s.data)!
  const prefs = useApp((s) => s.prefs)
  const api = useApp((s) => s.api)
  const focusId = useApp((s) => s.focusTestId)
  const say = useApp((s) => s.say)
  const d = useDerived()
  const focusRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (focusId && focusRef.current) {
      focusRef.current.open = true
      focusRef.current.scrollIntoView({ block: 'nearest', behavior: prefs.reduceMotion ? 'auto' : 'smooth' })
    }
  }, [focusId, prefs.reduceMotion])
  if (!d) return null
  const { rating, byId, sources } = d
  const expert = prefs.explain === 'expert'
  const rows: { t: TestRow; m: Measure | null }[] = rating.nearest.map((m) => ({ t: byId.get(m.test_id) as TestRow, m }))
  if (focusId && byId.has(focusId) && !rows.some((r) => r.t.test_id === focusId)) rows.unshift({ t: byId.get(focusId) as TestRow, m: null })
  const fam = (t: TestRow) => data.outcomeMap.families[data.outcomeMap.classes.find((c) => c.outcome_text === t.outcome_text)?.family ?? 'unknown']
  const copy = async () => {
    const ok = await copyText(rows.map((r) => testCitation(r.t, sources.get(r.t.source_id))).join('\n'))
    say(ok ? 'Citations copied' : 'Copy failed')
  }
  return (
    <section className="evidence" data-panel="evidence" aria-label="Nearest tests">
      <div className="panel-head">
        <h2>Nearest tests</h2>
        <button type="button" className="btn sm" onClick={copy}>
          <ClipboardCopy size={13} aria-hidden /> Copy citations
        </button>
      </div>
      <p className="hint">Closest {rating.material} tests to the simulator's conditions, nearest first. Airflow is shown as a path because many tests changed it mid-run. A blank ending is unknown. It is never read as “burned out” or “extinguished”.</p>
      {rows.length === 0 && <p className="empty">No structured test of this material is in the corpus.</p>}
      <ul className="ev-list">
        {rows.map(({ t, m }) => {
          const f = fam(t)
          return (
            <li key={t.test_id}>
              <details ref={t.test_id === focusId ? focusRef : undefined} className={t.test_id === focusId ? 'ev focus' : 'ev'}>
                <summary>
                  <span className="ev-id mono">{t.test_id}</span>
                  <span className="ev-main">
                    <span className="ev-out">
                      <MarkerIcon shape={f.marker} color={f.color} /> {t.outcome_text}
                    </span>
                    <span className="ev-cond mono">
                      {t.material} · O₂ {t.o2_pct_initial == null ? 'n/a' : num(t.o2_pct_initial)} vol% · {flowPath(t, prefs.flowUnit)}
                      {t.pressure_kpa != null ? ` · ${num(t.pressure_kpa)} kPa` : ''} · {t.series}
                    </span>
                    {expert && (
                      <span className="ev-cond mono">
                        {t.outcome_class} · {t.gravity_label} · flow basis: {t.flow_basis}
                        {t.width_cm != null ? ` · width ${num(t.width_cm)} cm` : ''}
                        {t.reused ? ' · reused sample' : ''}
                      </span>
                    )}
                  </span>
                  <span className="ev-dist mono">
                    {m ? (
                      <>
                        <span>ΔO₂ {m.d_o2 == null ? 'n/a' : num(m.d_o2, 2)}</span>
                        <span>Δflow {m.d_flow == null ? 'n/a' : num(m.d_flow, 1)}</span>
                        {m.d_pressure != null && <span>ΔP {num(m.d_pressure, 1)}</span>}
                      </>
                    ) : (
                      <span>selected</span>
                    )}
                  </span>
                  {t.conflict && <span className="pill warn">conflict</span>}
                </summary>
                <Detail t={t} s={sources.get(t.source_id)} localPdf={!!api?.raw_pdfs_available} />
              </details>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
