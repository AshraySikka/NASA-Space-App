import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { num, range } from '../lib/format'
import { useApp } from '../store'

/** About and Methods. Counts, tolerances and DOIs are read from the processed data. */
export function About() {
  const open = useApp((s) => s.aboutOpen)
  const data = useApp((s) => s.data)
  const set = useApp((s) => s.set)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ aboutOpen: false })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, set])
  if (!open || !data) return null
  const cfg = data.ratingConfig
  const local = data.sources.filter((s) => s.local_filename)
  const dois = [...data.cards.flatMap((c) => c.dois.map((d) => ({ label: `${c.study}: ${d.label.replace(' DOI', '')}`, doi: d.doi }))), ...data.sources.filter((s) => s.doi && s.local_filename).map((s) => ({ label: s.title, doi: s.doi as string }))]
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && set({ aboutOpen: false })}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="About and methods" tabIndex={-1} ref={ref}>
        <header>
          <h2>About and methods</h2>
          <button type="button" className="icon-btn" onClick={() => set({ aboutOpen: false })} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <h3>What this is</h3>
          <p>EMBER, Evidence Mapping for Burning Experiments and Research, is a research assistant for fabric and spacecraft fire safety. It answers only from NASA data and documents, cites the source and page, rates how strong the evidence is, and shows where nothing has been tested. Built by Team Apex for NASA Space Apps 2026, “Flame in Freefall”. It is not affiliated with or endorsed by NASA.</p>

          <h3>Data</h3>
          <p>
            {data.tests.length} structured test rows across {data.ranges.series.join(', ')}; {local.length} local source files; {data.cards.length} research cards. Gravity labels present: {data.ranges.gravity_labels.join(', ')}. Rows with a published flame spread rate:{' '}
            {data.ranges.n_spread_rates_published}.
          </p>
          <table className="plain">
            <thead>
              <tr>
                <th>Material</th>
                <th>Series</th>
                <th>Tests</th>
                <th>Reviewed rows</th>
              </tr>
            </thead>
            <tbody>
              {data.ranges.materials.flatMap((m) =>
                m.series.map((s) => (
                  <tr key={m.material_group + s.series}>
                    <td>{m.material_group}</td>
                    <td>{s.series}</td>
                    <td className="mono">{s.n_tests}</td>
                    <td className="mono">{(s.evidence_roles.verified ?? 0) + (s.evidence_roles['published-event'] ?? 0)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <p className="hint">Tested oxygen and airflow ranges are shown next to the material selector. “Reviewed rows” were checked against a page of the NASA report; the rest are context rows from the raw PSI-25 table.</p>

          <h3>Evidence tiers</h3>
          <ul>
            <li><b>Tier 1, local verified:</b> from a file in the local corpus, page-referenced.</li>
            <li><b>Tier 2, NASA web:</b> found on an allowlisted NASA site and confirmed by the backend, which fetches the page itself and looks for the quote.</li>
            <li><b>Tier 3, context:</b> allowlisted background such as JAXA, or anything whose source document is not in the local corpus. Never used for numbers about the fabrics.</li>
          </ul>

          <h3>How the rating works</h3>
          <p>
            Code compares your conditions with tests of the exact same material. Green: a test within ±{num(cfg.match_o2_points)} oxygen points and ±{num(cfg.match_flow_cm_s)} cm/s, with published airflow. Yellow: a test within ±{num(cfg.near_o2_points)} oxygen points and ±
            {num(cfg.near_flow_cm_s)} cm/s, or a match on oxygen whose airflow or pressure cannot be confirmed. Red: nothing that close, a gravity level that was never tested, or a pressure more than {num(cfg.far_pressure_kpa)} kPa away. Airflow is treated as a path from
            start flow to final flow. The language model can explain a rating but cannot change it.
          </p>

          <h3>How answers are checked</h3>
          <p>The model sees only retrieved passages. Each statement must quote its source word for word. Backend code then checks that the quote is in the cited passage, that every number in the statement appears in the quote or the cited test row, and that web sources are on the allowlist and still contain the quote. Statements that fail are removed and listed under “Removed unverified statements”.</p>

          <h3>What this tool cannot do</h3>
          <ul>
            <li>It cannot say a material is safe, and it does not recommend materials.</li>
            <li>It has no partial-gravity measurements. Moon and Mars questions get the nearest microgravity evidence and a red rating.</li>
            <li>It shows no flame spread rates, because the structured data records outcomes, not rates.</li>
            <li>The 3D flame is an illustration of a recorded outcome. Its size, tilt and colour are not measurements.</li>
            <li>Small-sample tests ({range(data.ranges.all.o2_pct_initial)}% oxygen overall) do not describe clothing, full products or a habitat.</li>
          </ul>

          <h3>Dataset identifiers found in the source files</h3>
          <ul className="mono small">
            {dois.map((d) => (
              <li key={d.doi}>
                {d.label}: <a href={`https://doi.org/${d.doi}`} target="_blank" rel="noopener noreferrer">{d.doi}</a>
              </li>
            ))}
          </ul>

          <h3>Use of AI</h3>
          <p>Claude and Gemini help retrieve and draft answers, and AI assistance was used to write the code. Backend code, not a model, computes every rating and verifies every statement against its source before it is shown.</p>

          <h3>Licensing</h3>
          <p>NASA’s Physical Sciences Informatics (PSI) repository is open data; its open-data registry entry states there are no restrictions on use. Check the licence shown on each PSI record before reuse. NASA reports are cited and linked, not redistributed. No NASA logo or insignia is used.</p>
        </div>
      </div>
    </div>
  )
}
