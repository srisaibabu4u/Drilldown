import { geoContains } from 'd3-geo'
import raw from './data/booths.json'
import { kukatpallyWards, projection } from './geo'

/** How the booth's position was obtained (set by scripts/import-booths.mjs). */
export type Precision = 'manual' | 'geocoded' | 'approx'

export const AGE_BANDS = ['18–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80+']

/** Broad social categories used in Telangana. */
export const SOCIAL_GROUPS = [
  { key: 'SC', label: 'SC', name: 'Scheduled Castes' },
  { key: 'ST', label: 'ST', name: 'Scheduled Tribes' },
  { key: 'BC', label: 'BC', name: 'Backward Classes' },
  { key: 'OC', label: 'OC', name: 'Other Castes' },
]

/** Electoral-roll breakdown for one station (all optional in real imports). */
export interface Electors {
  male: number
  female: number
  thirdGender: number
  /** Elector counts per AGE_BANDS entry. */
  ages: number[]
  /** Elector counts per SOCIAL_GROUPS entry (survey-based; not on official rolls). */
  social?: number[]
  households?: number
  /** Turnout at the last assembly election, percent. */
  turnout?: number
}

export interface Booth {
  no: number
  name: string
  address: string
  lat: number
  lng: number
  voters?: number
  electors?: Electors
  precision: Precision
  /** Projected map position (virtual units). */
  x: number
  y: number
  /** Ward number the booth falls in, if inside one of the Kukatpally wards. */
  wardNo?: number
}

interface BoothFile {
  ac: number
  acName: string
  /** true while the file holds made-up sample stations */
  synthetic?: boolean
  source: string
  updated: string
  booths: Omit<Booth, 'x' | 'y' | 'wardNo'>[]
}

const file = raw as BoothFile

export const boothMeta = {
  ac: file.ac,
  acName: file.acName,
  synthetic: !!file.synthetic,
  source: file.source,
  updated: file.updated,
}

export const booths: Booth[] = file.booths
  .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng))
  .map((b) => {
    const [x, y] = projection([b.lng, b.lat])!
    const ward = kukatpallyWards.find((w) => geoContains(w.feature, [b.lng, b.lat]))
    return { ...b, x, y, wardNo: ward?.wardNo }
  })
  .sort((a, b) => a.no - b.no)

export const boothsInWard = (wardNo: number) => booths.filter((b) => b.wardNo === wardNo)

export function searchBooths(list: Booth[], q: string) {
  const s = q.trim().toLowerCase().replace(/^ps\s*/, '')
  if (!s) return list
  return list.filter(
    (b) => String(b.no) === s || b.name.toLowerCase().includes(s) || b.address.toLowerCase().includes(s),
  )
}

/** A polling location: one building, possibly hosting several stations (rooms). */
export interface Site {
  key: string
  x: number
  y: number
  booths: Booth[]
}

// Stations within ~10 m of each other are treated as the same building.
const siteMap = new Map<string, Site>()
for (const b of booths) {
  const key = `${b.lat.toFixed(4)},${b.lng.toFixed(4)}`
  const site = siteMap.get(key)
  if (site) site.booths.push(b)
  else siteMap.set(key, { key, x: b.x, y: b.y, booths: [b] })
}
export const sites = [...siteMap.values()]
export const siteOf = new Map(sites.flatMap((s) => s.booths.map((b) => [b.no, s] as const)))

/** Building name without the trailing "(Room n)". */
export const buildingName = (b: Booth) => b.name.replace(/\s*\(Room\s*\w+\)\s*$/i, '')

export interface ElectorSummary {
  stations: number
  electors: number
  male: number
  female: number
  thirdGender: number
  ages: number[]
  /** Summed over stations that have it; undefined if none do. */
  social?: number[]
  households: number
  /** Elector-weighted turnout, percent (undefined if no station has it). */
  turnout?: number
  votesPolled: number
}

/** Adds up the elector breakdown of a set of stations. */
export function summarize(list: Booth[]): ElectorSummary | null {
  const withData = list.filter((b) => b.electors)
  if (withData.length === 0) return null
  const s: ElectorSummary = {
    stations: list.length,
    electors: 0,
    male: 0,
    female: 0,
    thirdGender: 0,
    ages: AGE_BANDS.map(() => 0),
    households: 0,
    votesPolled: 0,
  }
  let turnoutBase = 0
  for (const b of withData) {
    const e = b.electors!
    const total = e.male + e.female + e.thirdGender
    s.electors += total
    s.male += e.male
    s.female += e.female
    s.thirdGender += e.thirdGender
    e.ages.forEach((n, i) => (s.ages[i] += n))
    if (e.social) {
      s.social ??= SOCIAL_GROUPS.map(() => 0)
      e.social.forEach((n, i) => (s.social![i] += n))
    }
    s.households += e.households ?? 0
    if (e.turnout !== undefined) {
      s.votesPolled += Math.round((total * e.turnout) / 100)
      turnoutBase += total
    }
  }
  if (turnoutBase > 0) s.turnout = (s.votesPolled / turnoutBase) * 100
  return s
}
