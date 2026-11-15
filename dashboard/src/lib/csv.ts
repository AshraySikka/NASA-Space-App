import type { Controls, Rating, Source, TestRow } from './types'

const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  // quote everything and neutralise spreadsheet formulas
  return `"${(/^[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`
}

/** CSV of the evidence currently on screen: conditions, rating, nearest tests, outcomes, sources, pages, tier. */
export function evidenceCsv(c: Controls, r: Rating, byId: Map<string, TestRow>, sources: Map<string, Source>): string {
  const head = ['query_material', 'query_o2_pct', 'query_flow_cm_s', 'query_pressure_kpa', 'query_gravity', 'evidence_rating', 'rating_code', 'rating_reason', 'test_id', 'series', 'material_label', 'test_o2_pct_initial', 'test_flow_start_cm_s', 'test_flow_end_cm_s',
    'flow_basis', 'test_pressure_kpa', 'gravity_label', 'outcome_class', 'outcome_text', 'distance_o2_points', 'distance_flow_cm_s', 'distance_pressure_kpa', 'conflict', 'anomaly_flags', 'review_note', 'source_id', 'source_title', 'source_url', 'pdf_page', 'printed_page', 'tier']
  const rows = r.nearest.map((n) => {
    const t = byId.get(n.test_id) as TestRow
    const s = sources.get(t.source_id)
    return [c.material, c.o2_pct, c.flow_cm_s, c.pressure_kpa, c.gravity, r.label, r.code, r.reasons[0], t.test_id, t.series, t.material, t.o2_pct_initial, t.flow_start_cm_s, t.flow_end_cm_s, t.flow_basis, t.pressure_kpa, t.gravity_label,
      t.outcome_class, t.outcome_text, n.d_o2, n.d_flow, n.d_pressure, t.conflict ? 'conflict' : '', t.anomaly_flags.join('; '), t.review_note, t.source_id, s?.title, s?.url, t.pdf_page, t.printed_page, t.tier]
  })
  if (!rows.length) rows.push([c.material, c.o2_pct, c.flow_cm_s, c.pressure_kpa, c.gravity, r.label, r.code, r.reasons[0], ...Array(head.length - 8).fill('')])
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function download(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.dataset.testid = 'csv-download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function testCitation(t: TestRow, s: Source | undefined): string {
  const page = t.pdf_page ? `, PDF p.${t.pdf_page}${t.printed_page && t.printed_page !== t.pdf_page ? ` (printed p.${t.printed_page})` : ''}` : ''
  return `${t.test_id}: ${s?.title ?? t.source_id}${s?.year ? ` (${s.year})` : ''}${page}. ${s?.publisher ?? ''}. ${s?.url ?? ''}${s?.doi ? ` doi:${s.doi}` : ''}`.replace(/\s+/g, ' ').trim()
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
