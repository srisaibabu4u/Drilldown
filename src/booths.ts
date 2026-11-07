import { geoContains } from 'd3-geo'
import raw from './data/booths.json'
import { kukatpallyWards, projection } from './geo'

/** How the booth's position was obtained (set by scripts/import-booths.mjs). */
export type Precision = 'manual' | 'geocoded' | 'approx'

export interface Booth {
  no: number
  name: string
  address: string
  lat: number
  lng: number
  voters?: number
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
