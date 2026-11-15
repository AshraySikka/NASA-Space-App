import type { ChatAnswer, Controls } from './types'

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8000'

export interface ApiStatus {
  reachable: boolean
  engines: { local: boolean; gemini: boolean; claude: boolean }
  raw_pdfs_available: boolean
  detail?: string
}

export async function getStatus(): Promise<ApiStatus> {
  try {
    const res = await fetch(`${API_BASE}/api/status`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(String(res.status))
    const j = await res.json()
    return { reachable: true, engines: j.engines, raw_pdfs_available: !!j.raw_pdfs_available, detail: j.data?.ok ? undefined : j.data?.detail }
  } catch {
    return { reachable: false, engines: { local: false, gemini: false, claude: false }, raw_pdfs_available: false }
  }
}

export interface ChatRequest {
  question: string
  history: { role: 'user' | 'assistant'; content: string }[]
  simulator: Controls
  last_conditions: Controls | null
  live: boolean
}

export interface ChatHandlers {
  onStatus: (text: string) => void
  onToken: (text: string) => void
  onFinal: (answer: ChatAnswer) => void
  onError: (message: string) => void
}

/** POST /api/chat and read the SSE stream. */
export async function streamChat(req: ChatRequest, h: ChatHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal })
  } catch {
    h.onError('Could not reach the assistant. Check your connection and that the API is running, then try again. The simulator and map still work offline.')
    return
  }
  if (res.status === 429) return h.onError('Too many questions in a short time. Wait a moment and try again.')
  if (res.status === 503) return h.onError('The server has no processed data loaded. Run "make ingest" on the server.')
  if (!res.ok || !res.body) return h.onError(`The assistant returned an error (${res.status}). Nothing was answered.`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let gotFinal = false
  const handle = (block: string) => {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    let payload: any
    try {
      payload = JSON.parse(data.join('\n'))
    } catch {
      return
    }
    if (event === 'status') h.onStatus(String(payload.text ?? ''))
    else if (event === 'token') h.onToken(String(payload.text ?? ''))
    else if (event === 'final') {
      gotFinal = true
      h.onFinal(payload as ChatAnswer)
    } else if (event === 'error') {
      gotFinal = true
      h.onError(String(payload.detail ?? 'The assistant hit an error.'))
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        handle(buf.slice(0, i))
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '')
      }
    }
    if (buf.trim()) handle(buf)
  } catch {
    if (!gotFinal) h.onError('The connection dropped before the answer finished. Try again.')
    return
  }
  if (!gotFinal) h.onError('The answer stream ended early. Try again.')
}
