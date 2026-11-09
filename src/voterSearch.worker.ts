/// <reference lib="webworker" />
// Background voter search. Builds a compact index of every (synthetic) voter once,
// then answers fuzzy name searches without blocking the page.
//
// Memory: each distinct name / relative name is stored once; per voter we keep
// only small typed-array columns (~14 bytes). A search scores each distinct name
// once (a few thousand), then scans the columns.
import { editDistance, nameKey, scoreName, type NameKey } from './nameMatch'
import { installDuplicatePlan, votersOf, type Gender, type VoterSource } from './voters'

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

export interface VoterRef {
  boothId: string
  serial: number
}

/** Two records that are probably the same person. */
export interface DupPair {
  a: VoterRef
  b: VoterRef
  score: number
  nameScore: number
  relativeScore: number
  ageDiff: number
}

export type WorkerIn =
  | { type: 'init'; booths: VoterSource[] }
  | { type: 'search'; reqId: number; query: SearchQuery }
  | { type: 'duplicates'; reqId: number }

export type WorkerOut =
  | { type: 'progress'; done: number; total: number }
  | { type: 'ready'; voters: number; names: number; ms: number }
  | { type: 'results'; reqId: number; hits: SearchHit[]; total: number; ms: number }
  | { type: 'duplicates'; reqId: number; pairs: DupPair[]; compared: number; ms: number }

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
// Word key → names containing it, and name → its voters (CSR arrays), so a search
// only scores names that share a word with the query.
let vocab = new Map<string, number[]>()
let nameStart = new Uint32Array(0)
let nameVoters = new Uint32Array(0)
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
  vocab = new Map()
  keys.forEach((k, id) => {
    for (const w of new Set(k.keys)) {
      let l = vocab.get(w)
      if (!l) vocab.set(w, (l = []))
      l.push(id)
    }
  })
  nameStart = new Uint32Array(names.length + 1)
  for (let i = 0; i < n; i++) nameStart[vName[i] + 1]++
  for (let i = 0; i < names.length; i++) nameStart[i + 1] += nameStart[i]
  nameVoters = new Uint32Array(n)
  const fill = nameStart.slice(0, names.length)
  for (let i = 0; i < n; i++) nameVoters[fill[vName[i]]++] = i
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
  if (qName.keys.length === 0) return { hits, total: 0 } // need at least one full word

  // Names that share a (similar) word with the query: exact key, a prefix of the
  // last word while typing, or a key a typo or two away.
  const candidates = new Set<number>()
  qName.keys.forEach((w, wi) => {
    const isLast = wi === qName.keys.length - 1 && qName.bare.length === 0
    const allowed = w.length >= 6 ? 2 : w.length >= 4 ? 1 : 0
    for (const [vk, ids] of vocab) {
      const match =
        vk === w ||
        (isLast && w.length >= 2 && vk.startsWith(w)) ||
        (allowed > 0 && Math.abs(vk.length - w.length) <= allowed && editDistance(w, vk, allowed) <= allowed)
      if (match) for (const id of ids) candidates.add(id)
    }
  })

  let relScore: ((id: number) => number) | null = null
  if (q.relative?.trim()) {
    const qRel = nameKey(q.relative)
    const memo = new Map<number, number>()
    relScore = (id) => {
      let v = memo.get(id)
      if (v === undefined) memo.set(id, (v = scoreName(qRel, keys[id], true)))
      return v
    }
  }
  const gender = q.gender ? GENDER_CODE[q.gender] : -1

  const all: { i: number; s: number }[] = []
  for (const id of candidates) {
    const ns = scoreName(qName, keys[id], true)
    if (ns === 0) continue
    for (let p = nameStart[id]; p < nameStart[id + 1]; p++) {
      const i = nameVoters[p]
      if (gender >= 0 && vGender[i] !== gender) continue
      if (q.age && Math.abs(vAge[i] - q.age) > 2) continue
      if (!acOk(vBooth[i])) continue
      let s = ns
      if (relScore) {
        const r = relScore(vRel[i])
        if (r === 0) continue
        s = (s * 2 + r) / 3
      }
      all.push({ i, s })
    }
  }
  all.sort((a, b) => b.s - a.s || vBooth[a.i] - vBooth[b.i] || vSerial[a.i] - vSerial[b.i])
  for (const { i, s } of all.slice(0, limit))
    hits.push({ boothId: booths[vBooth[i]].id, serial: vSerial[i], score: Math.round(s * 100) / 100 })
  return { hits, total: all.length }
}

/**
 * Duplicate scan. Only voters that could be the same person are compared
 * ("blocking"): same gender, a name word and a relative-name word with the same
 * phonetic key (any word, so word order and "R." vs "Rote" don't matter — a
 * shared family name or a shared given name is enough), and ages within 2 years. Each candidate pair is
 * scored on name, relative's name and age.
 * ~6.8 lakh voters → a few million comparisons instead of 2×10^11.
 */
let dupCache: { pairs: DupPair[]; compared: number; ms: number } | null = null

function findDuplicates() {
  if (dupCache) return dupCache
  const t0 = performance.now()
  const stems = (k: NameKey) => [...new Set(k.keys)]
  const nameStems = keys.map(stems)
  const blocks = new Map<string, number[]>()
  for (let i = 0; i < vName.length; i++) {
    for (const n of nameStems[vName[i]])
      for (const r of nameStems[vRel[i]]) {
        const key = `${vGender[i]}|${n}|${r}`
        let b = blocks.get(key)
        if (!b) blocks.set(key, (b = []))
        b.push(i)
      }
  }
  // Best of both directions, so an extra word ("Venkatesh Kumar" vs "Venkatesh")
  // costs a little instead of everything.
  const memo = new Map<number, number>()
  const dupScore = (x: number, y: number) => {
    if (x === y) return 1
    const k = Math.min(x, y) * names.length + Math.max(x, y)
    const hit = memo.get(k)
    if (hit !== undefined) return hit
    const d1 = scoreName(keys[x], keys[y], { strict: true })
    const d2 = scoreName(keys[y], keys[x], { strict: true })
    const v = Math.max(d1, d2) * (Math.min(d1, d2) === 0 ? 0.9 : 1)
    memo.set(k, v)
    return v
  }
  const seen = new Set<number>()
  const pairs: DupPair[] = []
  let compared = 0
  for (const ids of blocks.values()) {
    if (ids.length < 2) continue
    ids.sort((a, b) => vAge[a] - vAge[b])
    for (let x = 0; x < ids.length; x++) {
      const i = ids[x]
      for (let y = x + 1; y < ids.length && vAge[ids[y]] - vAge[i] <= 2; y++) {
        const j = ids[y]
        const pairKey = Math.min(i, j) * vName.length + Math.max(i, j)
        if (seen.has(pairKey)) continue
        seen.add(pairKey)
        compared++
        const nameScore = dupScore(vName[i], vName[j])
        if (nameScore < 0.7) continue
        const relativeScore = dupScore(vRel[i], vRel[j])
        if (relativeScore < 0.7) continue
        const ageDiff = Math.abs(vAge[i] - vAge[j])
        const score = 0.5 * nameScore + 0.35 * relativeScore + 0.15 * (1 - ageDiff / 4)
        if (score < 0.8) continue
        pairs.push({
          a: { boothId: booths[vBooth[i]].id, serial: vSerial[i] },
          b: { boothId: booths[vBooth[j]].id, serial: vSerial[j] },
          score: Math.round(score * 100) / 100,
          nameScore: Math.round(nameScore * 100) / 100,
          relativeScore: Math.round(relativeScore * 100) / 100,
          ageDiff,
        })
      }
    }
  }
  pairs.sort((p, q) => q.score - p.score)
  dupCache = { pairs, compared, ms: Math.round(performance.now() - t0) }
  return dupCache
}

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data
  if (m.type === 'init') {
    booths = m.booths
    installDuplicatePlan(booths)
    build()
  } else if (m.type === 'search') {
    if (!ready) return
    const t0 = performance.now()
    const { hits, total } = search(m.query)
    post({ type: 'results', reqId: m.reqId, hits, total, ms: Math.round(performance.now() - t0) })
  } else if (m.type === 'duplicates') {
    if (!ready) return
    const { pairs, compared, ms } = findDuplicates() // ms = time of the original scan
    post({ type: 'duplicates', reqId: m.reqId, pairs, compared, ms })
  }
}
