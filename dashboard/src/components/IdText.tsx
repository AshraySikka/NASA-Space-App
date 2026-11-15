import { TEST_ID } from '../lib/format'
import { useApp } from '../store'

/** Short chip for a test id. Detail for the test lives in the Evidence panel only. */
export function TestChip({ id }: { id: string }) {
  const focusTest = useApp((s) => s.focusTest)
  return (
    <button type="button" data-chip className="chip mono" onClick={() => focusTest(id)} title={`Show ${id} in the Evidence panel`} aria-label={`Show test ${id} in the Evidence panel`}>
      {id}
    </button>
  )
}

/** Renders text, turning any known test id into a chip so the id is never repeated as plain text. */
export function IdText({ text, known }: { text: string; known: Set<string> | Map<string, unknown> }) {
  const parts: (string | { id: string })[] = []
  let last = 0
  for (const m of text.matchAll(TEST_ID)) {
    if (!known.has(m[0])) continue
    parts.push(text.slice(last, m.index), { id: m[0] })
    last = (m.index ?? 0) + m[0].length
  }
  parts.push(text.slice(last))
  return <>{parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <TestChip key={i} id={p.id} />))}</>
}
