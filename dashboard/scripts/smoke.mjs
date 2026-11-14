// Runtime smoke test: loads the dashboard in headless Chromium, waits for the
// 3D scene, toggles the top-down view, and reports console/page errors
// (shader compile failures show up here, not in tsc).
//
// Usage: node scripts/smoke.mjs [url]   (default http://localhost:5173)

import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'
const errors = []

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 500))
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 500)))

await page.goto(url, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(5000) // let the scene render several frames

// exercise the top-down toggle (exercises CameraRig too)
try {
  await page.getByText('Top-down view').click({ timeout: 5000 })
  await page.waitForTimeout(2500)
  await page.getByText('Side view').click({ timeout: 5000 })
  await page.waitForTimeout(1500)
} catch (e) {
  errors.push('TOGGLE: ' + String(e).slice(0, 300))
}

// drive the controls by clicking the flow regime map
try {
  const sliders = page.locator('main input[type=range]')
  const flowBefore = await sliders.nth(0).inputValue()
  const o2Before = await sliders.nth(1).inputValue()
  const map = page.locator('main svg').nth(1) // hero curve is 0, regime map is 1
  const box = await map.boundingBox()
  if (!box) throw new Error('regime map svg not found')
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3)
  await page.waitForTimeout(400)
  const flowAfter = await sliders.nth(0).inputValue()
  const o2After = await sliders.nth(1).inputValue()
  if (flowAfter === flowBefore || o2After === o2Before) {
    errors.push(
      `MAP CLICK: sliders did not move (flow ${flowBefore}->${flowAfter}, o2 ${o2Before}->${o2After})`,
    )
  }
} catch (e) {
  errors.push('MAP CLICK: ' + String(e).slice(0, 300))
}

await browser.close()

if (errors.length) {
  console.log('SMOKE FAIL: ' + errors.length + ' error(s)')
  for (const e of errors) console.log('- ' + e)
  process.exit(1)
}
console.log('SMOKE OK: no console or page errors')
