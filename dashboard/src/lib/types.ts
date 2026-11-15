// Shapes of data/processed/*.json (written by scripts/ingest/ingest.py).

export interface TestRow {
  test_id: string
  series: string
  material: string
  material_group: string
  o2_pct_initial: number | null
  o2_pct_final: number | null
  pressure_kpa: number | null
  flow_start_cm_s: number | null
  flow_end_cm_s: number | null
  flow_basis: string
  raw_air_display: string | null
  width_cm: number | null
  gravity_label: string
  outcome_class: string
  outcome_text: string
  what_happened: string | null
  published_comment: string | null
  report_observation: string | null
  spread_rate_mm_s: number | null
  source_id: string
  pdf_page: number | null
  printed_page: number | null
  review_note: string
  data_qualification: string
  reused: boolean | null
  listed_quenched: boolean
  anomaly_flags: string[]
  conflict: boolean
  conflicts: Record<string, unknown>[]
  evidence_role: 'verified' | 'context' | 'published-event'
  tier: 1 | 2 | 3
}

export interface MinMax { min: number; max: number; n: number }
export interface RangeStats {
  n_tests: number
  o2_pct_initial: MinMax | null
  flow_start_cm_s: MinMax | null
  flow_end_cm_s: MinMax | null
  flow_any_cm_s: MinMax | null
  pressure_kpa: MinMax | null
  n_flow_changed: number
  flow_basis: string[]
  outcomes: Record<string, number>
  n_listed_quenched: number
  n_anomaly_flagged: number
  n_conflict: number
  evidence_roles: Record<string, number>
  gravity_labels: string[]
  test_ids: string[]
}
export interface MaterialRange extends RangeStats {
  material_group: string
  labels: string[]
  series: (RangeStats & { series: string })[]
}
export interface Ranges {
  all: RangeStats
  materials: MaterialRange[]
  series: string[]
  gravity_labels: string[]
  n_spread_rates_published: number
}

export interface Source {
  id: string
  title: string
  publisher: string
  year: number | null
  document_type: string
  url: string
  pdf_url: string | null
  doi: string | null
  local_filename: string | null
  tier: 1 | 2 | 3
  notes: string | null
  snapshot_read_on?: string
}

export interface Card {
  study: string
  aim: string
  location: string
  data_available: string
  important_limit: string
  fields: { field: string; note: string; value?: number | null; unit?: string | null }[]
  dois: { label: string; doi: string }[]
  source_links: { source_ref: string; url: string }[]
  limits: string[]
  evidence_kind: string
  is_fabric_study: boolean
}

export interface OutcomeFamily { label: string; marker: string; color: string; flame: 'steady' | 'fade' | 'blow' | 'flash' | 'ghost' }
export interface OutcomeMap {
  classes: { outcome_text: string; outcome_class: string; family: string; n_tests: number }[]
  families: Record<string, OutcomeFamily>
}

export interface RatingConfig {
  match_o2_points: number
  match_flow_cm_s: number
  near_o2_points: number
  near_flow_cm_s: number
  match_pressure_kpa: number
  far_pressure_kpa: number
  nearest_n: number
  tested_gravity_labels: string[]
}

export type Gravity = '0g' | '1g' | 'moon' | 'mars' | 'partial'
export interface Controls {
  material: string
  o2_pct: number | null
  flow_cm_s: number | null
  pressure_kpa: number | null
  gravity: Gravity
}

export interface Measure {
  test_id: string
  d_o2: number | null
  d_flow: number | null
  d_pressure: number | null
  pressure_state: 'match' | 'near' | 'far' | 'na' | 'unspecified' | 'row_unknown'
  flow_known: boolean
  flow_calibrated: boolean
  score: number
}
export type Level = 'GREEN' | 'YELLOW' | 'RED'
export interface Rating {
  material: string
  n_material_tests: number
  level: Level
  label: string
  code: string
  reasons: string[]
  nearest: Measure[]
  matching_test_ids?: string[]
  envelope: { o2: { min: number; max: number }; flow: { min: number; max: number } | null } | null
}

export interface DataBundle {
  tests: TestRow[]
  ranges: Ranges
  cards: Card[]
  sources: Source[]
  outcomeMap: OutcomeMap
  ratingConfig: RatingConfig
}

// ---- chat payloads (backend/app/answer.py)
export interface ChatSource {
  n: number
  source_id: string
  title: string
  publisher: string | null
  year: number | null
  tier: 1 | 2 | 3
  kind: 'test' | 'chunk' | 'computed' | 'web'
  pdf_page: number | null
  printed_page: number | string | null
  url: string | null
  pdf_url: string | null
  doi: string | null
  local_pdf: string | null
  notes: string | null
  via?: string | null
  test_id?: string | null
  snapshot_read_on?: string | null
  live_check?: string | null
  review_wording?: boolean
  extraction?: string | null
  quotes: string[]
}
export interface ChatClaim { text: string; quote: string; tier: 1 | 2 | 3; cite: number[]; extractive?: boolean }
export interface ChatAnswer {
  found: boolean
  summary: string
  notice: string | null
  claims: ChatClaim[]
  sources: ChatSource[]
  gaps: string[]
  rating: Rating | null
  design_note: string | null
  applied_conditions: Controls | null
  engine: string
  searched: string[]
  notices: string[]
  removed: { text: string; reasons: string[] }[]
  verifier: { claim: string; passed: boolean; reasons: string[]; match: string | null; live_check: string | null }[]
  /** Set when the question must be completed first (missing airflow, unreadable unit, misspelt material). */
  clarify?: Clarify
}

export interface Clarify {
  kind: 'material' | 'airflow_unit' | 'airflow_missing'
  prompt: string
  hint: string
  options: { label: string; ask: string }[]
}
