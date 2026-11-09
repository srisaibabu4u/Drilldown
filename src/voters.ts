// SYNTHETIC voter list for a polling station.
//
// Voters are generated on demand from the station's own totals (men / women /
// third gender, age bands, households), so the list always adds up to the
// station's dashboard numbers and nothing extra is downloaded. Every person is
// made up and labelled as sample data.
//
// Deliberately NOT included per person: caste / social category. Electoral rolls
// don't record it, and attaching it to named individuals would make the tool
// usable for caste-based targeting. Caste appears only as station / ward / AC
// percentages. For the same reason family names are MADE UP from syllables
// (e.g. "Konavali", "Mederu") and checked against a blocklist, so no real,
// caste-linked surname appears.
import { AGE_BANDS } from './constants'
import { phonetic, words } from './nameMatch'
import type { Booth } from './booths'

/** The fields of a station the generator needs (so a worker can pass plain objects). */
export type VoterSource = Pick<Booth, 'id' | 'ac' | 'electors'>

export type Gender = 'M' | 'F' | 'TG'

export interface Voter {
  /** Serial number on the station's list. */
  serial: number
  /** Sample voter ID (SMP + 7 digits) — not a real EPIC number. */
  id: string
  name: string
  relation: 'S/o' | 'D/o' | 'W/o' | 'C/o'
  relative: string
  gender: Gender
  age: number
  ageBand: number
  house: string
  /** Index of the household on this list (voters sharing a house). */
  household: number
}

const MALE = [
  'Srinivas', 'Ramesh', 'Suresh', 'Venkatesh', 'Raju', 'Krishna', 'Mahesh', 'Naresh', 'Ravi Kumar', 'Prasad',
  'Anil', 'Sai Kumar', 'Kiran', 'Praveen', 'Narsimha', 'Yadagiri', 'Mallesh', 'Anjaneyulu', 'Raghu', 'Vijay',
  'Harish', 'Shiva', 'Ramu', 'Balaraju', 'Chandrashekar', 'Rajesh', 'Satish', 'Madhu', 'Gopal', 'Lakshman',
  'Arjun', 'Karthik', 'Nagaraju', 'Sudhakar', 'Bhaskar', 'Prakash', 'Sampath', 'Vamshi', 'Akhil', 'Rohith',
  'Abhishek', 'Ajay', 'Anand', 'Ashok', 'Bharath', 'Charan', 'Dinesh', 'Ganesh', 'Govind', 'Hari',
  'Jagadish', 'Kalyan', 'Kishore', 'Manohar', 'Mohan', 'Murali', 'Naveen', 'Nikhil', 'Pavan', 'Phani',
  'Raghav', 'Rakesh', 'Ranjith', 'Sandeep', 'Sanjay', 'Shankar', 'Sridhar', 'Sunil', 'Tarun', 'Uday',
  'Varun', 'Vinod', 'Yashwanth', 'Bhanu', 'Chaitanya', 'Deepak', 'Gopi', 'Jeevan', 'Lokesh', 'Manikanta',
  'Nithin', 'Prem', 'Rahul', 'Sagar', 'Teja', 'Vasu', 'Ravinder', 'Yadaiah', 'Ramulu', 'Venkanna',
  // Same name, different spellings — as on real rolls (for testing duplicate / fuzzy search).
  'Santhosh', 'Santosh', 'Santhos', 'Srinivasa', 'Sreenivas', 'Venkatesh Kumar', 'Sai Kiran',
]
const FEMALE = [
  'Lakshmi', 'Padma', 'Sunitha', 'Anitha', 'Kavitha', 'Swathi', 'Sravani', 'Bhavani', 'Saritha', 'Renuka',
  'Manjula', 'Jyothi', 'Radha', 'Sujatha', 'Vijaya', 'Laxmamma', 'Yadamma', 'Sailaja', 'Divya', 'Priyanka',
  'Mounika', 'Haritha', 'Sandhya', 'Rani', 'Aruna', 'Pushpa', 'Saraswathi', 'Kalpana', 'Shobha', 'Vani',
  'Keerthi', 'Navya', 'Sowmya', 'Pavani', 'Deepika', 'Rajitha', 'Sirisha', 'Hema', 'Geetha', 'Usha',
  'Laxmi', 'Sravanthi', 'Shravani', 'Swaroopa',
  'Aishwarya', 'Anusha', 'Bhargavi', 'Chandana', 'Durga', 'Gayathri', 'Harika', 'Indira', 'Jhansi', 'Kamala',
  'Latha', 'Madhavi', 'Neelima', 'Pallavi', 'Prasanna', 'Ramya', 'Rekha', 'Sangeetha', 'Shilpa', 'Sneha',
  'Spandana', 'Suma', 'Tejaswini', 'Varalakshmi', 'Vasantha', 'Yamini', 'Akhila', 'Bindu', 'Hymavathi', 'Jayasree',
  'Kavya', 'Lavanya', 'Mamatha', 'Nandini', 'Pooja', 'Rupa', 'Sahithi', 'Tulasi', 'Uma', 'Ellamma',
]
const SYLLABLES = [
  'ka', 'ko', 'ku', 'ma', 'me', 'mo', 'na', 'ne', 'no', 'pa', 'pe', 'po', 'ra', 're', 'ro', 'ta', 'te', 'to',
  'va', 've', 'la', 'le', 'lo', 'da', 'de', 'do', 'ga', 'ge', 'go', 'ba', 'be', 'bo', 'sa', 'se', 'so', 'ja',
]
const ENDINGS = ['li', 'ru', 'ti', 'la', 'ri', 'ni', 'ka', 'du', 'pu', 'gi', 'ra', 'te']
/** Real surnames / community words that must never be generated (they can signal caste). */
const BLOCKED = /redd|rao$|raju|naid|goud|gowd|yada|sharm|varm|chow|sett|shet|madig|^mala|kamm|kapu|velam|bram|padmas|mudir|chari|achar|reddi|sastr|shast|gupt|setti|nayak|naik|lamb|koya|gond/

/** A made-up family name: 2–3 syllables plus an ending (~600k possibilities). */
function familyName(r: () => number): string {
  for (;;) {
    const n = r() < 0.7 ? 2 : 3
    let w = ''
    for (let i = 0; i < n; i++) w += SYLLABLES[Math.floor(r() * SYLLABLES.length)]
    w += ENDINGS[Math.floor(r() * ENDINGS.length)]
    if (!BLOCKED.test(w)) return w[0].toUpperCase() + w.slice(1)
  }
}

/** Spellings of the same name, as they turn up on real rolls. */
const VARIANTS = [
  ['Santhosh', 'Santosh', 'Santhos'],
  ['Lakshmi', 'Laxmi'],
  ['Srinivas', 'Sreenivas', 'Srinivasa'],
  ['Narsimha', 'Narasimha'],
  ['Sravani', 'Shravani'],
  ['Kavitha', 'Kavita'],
  ['Swathi', 'Swati'],
  ['Jyothi', 'Jyoti'],
  ['Venkatesh', 'Venkatesh Kumar'],
  ['Rohith', 'Rohit'],
  ['Yashwanth', 'Yaswanth'],
  ['Vamshi', 'Vamsi'],
]

/** Another plausible spelling of a first name (same phonetic key). */
function variantOf(first: string, r: () => number): string {
  const group = VARIANTS.find((g) => g.includes(first))
  if (group) {
    const others = group.filter((x) => x !== first)
    return others[Math.floor(r() * others.length)]
  }
  if (/th/.test(first)) return first.replace('th', 't')
  if (/sh/.test(first)) return first.replace('sh', 's')
  if (/ee/.test(first)) return first.replace('ee', 'i')
  if (/v/.test(first)) return first.replace('v', 'w')
  if (/a$/.test(first)) return first + 'a'
  return first.replace(/([aeiou])([^aeiou])/, '$1$2$2') // double a consonant
}

/**
 * Seeded PRNG: sfc32 with its 128-bit state filled by splitmix32.
 * (A counter-based generator like mulberry32 is not enough here: stations whose
 * seeds happen to land close together would replay the same sequence and
 * produce identical made-up people — false "duplicates".)
 */
function rng(seed: number) {
  let s = seed | 0
  const mix = () => {
    s = (s + 0x9e3779b9) | 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    return (z ^ (z >>> 16)) | 0
  }
  let a = mix(),
    b = mix(),
    c = mix(),
    d = mix()
  return () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const BAND_RANGE: [number, number][] = [
  [18, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 96],
]

const cache = new Map<string, Voter[]>()

const soundCache = new Map<string, string>()
function givenSound(given: string) {
  let s = soundCache.get(given)
  if (s === undefined) soundCache.set(given, (s = words(given).map(phonetic).join(' ')))
  return s
}

// ---------------------------------------------------------------------------
// Planted duplicates (sample data only)
// ---------------------------------------------------------------------------
// About 1 voter in 450 is entered twice, written differently each time — the
// way duplicates really appear on rolls: a spelling variant, initials moved,
// age off by one after a revision, the relative's name spelled differently.
// 15% of pairs sit in the same station, 10% span both constituencies (someone
// who moved and was enrolled again), the rest are in two stations of one AC.
// The plan depends only on the station list, so the page and the search worker
// generate identical records.

interface Twin {
  pair: number
  slot: 0 | 1
  gender: 'M' | 'F'
  ageBand: number
}
export interface PlantedPair {
  pair: number
  a: string
  b: string
  kind: 'same-station' | 'same-ac' | 'cross-ac'
}
const plan = new Map<string, Twin[]>()
let planted: PlantedPair[] = []

const boothOrder = (a: VoterSource, b: VoterSource) => a.ac - b.ac || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1])

export function installDuplicatePlan(sources: VoterSource[]) {
  plan.clear()
  cache.clear()
  plantedRefs.clear()
  planted = []
  const list = sources.filter((s) => s.electors).sort(boothOrder)
  if (list.length < 2) return
  const r = rng(hash('duplicate-plan'))
  const pickFrom = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const total = list.reduce((a, s) => a + s.electors!.male + s.electors!.female + s.electors!.thirdGender, 0)
  const pairs = Math.round(total / 450)
  for (let pair = 0; pair < pairs; pair++) {
    const a = pickFrom(list)
    const u = r()
    const kind: PlantedPair['kind'] = u < 0.15 ? 'same-station' : u < 0.25 ? 'cross-ac' : 'same-ac'
    const pool =
      kind === 'same-station' ? [a] : list.filter((s) => s !== a && (kind === 'cross-ac' ? s.ac !== a.ac : s.ac === a.ac))
    if (pool.length === 0) continue
    const b = pickFrom(pool)
    const gender: 'M' | 'F' = r() < 0.5 ? 'M' : 'F'
    let ageBand = 1 + Math.floor(r() * 6) // 20s … 70s
    for (let i = 0; i < 6 && !(a.electors!.ages[ageBand] > 2 && b.electors!.ages[ageBand] > 2); i++)
      ageBand = 1 + Math.floor(r() * 6)
    for (const [s, slot] of [[a, 0], [b, 1]] as const) {
      if (!plan.has(s.id)) plan.set(s.id, [])
      plan.get(s.id)!.push({ pair, slot, gender, ageBand })
    }
    planted.push({ pair, a: a.id, b: b.id, kind })
  }
}

/** The planted pairs (for tests and for the "how good is the scan" check). */
export const plantedPairs = () => planted
/** Where each planted copy landed, "pair:slot" → station id + serial (filled as lists are generated). */
export const plantedRefs = new Map<string, { boothId: string; serial: number }>()

/** Rewrites one voter as copy `slot` of planted pair `t`. */
function applyTwin(p: Omit<Voter, 'serial' | 'id'>, t: Twin) {
  const tr = rng(hash(`twin:${t.pair}`)) // shared by both copies
  const fam = familyName(tr)
  const first = (t.gender === 'F' ? FEMALE : MALE)[Math.floor(tr() * (t.gender === 'F' ? FEMALE : MALE).length)]
  const relFirst = MALE[Math.floor(tr() * MALE.length)]
  const relation: Voter['relation'] = t.gender === 'F' ? (tr() < 0.5 ? 'W/o' : 'D/o') : 'S/o'
  const [lo, hi] = BAND_RANGE[t.ageBand]
  const age = lo + 1 + Math.floor(tr() * (hi - lo - 1))
  const style = Math.floor(tr() * 4)
  let name = `${fam} ${first}` // "Rote Santhosh"
  let relative = `${fam} ${relFirst}`
  let a = age
  if (t.slot === 1) {
    const vr = rng(hash(`variant:${t.pair}`))
    if (style === 0) name = `${fam} ${variantOf(first, vr)}` // "Rote Santosh"
    else if (style === 1) {
      name = `${fam[0]}. ${variantOf(first, vr)}` // "R. Santosh"
      a = Math.min(hi, age + 1)
    } else if (style === 2) {
      relative = `${fam[0]}. ${variantOf(relFirst, vr)}` // relative's name spelled differently
      a = Math.max(lo, age - 1)
    } else name = `${variantOf(first, vr)} ${fam}` // "Santhos Rote": order swapped
  }
  Object.assign(p, { name, relative, relation, age: a })
}

/** The (synthetic) voter list for a station; [] if the station has no breakdown. */
export function votersOf(booth: VoterSource, opts: { cache?: boolean } = {}): Voter[] {
  const useCache = opts.cache ?? true
  const hit = useCache ? cache.get(booth.id) : undefined
  if (hit) return hit
  const e = booth.electors
  if (!e) return []
  const r = rng(hash(`voters:${booth.id}`))
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  // Exact counts from the station's totals.
  const genders = shuffle([
    ...Array<Gender>(e.male).fill('M'),
    ...Array<Gender>(e.female).fill('F'),
    ...Array<Gender>(e.thirdGender).fill('TG'),
  ])
  const bands = shuffle(e.ages.flatMap((n, i) => Array<number>(n).fill(i)))
  const n = Math.min(genders.length, bands.length)

  // Group into households of 1–6 voters, averaging the station's household size.
  const households = Math.max(1, e.households ?? Math.round(n / 2.5))
  const avg = n / households
  const sizes: number[] = []
  for (let left = n; left > 0; ) {
    const size = Math.min(left, Math.max(1, Math.round(avg + (r() - 0.5) * 3)))
    sizes.push(size)
    left -= size
  }

  const rural = booth.ac === 79
  const block = 1 + Math.floor(r() * 12)
  const street = 1 + Math.floor(r() * 9)
  let houseNo = 1 + Math.floor(r() * 40)

  const people: Omit<Voter, 'serial' | 'id'>[] = []
  let k = 0
  sizes.forEach((size, h) => {
    houseNo += 1 + Math.floor(r() * 3)
    const house = rural ? `${block}-${houseNo}` : `${block}-${street}-${houseNo}/${1 + Math.floor(r() * 9)}`
    // Family name shared by the house ("Konavali Srinivas"); some rolls print just
    // its initial ("K. Srinivas").
    const fam = familyName(r)
    const initial = r() < 0.03 ? `${fam[0]}.` : fam
    const name = (g: Gender) =>
      `${initial} ${g === 'F' ? pick(FEMALE) : g === 'M' ? pick(MALE) : pick(r() < 0.5 ? MALE : FEMALE)}`

    // Members of this house, oldest first.
    const members = Array.from({ length: size }, () => {
      const gender = genders[k]
      const ageBand = bands[k++]
      const [lo, hi] = BAND_RANGE[ageBand]
      return { gender, ageBand, age: lo + Math.floor(r() * (hi - lo + 1)), name: '' }
    }).sort((x, y) => y.age - x.age)
    // Names sound different within a house (so "S/o X" points to one person, and
    // two sisters aren't "Sravani" and "Shravani").
    const taken = new Set<string>()
    // The family part is shared, so compare the given name only (from a fixed list → cached).
    const sound = (n: string) => givenSound(n.slice(initial.length + 1))
    const unique = (make: () => string) => {
      let n = make()
      for (let i = 0; taken.has(sound(n)) && i < 20; i++) n = make()
      taken.add(sound(n))
      return n
    }
    members.forEach((m) => (m.name = unique(() => name(m.gender))))

    // Relations follow ages: the oldest man heads the house; a woman close to his
    // age is his wife; anyone 16+ years younger is his child; others are siblings.
    const head = members.find((m) => m.gender === 'M') ?? members[0]
    const headParent = unique(() => `${initial} ${pick(MALE)}`) // not on this list
    let wife = false
    for (const m of members) {
      let relation: Voter['relation']
      let relative: string
      if (m.gender === 'TG') {
        relation = 'C/o'
        relative = m === head ? headParent : head.name
      } else if (m === head) {
        if (m.gender === 'F' && m.age >= 24) {
          relation = 'W/o'
          relative = unique(() => `${initial} ${pick(MALE)}`) // husband, not on this list
        } else {
          relation = m.gender === 'F' ? 'D/o' : 'S/o'
          relative = headParent
        }
      } else if (head.gender === 'M' && m.gender === 'F' && !wife && m.age >= 20 && Math.abs(m.age - head.age) <= 15) {
        wife = true
        relation = 'W/o'
        relative = head.name
      } else if (m.age <= head.age - 16) {
        relation = m.gender === 'F' ? 'D/o' : 'S/o'
        relative = head.name
      } else {
        relation = m.gender === 'F' ? 'D/o' : 'S/o'
        relative = headParent
      }
      people.push({ name: m.name, relation, relative, gender: m.gender, age: m.age, ageBand: m.ageBand, house, household: h })
    }
  })

  // Planted duplicates: overwrite a voter of the right gender and age band who
  // isn't anyone's "S/o / W/o" in their house, so family links stay consistent.
  const twins = plan.get(booth.id)
  if (twins && people.length) {
    const referenced = new Set(people.map((p) => `${p.household}|${p.relative}`))
    const usedIdx = new Set<number>()
    for (const t of twins) {
      const start = hash(`slot:${t.pair}:${t.slot}`) % people.length
      for (let j = 0; j < people.length; j++) {
        const i = (start + j) % people.length
        const p = people[i]
        if (usedIdx.has(i) || p.gender !== t.gender || p.ageBand !== t.ageBand) continue
        if (referenced.has(`${p.household}|${p.name}`)) continue
        usedIdx.add(i)
        applyTwin(p, t)
        plantedRefs.set(`${t.pair}:${t.slot}`, { boothId: booth.id, serial: i + 1 })
        break
      }
    }
  }

  // Sample IDs: unique within the station, clearly not real (SMP prefix).
  const used = new Set<string>()
  const list = people.map((p, i) => {
    let id: string
    do id = `SMP${String(Math.floor(r() * 1e7)).padStart(7, '0')}`
    while (used.has(id))
    used.add(id)
    return { ...p, serial: i + 1, id }
  })
  if (useCache) cache.set(booth.id, list)
  return list
}

export const GENDER_LABEL: Record<Gender, string> = { M: 'Male', F: 'Female', TG: 'Third gender' }
export { AGE_BANDS }
