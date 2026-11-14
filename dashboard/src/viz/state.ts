import { create } from 'zustand'
import type { Controls, Test } from './types'
import { corpus } from './corpus'

interface AppState {
  controls: Controls
  tests: Test[]
  activeTestId: string | null
  setControl: <K extends keyof Controls>(key: K, value: Controls[K]) => void
  setActiveTest: (id: string | null) => void
}

export const useApp = create<AppState>((set) => ({
  controls: { flow_cm_s: 10, o2_pct: 21, gravity_g: 0, material: 'cotton fabric' },
  tests: corpus,
  activeTestId: null,
  setControl: (key, value) => set((s) => ({ controls: { ...s.controls, [key]: value } })),
  setActiveTest: (id) => set({ activeTestId: id }),
}))
