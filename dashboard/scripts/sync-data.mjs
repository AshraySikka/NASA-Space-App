// Copies the processed JSON the UI needs into public/data so the simulator, map and
// library work even when the API is asleep. chunks.json (search index) stays server-side.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', '..', 'data', 'processed')
const dst = join(here, '..', 'public', 'data')
mkdirSync(dst, { recursive: true })
const files = ['tests.json', 'ranges.json', 'cards.json', 'sources.json', 'outcome_map.json', 'rating_config.json', 'web_context.json']
const missing = files.filter((f) => !existsSync(join(src, f)))
if (missing.length) {
  // No fallback data on purpose: the app shows a clear error instead.
  console.warn(`[sync-data] missing in data/processed: ${missing.join(', ')}. Run "make ingest". The UI will show a data error.`)
}
for (const f of files) if (existsSync(join(src, f))) copyFileSync(join(src, f), join(dst, f))
console.log(`[sync-data] copied ${files.length - missing.length}/${files.length} files to public/data`)
