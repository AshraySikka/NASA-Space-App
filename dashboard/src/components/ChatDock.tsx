import { ArrowUp, Copy, Globe, Quote, SlidersHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/csv'
import { num } from '../lib/format'
import type { ChatAnswer, ChatSource } from '../lib/types'
import { useApp, type Message } from '../store'

// Example questions come from the brief; none of them contains a data value we would have to keep in sync.
const EXAMPLES = ['Will this burn on the Moon?', 'What happened to SIBAL at 18.7% oxygen?', 'Which tests are closest to 30% oxygen?', 'Compare Nomex and SIBAL', 'What has NASA not tested?']

function bibliography(sources: ChatSource[]): string {
  return sources
    .map((s) => `[${s.n}] ${s.title}${s.year ? ` (${s.year})` : ''}. ${s.publisher ?? ''}.${s.pdf_page ? ` PDF p.${s.pdf_page}.` : ''} ${s.url ?? ''}${s.doi ? ` doi:${s.doi}` : ''} (Tier ${s.tier})`.replace(/\s+/g, ' ').trim())
    .join('\n')
}
function plainAnswer(a: ChatAnswer, withBib: boolean): string {
  const lines = [a.summary, '', ...a.claims.map((c) => `- ${c.text} ${c.cite.map((n) => `[${n}]`).join('')}`)]
  if (a.gaps.length) lines.push('', 'Gaps:', ...a.gaps.map((g) => `- ${g}`))
  if (withBib && a.sources.length) lines.push('', 'Sources:', bibliography(a.sources))
  return lines.join('\n')
}

function Cite({ n, sources }: { n: number; sources: ChatSource[] }) {
  const open = useApp((s) => s.openSources)
  const s = sources.find((x) => x.n === n)
  return (
    <button type="button" data-chip className={`cite t${s?.tier ?? 3}`} onClick={() => open(sources, n)} aria-label={`Source ${n}: ${s?.title ?? ''}, tier ${s?.tier ?? ''}. Open in Sources.`} title={`${s?.title ?? ''}${s?.pdf_page ? `, p.${s.pdf_page}` : ''} · Tier ${s?.tier}`}>
      {n}
    </button>
  )
}

function Clarify({ a, latest }: { a: ChatAnswer; latest: boolean }) {
  const ask = useApp((s) => s.ask)
  const busy = useApp((s) => s.busy)
  const c = a.clarify!
  return (
    <div className="answer clarify" data-testid="clarify">
      <p className="summary">{c.prompt}</p>
      <div className="options" role="group" aria-label="Choose an answer">
        {c.options.map((o) => (
          <button key={o.label} type="button" className="example" disabled={busy || !latest} onClick={() => void ask(o.ask)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="hint">{c.hint}</p>
    </div>
  )
}

function Answer({ m }: { m: Message }) {
  const a = m.answer as ChatAnswer
  const apply = useApp((s) => s.applyConditions)
  const feedback = useApp((s) => s.setFeedback)
  const say = useApp((s) => s.say)
  const open = useApp((s) => s.openSources)
  const expert = useApp((s) => s.prefs.explain === 'expert')
  const r = a.rating
  return (
    <div className="answer">
      {a.notice && <p className="redirect">{a.notice}</p>}
      <p className={a.found ? 'summary' : 'summary notfound'} data-testid="answer-summary">
        {a.summary}
      </p>
      {r && (
        <div className={`rating-inline lvl-${r.level.toLowerCase()}`}>
          <span className="badge">{r.label}</span>
          <span className="mono small">
            {r.nearest.slice(0, 3).map((n) => `${n.test_id}: ΔO₂ ${n.d_o2 == null ? 'n/a' : num(n.d_o2, 2)}${n.d_flow != null ? `, Δflow ${num(n.d_flow, 1)}` : ''}${n.d_pressure != null ? `, ΔP ${num(n.d_pressure, 1)}` : ''}`).join(' · ')}
          </span>
        </div>
      )}
      {a.claims.length > 0 && (
        <ul className="claims">
          {a.claims.map((c, i) => (
            <li key={i} className={c.extractive ? 'verbatim' : undefined}>
              {c.extractive && <Quote size={12} aria-label="Quoted word for word" />}
              <span>{c.extractive ? `“${c.text}”` : c.text}</span>{' '}
              {c.cite.map((n) => (
                <Cite key={n} n={n} sources={a.sources} />
              ))}
            </li>
          ))}
        </ul>
      )}
      {a.design_note && <p className="design">{a.design_note}</p>}
      {a.gaps.length > 0 && (
        <div className="gaps">
          <h4>Gaps</h4>
          <ul>
            {a.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {!a.found && a.searched.length > 0 && (
        <div className="gaps">
          <h4>What was searched</h4>
          <ul>
            {a.searched.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {a.notices.map((n, i) => (
        <p key={i} className="notice">
          {n}
        </p>
      ))}
      {a.removed.length > 0 && (
        <details className="removed">
          <summary>Removed unverified statements ({a.removed.length})</summary>
          <ul>
            {a.removed.map((x, i) => (
              <li key={i}>
                <s>{x.text}</s>
                <br />
                <small>Why: {x.reasons.join('; ')}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
      {expert && a.verifier.length > 0 && (
        <details className="removed">
          <summary>Verifier log ({a.verifier.filter((v) => v.passed).length} passed, {a.verifier.filter((v) => !v.passed).length} removed)</summary>
          <ul>
            {a.verifier.map((v, i) => (
              <li key={i}>
                <small>
                  {v.passed ? 'PASS' : 'FAIL'} · {v.match ?? v.reasons.join('; ')}
                  {v.live_check ? ` · ${v.live_check}` : ''} · {v.claim.slice(0, 90)}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="answer-foot">
        <span className="engine" title={a.searched.join('\n')}>
          Answered by: {a.engine}
        </span>
        {a.applied_conditions && (
          <button type="button" className="btn sm primary" onClick={() => apply(a.applied_conditions!)} data-testid="apply-sim">
            <SlidersHorizontal size={13} aria-hidden /> Apply to simulator
          </button>
        )}
        {a.sources.length > 0 && (
          <button type="button" className="btn sm" onClick={() => open(a.sources)}>
            Sources ({a.sources.length})
          </button>
        )}
        <button type="button" className="icon-btn sm" aria-label="Copy answer" title="Copy answer" onClick={async () => say((await copyText(plainAnswer(a, false))) ? 'Answer copied' : 'Copy failed')}>
          <Copy size={14} />
        </button>
        <button type="button" className="btn sm" onClick={async () => say((await copyText(plainAnswer(a, true))) ? 'Answer and bibliography copied' : 'Copy failed')}>
          Copy with bibliography
        </button>
        <button type="button" className={m.feedback === 'up' ? 'icon-btn sm on' : 'icon-btn sm'} aria-label="Helpful" aria-pressed={m.feedback === 'up'} title="Helpful (saved in this browser only)" onClick={() => feedback(m.id, 'up')}>
          <ThumbsUp size={14} />
        </button>
        <button type="button" className={m.feedback === 'down' ? 'icon-btn sm on' : 'icon-btn sm'} aria-label="Not helpful" aria-pressed={m.feedback === 'down'} title="Not helpful (saved in this browser only)" onClick={() => feedback(m.id, 'down')}>
          <ThumbsDown size={14} />
        </button>
      </div>
    </div>
  )
}

export function ChatDock() {
  const messages = useApp((s) => s.messages)
  const busy = useApp((s) => s.busy)
  const live = useApp((s) => s.live)
  const api = useApp((s) => s.api)
  const ask = useApp((s) => s.ask)
  const set = useApp((s) => s.set)
  const reduce = useApp((s) => s.prefs.reduceMotion)
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: reduce ? 'auto' : 'smooth' })
  }, [messages, reduce])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '')) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const send = (q: string) => {
    if (!q.trim() || busy) return
    setText('')
    void ask(q)
  }
  const noKeys = api?.reachable && !api.engines.gemini && !api.engines.claude
  return (
    <section className="chat" data-panel="chat" aria-label="AI analyst" data-tour="chat">
      <div className="panel-head">
        <h2>AI analyst</h2>
        <span className="hint">Answers only from NASA sources, with citations</span>
      </div>
      {api && !api.reachable && <p className="notice err" role="status">The assistant's server is not reachable, so questions cannot be answered right now. The simulator, map and library still work.</p>}
      {noKeys && <p className="notice" role="status">Running on local data only: no AI keys are set on the server. Answers are assembled word for word from the local NASA corpus, and live NASA search is off.</p>}
      <div className="thread" role="log" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && (
          <div className="welcome">
            <p>Ask what NASA tested, what was observed, and where nothing has been tested. Every statement links to its source and page. This is an evidence finder. It does not certify any material.</p>
            <div className="examples">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" className="example" onClick={() => send(q)} disabled={busy}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="msg bot">
              {m.pending && (
                <>
                  <p className="progress" role="status">
                    <span className="spinner" aria-hidden /> {m.status}
                  </p>
                  {m.text ? <p className="summary">{m.text}</p> : <div className="skeleton lines" aria-hidden />}
                </>
              )}
              {m.error && (
                <p className="notice err" role="alert">
                  {m.error}
                </p>
              )}
              {m.answer && (m.answer.clarify ? <Clarify a={m.answer} latest={m.id === messages[messages.length - 1]?.id} /> : <Answer m={m} />)}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Ask a question about NASA fire safety data
        </label>
        <textarea id="ask" ref={inputRef} rows={3} value={text} placeholder="Ask about a material, oxygen level, airflow or gravity…  (press / to focus)" onChange={(e) => setText(e.target.value)} maxLength={2000}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(text)
            }
          }} />
        <div className="composer-foot">
          <label className="check sm" title="Also search allowlisted NASA sites live. Needs an AI key on the server.">
            <input type="checkbox" checked={live} onChange={(e) => set({ live: e.target.checked })} /> <Globe size={13} aria-hidden /> Search NASA live
          </label>
          <button type="submit" className="btn primary" disabled={busy || !text.trim()} aria-label="Send question">
            <ArrowUp size={15} aria-hidden /> Ask
          </button>
        </div>
      </form>
    </section>
  )
}
