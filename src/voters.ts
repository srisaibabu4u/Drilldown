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
// percentages. Names use initials rather than surnames for the same reason.
import { AGE_BANDS, type Booth } from './booths'

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
]
const FEMALE = [
  'Lakshmi', 'Padma', 'Sunitha', 'Anitha', 'Kavitha', 'Swathi', 'Sravani', 'Bhavani', 'Saritha', 'Renuka',
  'Manjula', 'Jyothi', 'Radha', 'Sujatha', 'Vijaya', 'Laxmamma', 'Yadamma', 'Sailaja', 'Divya', 'Priyanka',
  'Mounika', 'Haritha', 'Sandhya', 'Rani', 'Aruna', 'Pushpa', 'Saraswathi', 'Kalpana', 'Shobha', 'Vani',
  'Keerthi', 'Navya', 'Sowmya', 'Pavani', 'Deepika', 'Rajitha', 'Sirisha', 'Hema', 'Geetha', 'Usha',
]
const INITIALS = 'ABCDGJKLMNPRSTVY'

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
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

/** The (synthetic) voter list for a station; [] if the station has no breakdown. */
export function votersOf(booth: Booth): Voter[] {
  const hit = cache.get(booth.id)
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
    const initial = INITIALS[Math.floor(r() * INITIALS.length)]
    const name = (g: Gender) =>
      `${initial}. ${g === 'F' ? pick(FEMALE) : g === 'M' ? pick(MALE) : pick(r() < 0.5 ? MALE : FEMALE)}`

    // Members of this house, oldest first.
    const members = Array.from({ length: size }, () => {
      const gender = genders[k]
      const ageBand = bands[k++]
      const [lo, hi] = BAND_RANGE[ageBand]
      return { gender, ageBand, age: lo + Math.floor(r() * (hi - lo + 1)), name: '' }
    }).sort((x, y) => y.age - x.age)
    // Names are unique within a house (so "S/o X" always points to one person).
    const taken = new Set<string>()
    const unique = (make: () => string) => {
      let n = make()
      for (let i = 0; taken.has(n) && i < 20; i++) n = make()
      taken.add(n)
      return n
    }
    members.forEach((m) => (m.name = unique(() => name(m.gender))))

    // Relations follow ages: the oldest man heads the house; a woman close to his
    // age is his wife; anyone 16+ years younger is his child; others are siblings.
    const head = members.find((m) => m.gender === 'M') ?? members[0]
    const headParent = unique(() => `${initial}. ${pick(MALE)}`) // not on this list
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
          relative = unique(() => `${initial}. ${pick(MALE)}`) // husband, not on this list
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

  // Sample IDs: unique within the station, clearly not real (SMP prefix).
  const used = new Set<string>()
  const list = people.map((p, i) => {
    let id: string
    do id = `SMP${String(Math.floor(r() * 1e7)).padStart(7, '0')}`
    while (used.has(id))
    used.add(id)
    return { ...p, serial: i + 1, id }
  })
  cache.set(booth.id, list)
  return list
}

export const GENDER_LABEL: Record<Gender, string> = { M: 'Male', F: 'Female', TG: 'Third gender' }
export { AGE_BANDS }
