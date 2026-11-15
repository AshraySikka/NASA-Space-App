import { create } from 'zustand'
import { getStatus, streamChat, type ApiStatus } from './lib/api'
import { rate } from './engine/rating'
import { loadData } from './lib/data'
import type { ChatAnswer, ChatSource, Controls, DataBundle, Gravity } from './lib/types'
import type { FlowUnit, O2Unit } from './lib/format'

export interface Prefs {
  theme: 'mission' | 'daylight' | 'contrast' | 'deep'
  accent: 'nasa' | 'flame' | 'aurora' | 'violet'
  density: 'comfortable' | 'compact'
  explain: 'plain' | 'expert'
  flowUnit: FlowUnit
  o2Unit: O2Unit
  reduceMotion: boolean
  quality: 'high' | 'balanced' | 'low'
}
export const DEFAULT_PREFS: Prefs = { theme: 'mission', accent: 'nasa', density: 'comfortable', explain: 'plain', flowUnit: 'cm/s', o2Unit: '%', reduceMotion: false, quality: 'balanced' }
const PREFS_KEY = 'fif.prefs.v1'
const TOUR_KEY = 'fif.tour.v1'

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const saved = raw ? (JSON.parse(raw) as Partial<Prefs>) : {}
    const p = { ...DEFAULT_PREFS, ...saved }
    if (!raw && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) p.reduceMotion = true
    return p
  } catch {
    return { ...DEFAULT_PREFS }
  }
}
function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: preferences last for this visit only */
  }
}
function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done'
  } catch {
    return true
  }
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  status?: string
  pending?: boolean
  error?: string
  answer?: ChatAnswer
  feedback?: 'up' | 'down'
}

export type RightTab = 'evidence' | 'map' | 'library'
export type MobileTab = 'chat' | 'simulator' | RightTab

interface State {
  data: DataBundle | null
  dataError: string | null
  api: ApiStatus | null
  controls: Controls
  prefs: Prefs
  messages: Message[]
  busy: boolean
  live: boolean
  chatOpen: boolean
  rightTab: RightTab
  mobileTab: MobileTab
  drawer: { open: boolean; sources: ChatSource[] | null; focus: number | null }
  aboutOpen: boolean
  tourStep: number | null
  focusTestId: string | null
  seriesFilter: string
  paused: boolean
  replayKey: number
  toast: string | null
  init: () => Promise<void>
  setControl: <K extends keyof Controls>(k: K, v: Controls[K]) => void
  applyConditions: (c: Partial<Controls>) => void
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void
  resetPrefs: () => void
  ask: (question: string) => Promise<void>
  setFeedback: (id: string, f: 'up' | 'down') => void
  set: (p: Partial<State>) => void
  openSources: (sources: ChatSource[] | null, focus?: number | null) => void
  focusTest: (id: string) => void
  endTour: () => void
  say: (t: string) => void
}

let uid = 0
const nextId = () => `m${++uid}`
let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useApp = create<State>((set, get) => ({
  data: null,
  dataError: null,
  api: null,
  controls: { material: '', o2_pct: null, flow_cm_s: null, pressure_kpa: null, gravity: '0g' },
  prefs: typeof window === 'undefined' ? { ...DEFAULT_PREFS } : readPrefs(),
  messages: [],
  busy: false,
  live: false,
  chatOpen: true,
  rightTab: 'evidence',
  mobileTab: 'simulator',
  drawer: { open: false, sources: null, focus: null },
  aboutOpen: false,
  tourStep: null,
  focusTestId: null,
  seriesFilter: 'all',
  paused: false,
  replayKey: 0,
  toast: null,

  init: async () => {
    getStatus().then((api) => set({ api }))
    try {
      const data = await loadData()
      // Starting point comes from the data: first material, first page-referenced test.
      const m = data.ranges.materials[0]
      // ...and the first reviewed test that has a stated outcome and is its own nearest neighbour.
      const stated = (t: (typeof data.tests)[number]) => (data.outcomeMap.classes.find((c) => c.outcome_text === t.outcome_text)?.family ?? 'unknown') !== 'unknown'
      const mine = data.tests.filter((t) => t.material_group === m.material_group)
      const first =
        mine.find((t) => t.evidence_role === 'verified' && t.flow_start_cm_s != null && stated(t) && rate({ material: m.material_group, o2_pct: t.o2_pct_initial, flow_cm_s: t.flow_start_cm_s, pressure_kpa: null, gravity: '0g' }, data.tests, data.ratingConfig).nearest[0]?.test_id === t.test_id) ?? mine[0]
      set({ data, dataError: null, controls: { material: m.material_group, o2_pct: first?.o2_pct_initial ?? null, flow_cm_s: first?.flow_start_cm_s ?? null, pressure_kpa: null, gravity: '0g' }, tourStep: tourSeen() ? null : 0 })
    } catch (e) {
      set({ dataError: e instanceof Error ? e.message : 'Processed data could not be loaded.' })
    }
  },

  setControl: (k, v) => set((s) => ({ controls: { ...s.controls, [k]: v }, replayKey: k === 'material' ? s.replayKey + 1 : s.replayKey })),

  applyConditions: (c) => {
    const { data, controls } = get()
    if (!data) return
    const next: Controls = { ...controls }
    if (c.material && data.ranges.materials.some((m) => m.material_group === c.material)) next.material = c.material
    if (typeof c.o2_pct === 'number') next.o2_pct = c.o2_pct
    if (typeof c.flow_cm_s === 'number') next.flow_cm_s = c.flow_cm_s
    next.pressure_kpa = typeof c.pressure_kpa === 'number' ? c.pressure_kpa : null
    if (c.gravity) next.gravity = (['0g', '1g', 'moon'].includes(c.gravity) ? c.gravity : 'moon') as Gravity
    set((s) => ({ controls: next, replayKey: s.replayKey + 1, mobileTab: 'simulator' }))
    get().say('Simulator updated from the answer')
  },

  setPref: (k, v) => {
    const prefs = { ...get().prefs, [k]: v }
    writePrefs(prefs)
    set({ prefs })
  },
  resetPrefs: () => {
    writePrefs(DEFAULT_PREFS)
    set({ prefs: { ...DEFAULT_PREFS } })
    get().say('Preferences reset')
  },

  ask: async (question) => {
    const q = question.trim()
    if (!q || get().busy) return
    const prior = get().messages
    const history = prior.filter((m) => !m.error && !m.pending).slice(-6).map((m) => ({ role: m.role, content: m.role === 'assistant' ? (m.answer?.summary ?? m.text) : m.text }))
    const last = [...prior].reverse().find((m) => m.answer?.applied_conditions)?.answer?.applied_conditions ?? null
    const aid = nextId()
    set({ busy: true, chatOpen: true, messages: [...prior, { id: nextId(), role: 'user', text: q }, { id: aid, role: 'assistant', text: '', status: 'Searching local data', pending: true }] })
    const patch = (p: Partial<Message>) => set((s) => ({ messages: s.messages.map((m) => (m.id === aid ? { ...m, ...p } : m)) }))
    await streamChat(
      { question: q, history, simulator: get().controls, last_conditions: last, live: get().live },
      {
        onStatus: (status) => patch({ status }),
        onToken: (t) => set((s) => ({ messages: s.messages.map((m) => (m.id === aid ? { ...m, text: m.text + t } : m)) })),
        onFinal: (answer) => patch({ answer, text: answer.summary, pending: false, status: undefined }),
        onError: (error) => patch({ error, pending: false, status: undefined }),
      },
    )
    set({ busy: false })
    getStatus().then((api) => set({ api }))
  },

  setFeedback: (id, f) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, feedback: m.feedback === f ? undefined : f } : m)) })),
  set: (p) => set(p),
  openSources: (sources, focus = null) => set({ drawer: { open: true, sources, focus } }),
  focusTest: (id) => set({ focusTestId: id, rightTab: 'evidence', mobileTab: 'evidence' }),
  endTour: () => {
    try {
      localStorage.setItem(TOUR_KEY, 'done')
    } catch {
      /* ignore */
    }
    set({ tourStep: null })
  },
  say: (t) => {
    clearTimeout(toastTimer)
    set({ toast: t })
    toastTimer = setTimeout(() => set({ toast: null }), 2600)
  },
}))
