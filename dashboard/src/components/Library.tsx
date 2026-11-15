import { ExternalLink, MessageSquareText } from 'lucide-react'
import { useApp } from '../store'

/** Experiment Library: the research cards from cards.json. */
export default function Library() {
  const cards = useApp((s) => s.data!.cards)
  const ask = useApp((s) => s.ask)
  const set = useApp((s) => s.set)
  const expert = useApp((s) => s.prefs.explain === 'expert')
  return (
    <section className="library" data-panel="library" aria-label="Experiment library">
      <div className="panel-head">
        <h2>Experiment library</h2>
      </div>
      <p className="hint">{cards.length} NASA investigations summarised by the team, each linked to its NASA source. Studies that did not burn fabric or plastic sheet are labelled.</p>
      <div className="cards">
        {cards.map((c) => {
          const links = c.source_links.filter((l, i, a) => a.findIndex((x) => x.url === l.url) === i)
          return (
            <article key={c.study} className="card">
              <header>
                <h3>{c.study}</h3>
                <span className={c.is_fabric_study ? 'pill' : 'pill warn'}>{c.is_fabric_study ? 'Solid fuel study' : `Not a fabric study: ${c.evidence_kind}`}</span>
              </header>
              <p className="aim">{c.aim}</p>
              <dl>
                <dt>Where</dt>
                <dd>{c.location}</dd>
                <dt>Data available</dt>
                <dd>{c.data_available}</dd>
                <dt>Important limit</dt>
                <dd>{c.important_limit}</dd>
                {c.dois.length > 0 && (
                  <>
                    <dt>Dataset DOI</dt>
                    <dd className="mono">
                      {c.dois.map((d) => (
                        <a key={d.doi} href={`https://doi.org/${d.doi}`} target="_blank" rel="noopener noreferrer" title={d.label}>
                          {d.doi}
                        </a>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
              {(expert || c.limits.length > 0) && (
                <details>
                  <summary>{expert ? 'All fields and limits' : `More limits (${c.limits.length})`}</summary>
                  {expert && (
                    <dl>
                      {c.fields.map((f, i) => (
                        <div key={i} className="kv">
                          <dt>{f.field}</dt>
                          <dd>
                            {f.note}
                            {f.value != null ? ` (${f.value} ${f.unit ?? ''})` : ''}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <ul>
                    {c.limits.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              )}
              <footer>
                {links.slice(0, 3).map((l) => (
                  <a key={l.url} className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} aria-hidden /> {l.source_ref}
                  </a>
                ))}
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => {
                    set({ mobileTab: 'chat', chatOpen: true })
                    void ask(`What did the ${c.study} investigation study, and what are its limits?`)
                  }}
                >
                  <MessageSquareText size={13} aria-hidden /> Ask the assistant about this
                </button>
              </footer>
            </article>
          )
        })}
      </div>
    </section>
  )
}
