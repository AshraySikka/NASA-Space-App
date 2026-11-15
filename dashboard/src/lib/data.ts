import type { DataBundle } from './types'

const FILES = { tests: 'tests.json', ranges: 'ranges.json', cards: 'cards.json', sources: 'sources.json', outcomeMap: 'outcome_map.json', ratingConfig: 'rating_config.json' } as const

/** Loads the processed JSON. There is no fallback data: a missing file is an error the user sees. */
export async function loadData(): Promise<DataBundle> {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: 'no-cache' })
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.includes('json')) throw new Error(`data/processed/${file} is missing. Run "make ingest" and reload.`)
      return [key, await res.json()] as const
    }),
  )
  const data = Object.fromEntries(entries) as unknown as DataBundle
  if (!Array.isArray(data.tests) || data.tests.length === 0) throw new Error('data/processed/tests.json has no rows. Run "make ingest".')
  return data
}
