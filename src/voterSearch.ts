// Main-thread side of the voter search worker. The index is built the first time
// someone opens "Find voter", then reused.
import { booths } from './booths'
import type { SearchHit, SearchQuery, WorkerIn, WorkerOut } from './voterSearch.worker'

export type { SearchHit, SearchQuery }

export interface IndexStatus {
  state: 'idle' | 'building' | 'ready'
  progress: number // 0..1
  voters?: number
}

let worker: Worker | null = null
let status: IndexStatus = { state: 'idle', progress: 0 }
const listeners = new Set<(s: IndexStatus) => void>()
const pending = new Map<number, (r: { hits: SearchHit[]; total: number; ms: number }) => void>()
let nextId = 1

function setStatus(s: IndexStatus) {
  status = s
  listeners.forEach((l) => l(s))
}

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./voterSearch.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data
    if (m.type === 'progress') setStatus({ state: 'building', progress: m.done / m.total })
    else if (m.type === 'ready') setStatus({ state: 'ready', progress: 1, voters: m.voters })
    else if (m.type === 'results') {
      pending.get(m.reqId)?.(m)
      pending.delete(m.reqId)
    }
  }
  setStatus({ state: 'building', progress: 0 })
  const msg: WorkerIn = {
    type: 'init',
    booths: booths.filter((b) => b.electors).map((b) => ({ id: b.id, ac: b.ac, electors: b.electors })),
  }
  worker.postMessage(msg)
  return worker
}

/** Start building the index (call when the search panel opens). */
export function warmUp() {
  ensureWorker()
}

export function onStatus(fn: (s: IndexStatus) => void) {
  listeners.add(fn)
  fn(status)
  return () => {
    listeners.delete(fn)
  }
}

/** Runs a search; resolves once the index is ready and the worker has answered. */
export function searchVoters(query: SearchQuery): Promise<{ hits: SearchHit[]; total: number; ms: number }> {
  const w = ensureWorker()
  const reqId = nextId++
  return new Promise((resolve) => {
    const send = () => w.postMessage({ type: 'search', reqId, query } satisfies WorkerIn)
    pending.set(reqId, resolve)
    if (status.state === 'ready') send()
    else {
      const off = onStatus((s) => {
        if (s.state === 'ready') {
          off()
          send()
        }
      })
    }
  })
}
