import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DataBundle } from '../lib/types'

export const PROCESSED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'processed')
export const read = <T,>(name: string): T => JSON.parse(readFileSync(join(PROCESSED, name), 'utf8')) as T

/** The real processed data. Tests never use invented rows. */
export function realData(): DataBundle {
  return { tests: read('tests.json'), ranges: read('ranges.json'), cards: read('cards.json'), sources: read('sources.json'), outcomeMap: read('outcome_map.json'), ratingConfig: read('rating_config.json') }
}
