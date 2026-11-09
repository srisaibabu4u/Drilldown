// Fuzzy matching for Indian names written in English, where the same person can
// appear as "Santhosh Rote", "R. Santosh", "Rote. Santhos" or "SANTOSH R".
//
// 1. normalise: lowercase, drop dots / punctuation / honorifics, split into words
// 2. phonetic key per word, so common spelling variants collapse to one key:
//      th→t, sh→s, bh/dh/gh/kh/ph/jh/ch→b/d/g/k/p/j/c, ee/ii→i, oo/uu/ou→u,
//      aa→a, w→v, z→j, q→k, x→ks, y→i, doubled letters → one, trailing h/a dropped
//    e.g. Santhosh / Santosh / Santhos → "santos"; Lakshmi / Laxmi → "laksmi"
// 3. score: every full word typed must match a word in the name (same key, a
//    prefix while typing, or a key 1–2 edits away); single letters match the
//    initial of a word, and a full word may match a bare initial ("Rote" ↔ "R.").
//
// Used by voter search and (next) duplicate detection. No dependencies.

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'smt', 'sri', 'shri', 'kum', 'dr', 'late'])

/** Lowercase words, without punctuation or honorifics. Initials stay as 1-letter words. */
export function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !HONORIFICS.has(w))
}

/** Phonetic key for one word (see rules above). */
export function phonetic(word: string): string {
  let s = word.toLowerCase().replace(/[^a-z]/g, '')
  if (s.length <= 1) return s
  s = s
    .replace(/x/g, 'ks')
    .replace(/sh/g, 's')
    .replace(/([bcdgjkpt])h/g, '$1')
    .replace(/ck/g, 'k')
    .replace(/q/g, 'k')
    .replace(/z/g, 'j')
    .replace(/w/g, 'v')
    .replace(/ee|ii|ie/g, 'i')
    .replace(/oo|uu|ou/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1')
  if (s.length > 3) s = s.replace(/h$/, '')
  if (s.length > 3) s = s.replace(/a$/, '')
  return s
}

export interface NameKey {
  /** Phonetic keys of full words (2+ letters). */
  keys: string[]
  /** First letters of every word, initials included. */
  initials: string[]
  /** Words that were bare initials ("r" from "R."). */
  bare: string[]
}

export function nameKey(name: string): NameKey {
  const ws = words(name)
  return {
    keys: ws.filter((w) => w.length > 1).map(phonetic),
    initials: ws.map((w) => w[0]),
    bare: ws.filter((w) => w.length === 1),
  }
}

/** Levenshtein distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** How well one typed word matches one name word (0 = no match). */
function wordScore(q: string, c: string, typing: boolean): number {
  if (q === c) return 1
  if (typing && q.length >= 2 && c.startsWith(q)) return 0.9
  const allowed = Math.min(q.length, c.length) >= 6 ? 2 : Math.min(q.length, c.length) >= 4 ? 1 : 0
  if (allowed > 0) {
    const d = editDistance(q, c, allowed)
    if (d <= allowed) return 1 - 0.12 * d
  }
  return 0
}

/**
 * Score 0..1 for how well `query` matches `cand`. 0 means "not a match".
 * `typing` treats the last typed word as a prefix (search-as-you-type).
 */
export function scoreName(query: NameKey, cand: NameKey, typing = false): number {
  if (query.keys.length === 0 && query.bare.length === 0) return 0
  const usedKeys = new Set<number>()
  const usedBare = new Set<number>()
  const scores: number[] = []
  let wordMatches = 0 // typed words matched to a full word (not just an initial)

  query.keys.forEach((q, qi) => {
    const isLast = typing && qi === query.keys.length - 1 && query.bare.length === 0
    let best = 0
    let bestIdx = -1
    cand.keys.forEach((c, ci) => {
      if (usedKeys.has(ci)) return
      const s = wordScore(q, c, isLast)
      if (s > best) {
        best = s
        bestIdx = ci
      }
    })
    if (best >= 0.7) {
      usedKeys.add(bestIdx)
      scores.push(best)
      wordMatches++
      return
    }
    // A full word may stand for an initial in the record: "Rote" ↔ "R."
    const bi = cand.bare.findIndex((b, i) => !usedBare.has(i) && b === q[0])
    if (bi >= 0) {
      usedBare.add(bi)
      scores.push(0.75)
      return
    }
    scores.push(0)
  })
  if (scores.some((s) => s === 0)) return 0
  // An initial can stand in for a word ("Rote" ↔ "R."), but at least one typed
  // word must match a real word — otherwise "Santhosh" would match every "S. …".
  if (query.keys.length > 0 && wordMatches === 0) return 0

  // Typed initials ("R.") should match the first letter of a remaining word.
  for (const letter of query.bare) {
    const bi = cand.bare.findIndex((b, i) => !usedBare.has(i) && b === letter)
    if (bi >= 0) {
      usedBare.add(bi)
      scores.push(1)
      continue
    }
    const ki = cand.keys.findIndex((k, i) => !usedKeys.has(i) && k[0] === phonetic(letter)[0])
    if (ki >= 0) {
      usedKeys.add(ki)
      scores.push(0.85)
      continue
    }
    scores.push(0.3) // initial doesn't fit: keep as a weak match rather than dropping it
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  // Small penalty for name words the query didn't mention.
  const extra = cand.keys.length - usedKeys.size
  return Math.max(0, mean * (1 - 0.06 * extra))
}
