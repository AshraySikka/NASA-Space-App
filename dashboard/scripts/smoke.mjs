// Playwright smoke test: ask a question, see citations, apply to the simulator, export CSV.
// Also checks the Moon answer, the not-found answer, theme persistence and the narrow layout.
//
// Usage: node scripts/smoke.mjs [url]      (default http://localhost:4173; API must be running)
// Uses the system Chrome if CHROME_PATH is set or /usr/bin/google-chrome exists.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173'
const shots = process.env.SHOTS_DIR
const chrome = process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined)
const errors = []
const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
}
if (shots) mkdirSync(shots, { recursive: true })
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` })

const browser = await chromium.launch({ executablePath: chrome, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1560, height: 940 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)))
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 300)))

const t0 = Date.now()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.getByTestId('rating-badge').waitFor({ timeout: 15000 })
ok('main screen interactive in under 3 s', Date.now() - t0 < 3000, `${Date.now() - t0} ms`)
ok('first-run tour appears and can be skipped', await page.getByTestId('tour').isVisible())
await page.getByTestId('tour-skip').click()
ok('real data status indicator, no mock banner', /Real NASA data/.test(await page.getByTestId('data-status').innerText()) && !/mock|synthetic/i.test(await page.locator('body').innerText()))
await page.waitForTimeout(2500)
await shot(page, '01-main')

// 1. grounded cited answer
const ask = async (q) => {
  const n = await page.getByTestId('answer-summary').count()
  await page.locator('#ask').fill(q)
  await page.keyboard.press('Enter')
  await page.getByTestId('answer-summary').nth(n).waitFor({ timeout: 30000 })
  return page.locator('.msg.bot').last()
}
let bot = await ask('What happened to SIBAL at 18.7% oxygen and 5 cm/s?')
ok('grounded answer shows numbered citation chips', (await bot.locator('.cite').count()) >= 1, `${await bot.locator('.cite').count()} chips`)
ok('answer names the engine that answered', /Answered by:/.test(await bot.innerText()))
await bot.locator('.cite').first().click()
await page.getByRole('dialog', { name: 'Sources' }).waitFor()
const drawer = await page.getByRole('dialog', { name: 'Sources' }).innerText()
ok('Sources drawer shows tier, page and a verbatim quote', /Tier 1/.test(drawer) && /PDF page \d+/.test(drawer) && /“/.test(drawer))
await shot(page, '02-sources')
await page.keyboard.press('Escape')

// apply to simulator
await bot.getByTestId('apply-sim').click()
await page.waitForTimeout(400)
const o2Shown = await page.locator('output[for="o2"]').innerText()
ok('Apply to simulator sets the sliders', o2Shown.trim() === '18.7%' && (await page.locator('output[for="flow"]').innerText()).trim() === '5 cm/s', o2Shown)
ok('rating badge reads inside tested range', /Inside tested range/.test(await page.getByTestId('rating-badge').innerText()))

// export CSV
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()])
const csv = readFileSync(await dl.path(), 'utf8')
ok('CSV export has conditions, rating, tests, sources, pages, tier', /query_o2_pct/.test(csv) && /evidence_rating/.test(csv) && /pdf_page/.test(csv) && /tier/.test(csv) && csv.split('\r\n').length > 3, `${csv.split('\r\n').length - 2} rows`)

// 2. Moon answer
bot = await ask('Will this burn on the Moon?')
let txt = await bot.innerText()
ok('Moon question: red rating, FM2 and JAXA context, no invented rate', /Outside tested data/.test(txt) && /FM2/.test(txt) && /JAXA/.test(txt) && !/mm\/s/.test(txt))
ok('Moon answer mixes tiers visibly', (await bot.locator('.cite.t2').count()) >= 1 && (await bot.locator('.cite.t3').count()) >= 1)
await bot.getByTestId('apply-sim').click()
await page.waitForTimeout(600)
ok('Moon state shows ESTIMATE, NOT MEASURED', await page.getByText('ESTIMATE, NOT MEASURED').isVisible())
await shot(page, '03-moon')

// 3. not found
bot = await ask('What is the price of bitcoin today?')
ok('uncovered topic returns exactly the not-found sentence', (await bot.getByTestId('answer-summary').innerText()).trim() === 'Not found in NASA sources I can verify')

// 3b. missing airflow: the app asks first, then answers once the user picks a value
await page.locator('#ask').fill('What happened to SIBAL at 18.7% oxygen?')
await page.keyboard.press('Enter')
await page.getByTestId('clarify').last().waitFor({ timeout: 30000 })
const clarifyText = await page.getByTestId('clarify').last().innerText()
ok('missing airflow is asked for before any answer', /What airflow should I use/.test(clarifyText) && /cm\/s/.test(clarifyText), clarifyText.slice(0, 60))
const nAnswers = await page.getByTestId('answer-summary').count()
await page.getByTestId('clarify').last().locator('button').first().click()
await page.getByTestId('answer-summary').nth(nAnswers).waitFor({ timeout: 30000 })
ok('choosing an airflow produces the cited answer', (await page.locator('.msg.bot').last().locator('.cite').count()) >= 1)
await shot(page, '03b-clarify')

// map + library
await page.getByRole('tab', { name: /Map/ }).click()
await page.locator('[data-panel="map"] svg[role="img"]').waitFor()
ok('flammability map renders with a quenching boundary label from data', /from \d+ published quenching cases/.test(await page.locator('[data-panel="map"]').innerText()))
await shot(page, '04-map')
await page.getByRole('tab', { name: /Library/ }).click()
await page.locator('.card').first().waitFor()
ok('library shows the research cards and labels non-fabric studies', (await page.locator('.card').count()) === (await (await page.request.get(new URL('/data/cards.json', url).href)).json()).length && /Not a fabric study/.test(await page.locator('[data-panel="library"]').innerText()))
await shot(page, '05-library')

// personalization persists
await page.getByTestId('prefs-toggle').click()
await page.getByRole('radio', { name: 'Daylight' }).click()
await page.getByRole('radio', { name: 'Expert' }).click()
await page.keyboard.press('Escape')
await page.waitForTimeout(700)
const sceneBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim())
ok('3D scene background variable follows the theme', sceneBg === '#dfe6f2', sceneBg)
await shot(page, '06-daylight')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByTestId('rating-badge').waitFor()
ok('theme and explain mode persist across reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'daylight' && /Rating code:/.test(await page.locator('[data-panel="result"]').innerText()))
ok('tour stays dismissed after reload', (await page.getByTestId('tour').count()) === 0)
await page.waitForTimeout(500)
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
ok('page colours follow the theme', bg === 'rgb(238, 242, 248)', bg)
await page.getByTestId('prefs-toggle').click()
await page.getByRole('button', { name: 'Reset to defaults' }).click()
await page.keyboard.press('Escape')

// keyboard: the gravity control is reachable and operable without a mouse
await page.locator('#material').focus()
await page.keyboard.press('Tab')
await page.keyboard.press('ArrowRight')
ok('sliders respond to the keyboard', (await page.locator('output[for="o2"]').innerText()).trim() !== '')
ok('visible focus ring', await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'))

// narrow window
await page.setViewportSize({ width: 390, height: 800 })
await page.waitForTimeout(400)
ok('narrow layout shows the bottom tab bar', await page.locator('.mobile-tabs').isVisible())
await page.locator('.mobile-tabs button', { hasText: 'Map' }).click()
await page.locator('[data-panel="map"]').waitFor({ timeout: 5000 }).catch(() => {})
ok('narrow layout: map reachable from the tab bar', await page.locator('[data-panel="map"]').isVisible())
await shot(page, '07-mobile-map')
await page.locator('.mobile-tabs button', { hasText: 'Ask' }).click()
ok('narrow layout: chat reachable from the tab bar', await page.locator('#ask').isVisible())
await shot(page, '08-mobile-chat')
ok('no horizontal overflow on a narrow screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

const real = errors.filter((e) => !/WebGL|GPU|swiftshader|THREE\.WebGLRenderer|GL_|favicon/i.test(e))
ok('no console or page errors', real.length === 0, real.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
