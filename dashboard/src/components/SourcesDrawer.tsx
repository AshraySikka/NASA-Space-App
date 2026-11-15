import { ExternalLink, FileText, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { API_BASE } from '../lib/api'
import type { ChatSource } from '../lib/types'
import { useApp } from '../store'

const NO_SOURCES: never[] = []
const TIER = { 1: 'Tier 1 · Local verified', 2: 'Tier 2 · NASA web', 3: 'Tier 3 · Context' } as const

/** The one place a citation is shown in full. Chips elsewhere only point here. */
export function SourcesDrawer() {
  const drawer = useApp((s) => s.drawer)
  const registry = useApp((s) => s.data?.sources ?? NO_SOURCES)
  const set = useApp((s) => s.set)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => set({ drawer: { ...drawer, open: false } })
  useEffect(() => {
    if (!drawer.open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer.open])
  useEffect(() => {
    if (drawer.open && drawer.focus != null) document.getElementById(`src-${drawer.focus}`)?.scrollIntoView?.({ block: 'center' })
  }, [drawer])
  if (!drawer.open) return null
  const list: ChatSource[] | null = drawer.sources
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Sources" tabIndex={-1} ref={ref}>
        <header>
          <h2>{list ? 'Sources for this answer' : 'Source registry'}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close sources">
            <X size={16} />
          </button>
        </header>
        {list ? (
          <ol className="src-list">
            {list.map((s) => (
              <li key={s.n} id={`src-${s.n}`} className={drawer.focus === s.n ? 'src focus' : 'src'}>
                <div className="src-top">
                  <span className={`cite t${s.tier}`}>{s.n}</span>
                  <span className={`tier t${s.tier}`}>{TIER[s.tier]}</span>
                </div>
                <h3>{s.title}</h3>
                <p className="meta">
                  {[s.publisher, s.year, s.pdf_page ? `PDF page ${s.pdf_page}${s.printed_page && String(s.printed_page) !== String(s.pdf_page) ? ` (printed page ${s.printed_page})` : ''}` : null, s.test_id ? `test ${s.test_id}` : null].filter(Boolean).join(' · ')}
                </p>
                {s.via && <p className="meta">Read through: {s.via}</p>}
                {s.notes && <p className="meta note-line">{s.notes}</p>}
                {s.extraction === 'ocr' && <p className="meta note-line">This page was read by OCR, so the quote is checked against the OCR text.</p>}
                {s.quotes.map((q, i) => (
                  <blockquote key={i}>“{q}”</blockquote>
                ))}
                {s.review_wording && <p className="meta note-line">This quote is the team review sheet's summary of the cited page, not NASA's own wording. Open the page to read the original.</p>}
                {s.live_check && <p className="meta">Verifier: {s.live_check}</p>}
                {s.doi && <p className="meta mono">doi:{s.doi}</p>}
                <div className="src-actions">
                  {s.url && (
                    <a className="btn sm primary" href={s.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={13} aria-hidden /> Open at the source
                    </a>
                  )}
                  {s.local_pdf && (
                    <a className="btn sm" href={`${API_BASE}${s.local_pdf}`} target="_blank" rel="noopener noreferrer">
                      <FileText size={13} aria-hidden /> Local PDF, page {s.pdf_page}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <>
            <p className="hint">Every document the tool can cite. Ask a question to see the exact pages and quotes behind an answer.</p>
            <ul className="src-list">
              {registry.map((s) => (
                <li key={s.id} className="src">
                  <div className="src-top">
                    <span className={`tier t${s.tier}`}>{TIER[s.tier]}</span>
                    <span className="meta">{s.document_type}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p className="meta">{[s.publisher, s.year].filter(Boolean).join(' · ')}</p>
                  {s.notes && <p className="meta note-line">{s.notes}</p>}
                  {s.doi && <p className="meta mono">doi:{s.doi}</p>}
                  <div className="src-actions">
                    <a className="btn sm" href={s.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={13} aria-hidden /> Open at the source
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}
