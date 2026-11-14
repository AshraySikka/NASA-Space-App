// Every mock row is generated: sources point at the real PSI/NTRS search
// pages Moises will replace with per-test URLs.
import raw from '../../../datasets/mock/tests.json'
import type { Test } from './types'

export const corpus: Test[] = raw as Test[]

export const MATERIALS = ['cotton fabric', 'nomex fabric']

export function isGenerated(t: Test): boolean {
  return (t.notes ?? '').includes('generated')
}
