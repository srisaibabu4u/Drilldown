import { geoContains } from 'd3-geo'
import raw from './data/booths.json'
import { AC_VIEWS, projection, unitsOf, VIEWS } from './geo'
import { AGE_BANDS, SOCIAL_GROUPS } from './constants'

export { AGE_BANDS, SOCIAL_GROUPS }

/** How the booth's position was obtained (set by scripts/import-booths.mjs). */
export type Precision = 'manual' | 'geocoded' | 'approx'

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
  /** Unique across constituencies: `${ac}-${no}`. */
  id: string
  /** Assembly constituency number. */
  ac: number
  /** Polling station number within its constituency. */
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
  /** Map unit (ward / mandal) the station falls in, if any. */
  unitId?: string
  unitName?: string
  /** GHMC ward number, for stations in a Kukatpally ward. */
  wardNo?: number
}

type RawBooth = Omit<Booth, 'id' | 'x' | 'y' | 'unitId' | 'unitName' | 'wardNo' | 'ac'> & { ac?: number }

interface AcMeta {
  ac: number
  name: string
  /** true while this constituency holds made-up sample stations */
  synthetic: boolean
  source: string
  updated: string
}

interface BoothFile {
  acs?: AcMeta[]
  /** Older single-constituency files */
  ac?: number
  acName?: string
  synthetic?: boolean
  source?: string
  updated?: string
  booths: RawBooth[]
}

const file = raw as BoothFile
const metas: AcMeta[] =
  file.acs ??
  (file.ac
    ? [{ ac: file.ac, name: file.acName ?? '', synthetic: !!file.synthetic, source: file.source ?? '', updated: file.updated ?? '' }]
    : [])

/** Source details for one constituency's stations. */
export const acMeta = (ac: number): AcMeta =>
  metas.find((m) => m.ac === ac) ?? { ac, name: '', synthetic: false, source: '', updated: '' }

/** Overall flags (e.g. for the footer). */
export const boothMeta = { synthetic: metas.some((m) => m.synthetic) }

/** Map units of every constituency view, for assigning stations to them. */
const units = AC_VIEWS.flatMap((v) => unitsOf(v).map((r) => ({ r, ac: VIEWS[v].ac!.no })))

export const booths: Booth[] = file.booths
  .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng))
  .map((b) => {
    const ac = b.ac ?? file.ac ?? 46
    const [x, y] = projection([b.lng, b.lat])!
    const unit = units.find((u) => u.ac === ac && geoContains(u.r.feature, [b.lng, b.lat]))?.r
    return { ...b, ac, id: `${ac}-${b.no}`, x, y, unitId: unit?.unitId, unitName: unit?.name, wardNo: unit?.wardNo }
  })
  .sort((a, b) => a.ac - b.ac || a.no - b.no)

export const boothById = new Map(booths.map((b) => [b.id, b]))
export const boothsOfAc = (ac: number) => booths.filter((b) => b.ac === ac)
export const boothsInUnit = (unitId: string) => booths.filter((b) => b.unitId === unitId)

/** Constituency name for an AC number. */
export const acName = (ac: number) => AC_VIEWS.map((v) => VIEWS[v].ac!).find((a) => a.no === ac)?.name ?? `AC ${ac}`

/**
 * Every word must match: a number matches the station number, other words match
 * the building, address, constituency or ward/mandal name. "PS 12", "gadwal 12",
 * "ghattu school" all work.
 */
export function searchBooths(list: Booth[], q: string) {
  const words = q.trim().toLowerCase().replace(/^ps\s*/, '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return list
  return list.filter((b) => {
    const text = `${b.name} ${b.address} ${acName(b.ac)} ${b.unitName ?? ''}`.toLowerCase()
    return words.every((w) => (/^\d+$/.test(w) ? String(b.no) === w || text.includes(w) : text.includes(w)))
  })
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
  const key = `${b.ac}:${b.lat.toFixed(4)},${b.lng.toFixed(4)}`
  const site = siteMap.get(key)
  if (site) site.booths.push(b)
  else siteMap.set(key, { key, x: b.x, y: b.y, booths: [b] })
}
export const sites = [...siteMap.values()]
export const sitesOfAc = (ac: number) => sites.filter((s) => s.booths[0].ac === ac)
/** Site (building) of each station, by station id. */
export const siteOf = new Map(sites.flatMap((s) => s.booths.map((b) => [b.id, s] as const)))

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
