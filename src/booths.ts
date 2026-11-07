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
  source: string
  updated: string
  booths: Omit<Booth, 'x' | 'y' | 'wardNo'>[]
}

const file = raw as BoothFile

export const boothMeta = { ac: file.ac, acName: file.acName, source: file.source, updated: file.updated }

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
  const s = q.trim().toLowerCase()
  if (!s) return list
  return list.filter(
    (b) => String(b.no) === s || b.name.toLowerCase().includes(s) || b.address.toLowerCase().includes(s),
  )
}
