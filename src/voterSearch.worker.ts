/// <reference lib="webworker" />
// Background voter search. Builds a compact index of every (synthetic) voter once,
// then answers fuzzy name searches without blocking the page.
//
// Memory: each distinct name / relative name is stored once; per voter we keep
// only small typed-array columns (~14 bytes). A search scores each distinct name
// once (a few thousand), then scans the columns.
import { nameKey, scoreName, type NameKey } from './nameMatch'
import { votersOf, type Gender, type VoterSource } from './voters'

export interface SearchQuery {
  name: string
  relative?: string
  age?: number
  gender?: Gender
  ac?: number
  limit?: number
}

export interface SearchHit {
  boothId: string
  serial: number
  score: number
}

export type WorkerIn =
  | { type: 'init'; booths: VoterSource[] }
  | { type: 'search'; reqId: number; query: SearchQuery }

export type WorkerOut =
  | { type: 'progress'; done: number; total: number }
  | { type: 'ready'; voters: number; names: number; ms: number }
  | { type: 'results'; reqId: number; hits: SearchHit[]; total: number; ms: number }

const GENDER_CODE: Record<Gender, number> = { M: 0, F: 1, TG: 2 }

let booths: VoterSource[] = []
let names: string[] = []
let keys: NameKey[] = []
let vName = new Uint32Array(0)
let vRel = new Uint32Array(0)
let vBooth = new Uint16Array(0)
let vSerial = new Uint16Array(0)
let vAge = new Uint8Array(0)
let vGender = new Uint8Array(0)
let vId = new Uint32Array(0) // numeric part of the sample voter ID
let boothAc = new Uint16Array(0)
let ready = false

function build() {
  const t0 = performance.now()
  const total = booths.reduce((a, b) => a + (b.electors ? b.electors.male + b.electors.female + b.electors.thirdGender : 0), 0)
  vName = new Uint32Array(total)
  vRel = new Uint32Array(total)
  vBooth = new Uint16Array(total)
  vSerial = new Uint16Array(total)
  vAge = new Uint8Array(total)
  vGender = new Uint8Array(total)
  vId = new Uint32Array(total)
  boothAc = new Uint16Array(booths.length)
  const intern = new Map<string, number>()
  const id = (s: string) => {
    let i = intern.get(s)
    if (i === undefined) {
      i = names.length
      names.push(s)
      intern.set(s, i)
    }
    return i
  }
  let n = 0
  booths.forEach((b, bi) => {
    boothAc[bi] = b.ac
    for (const v of votersOf(b, { cache: false })) {
      vName[n] = id(v.name)
      vRel[n] = id(v.relative)
      vBooth[n] = bi
      vSerial[n] = v.serial
      vAge[n] = v.age
      vGender[n] = GENDER_CODE[v.gender]
      vId[n] = Number(v.id.slice(3))
      n++
    }
    if (bi % 50 === 0) post({ type: 'progress', done: bi, total: booths.length })
  })
  keys = names.map(nameKey)
  ready = true
  post({ type: 'ready', voters: n, names: names.length, ms: Math.round(performance.now() - t0) })
}

function search(q: SearchQuery): { hits: SearchHit[]; total: number } {
  const limit = q.limit ?? 200
  const hits: SearchHit[] = []
  const acOk = (bi: number) => !q.ac || boothAc[bi] === q.ac

  // Sample voter ID: exact lookup.
  const idMatch = q.name.trim().match(/^smp\s*(\d{1,7})$/i)
  if (idMatch) {
    const want = Number(idMatch[1])
    for (let i = 0; i < vId.length; i++)
      if (vId[i] === want && acOk(vBooth[i])) hits.push({ boothId: booths[vBooth[i]].id, serial: vSerial[i], score: 1 })
    return { hits, total: hits.length }
  }

  const qName = nameKey(q.name)
  if (qName.keys.length === 0 && qName.bare.length === 0) return { hits, total: 0 }
  const nameScore = new Float32Array(names.length)
  for (let i = 0; i < names.length; i++) nameScore[i] = scoreName(qName, keys[i], true)

  let relScore: Float32Array | null = null
  if (q.relative?.trim()) {
    const qRel = nameKey(q.relative)
    relScore = new Float32Array(names.length)
    for (let i = 0; i < names.length; i++) relScore[i] = scoreName(qRel, keys[i], true)
  }
  const gender = q.gender ? GENDER_CODE[q.gender] : -1

  const all: { i: number; s: number }[] = []
  for (let i = 0; i < vName.length; i++) {
    let s = nameScore[vName[i]]
    if (s === 0) continue
    if (gender >= 0 && vGender[i] !== gender) continue
    if (q.age && Math.abs(vAge[i] - q.age) > 2) continue
    if (!acOk(vBooth[i])) continue
    if (relScore) {
      const r = relScore[vRel[i]]
      if (r === 0) continue
      s = (s * 2 + r) / 3
    }
    all.push({ i, s })
  }
  all.sort((a, b) => b.s - a.s || vBooth[a.i] - vBooth[b.i] || vSerial[a.i] - vSerial[b.i])
  for (const { i, s } of all.slice(0, limit))
    hits.push({ boothId: booths[vBooth[i]].id, serial: vSerial[i], score: Math.round(s * 100) / 100 })
  return { hits, total: all.length }
}

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data
  if (m.type === 'init') {
    booths = m.booths
    build()
  } else if (m.type === 'search') {
    if (!ready) return
    const t0 = performance.now()
    const { hits, total } = search(m.query)
    post({ type: 'results', reqId: m.reqId, hits, total, ms: Math.round(performance.now() - t0) })
  }
}
