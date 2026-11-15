// @vitest-environment jsdom
/**
 * NO REPETITION acceptance test (dev only).
 *
 * Renders the real main screen with the real processed data and fails if a fact is printed in
 * more than one primary panel. Primary panels are the elements marked data-panel
 * (controls, scene, result, evidence / map / library, topbar, footer). Short chips
 * (elements marked data-chip) are the allowed cross-references and are ignored.
 * The chat transcript is excluded: an answer legitimately restates the evidence it cites.
 *
 * What it checks:
 *  1. the user's slider values are printed only in the controls panel;
 *  2. a test id printed as plain text appears in one panel only (elsewhere it must be a chip);
 *  3. an oxygen percentage printed as text appears in one panel only;
 *  4. the tested ranges of the selected material appear only next to the material selector;
 *  5. the evidence rating label appears only in the Result banner;
 *  6. the "illustrative" label and the footer disclaimer each appear exactly once;
 *  7. the Map tab and the Evidence tab do not print the same test ids or oxygen values.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, range } from '../lib/format'
import { PROCESSED, realData } from './load'

vi.mock('../viz/Scene3D', () => ({ default: () => <div data-testid="scene-stub" /> }))

const data = realData()
const ids = new Set(data.tests.map((t) => t.test_id))

function panelText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('[data-chip]').forEach((c) => c.remove())
  return clone.textContent ?? ''
}
function panels(): Map<string, string> {
  const out = new Map<string, string>()
  document.querySelectorAll('[data-panel]').forEach((el) => {
    const name = el.getAttribute('data-panel') as string
    if (name !== 'chat') out.set(name, panelText(el))
  })
  return out
}
const testIdsIn = (text: string) => new Set([...text.matchAll(TEST_ID)].map((m) => m[0]).filter((x) => ids.has(x)))
const o2ValuesIn = (text: string) => new Set([...text.matchAll(/(\d+(?:\.\d+)?)\s?(?:vol)?%/g)].map((m) => m[1]))
function duplicates(byPanel: Map<string, Set<string>>): string[] {
  const seen = new Map<string, string>()
  const dup: string[] = []
  for (const [panel, values] of byPanel) for (const v of values) (seen.has(v) ? dup.push(`"${v}" in ${seen.get(v)} and ${panel}`) : seen.set(v, panel))
  return dup
}

beforeEach(() => {
  localStorage.setItem('fif.tour.v1', 'done')
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const m = url.match(/data\/([a-z_]+\.json)/)
    if (m) return new Response(readFileSync(join(PROCESSED, m[1]), 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ data: { ok: true }, engines: { local: true, gemini: false, claude: false }, raw_pdfs_available: false }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function mount() {
  const { default: App } = await import('../App')
  const { useApp } = await import('../store')
  render(<App />)
  await waitFor(() => expect(document.querySelector('[data-panel="result"]')).toBeTruthy())
  // user values chosen so they are not, by coincidence, the conditions of a real test
  const taken = new Set(data.tests.map((t) => t.o2_pct_initial))
  let o2 = 19.3
  while (taken.has(o2)) o2 = Math.round((o2 + 0.1) * 10) / 10
  act(() => useApp.setState((s) => ({ controls: { ...s.controls, o2_pct: o2, flow_cm_s: 7.5 } })))
  return { useApp, o2 }
}

describe('no repetition on the main screen', () => {
  it('prints each fact in the one panel that owns it', async () => {
    const { useApp, o2 } = await mount()
    const p = panels()
    expect([...p.keys()]).toEqual(expect.arrayContaining(['topbar', 'scene', 'controls', 'result', 'evidence', 'footer']))

    // 1. slider values only on the sliders
    for (const [name, text] of p) {
      if (name === 'controls') {
        expect(text).toContain(`${o2}%`)
        expect(text).toContain('7.5 cm/s')
      } else {
        expect(text, `user oxygen value repeated in ${name}`).not.toContain(`${o2}`)
        expect(text, `user airflow value repeated in ${name}`).not.toContain('7.5 cm/s')
      }
    }
    // 2. test ids as plain text: one panel only
    expect(duplicates(new Map([...p].map(([k, v]) => [k, testIdsIn(v)])))).toEqual([])
    expect(testIdsIn(p.get('evidence') as string).size).toBeGreaterThan(0)
    // 3. oxygen percentages: one panel only
    expect(duplicates(new Map([...p].map(([k, v]) => [k, o2ValuesIn(v)])))).toEqual([])
    // 4. tested ranges only next to the material selector
    const m = data.ranges.materials.find((x) => x.material_group === useApp.getState().controls.material)!
    const rangeText = range(m.series[0].o2_pct_initial)
    expect(p.get('controls')).toContain(rangeText)
    for (const [name, text] of p) if (name !== 'controls') expect(text, `tested range repeated in ${name}`).not.toContain(rangeText)
    // 5. rating label only in the Result banner
    const label = screen.getByTestId('rating-badge').textContent!.trim()
    for (const [name, text] of p) if (name !== 'result') expect(text, `rating label repeated in ${name}`).not.toContain(label)
    // 6. disclaimers once
    expect(document.querySelectorAll('[data-disclaimer="illustrative"]').length).toBe(1)
    expect(document.body.textContent!.split('Illustrative, not a measurement').length - 1).toBe(1)
    expect(document.body.textContent!.split('Evidence tool, not a safety certification').length - 1).toBe(1)
  })

  it('the Map does not restate what the Evidence panel owns, and there is one chart', async () => {
    await mount()
    const evidence = panelText(document.querySelector('[data-panel="evidence"]')!)
    fireEvent.click(screen.getByRole('tab', { name: /map/i }))
    await waitFor(() => expect(document.querySelector('[data-panel="map"]')).toBeTruthy())
    const map = panelText(document.querySelector('[data-panel="map"]')!)
    expect([...testIdsIn(map)]).toEqual([])
    expect([...o2ValuesIn(map)].filter((v) => o2ValuesIn(evidence).has(v))).toEqual([])
    expect(document.querySelectorAll('[data-panel="map"] svg[role="img"]').length).toBe(1)
    expect(document.querySelector('[data-panel="evidence"]')).toBeNull()
  })

  it('shows no mock data banner and no mock rows', async () => {
    await mount()
    expect(document.body.textContent).not.toMatch(/mock|synthetic|placeholder data/i)
    expect(screen.getByTestId('data-status').textContent).toMatch(/Real NASA data/)
  })
})
