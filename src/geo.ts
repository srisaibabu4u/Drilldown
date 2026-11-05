import { geoArea, geoMercator, geoPath } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import indiaRaw from './data/geo/india-states.json'
import tsRaw from './data/geo/telangana-districts.json'
import wardsRaw from './data/geo/ghmc-wards.json'
import { combine, DISTRICTS, GHMC, INDIA, STATES, wardStats, type Stats } from './data/stats'

export type ViewId = 'india' | 'telangana' | 'ghmc' | 'kukatpally'

export interface Region {
  id: string
  name: string
  feature: Feature<Geometry>
  areaKm2: number
  stats?: Stats
  /** View this region opens when clicked, if it can be drilled into. */
  drillTo?: ViewId
  wardNo?: number
}

export const VIRTUAL_W = 1000
export const VIRTUAL_H = 1000

const EARTH_R = 6371

/**
 * d3-geo uses spherical winding: a polygon whose rings run the "wrong" way is read
 * as the whole globe minus the shape. Normalise each polygon so it covers < hemisphere.
 */
function rewind(fc: FeatureCollection): FeatureCollection {
  const fixPoly = (rings: Position[][]) =>
    geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === 'Polygon') g.coordinates = fixPoly(g.coordinates)
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fixPoly)
  }
  return fc
}

/** One projection for every level, so drilling is a single continuous zoom. */
const indiaFc = rewind(indiaRaw as unknown as FeatureCollection)
export const projection = geoMercator().fitExtent(
  [
    [20, 20],
    [VIRTUAL_W - 20, VIRTUAL_H - 20],
  ],
  indiaFc,
)
export const pathGen = geoPath(projection).digits(4)

const km2 = (f: Feature) => geoArea(f) * EARTH_R * EARTH_R

/** GHMC wards that make up the Kukatpally area (Kukatpally / Moosapet circles). */
export const KUKATPALLY_WARDS = [114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124]

const DRILLABLE_DISTRICTS = new Set(['Hyderabad', 'Medchal Malkajgiri', 'Ranga Reddy', 'Sangareddy'])

export const states: Region[] = indiaFc.features.map((f) => {
  const name = f.properties!.st_nm as string
  return {
    id: `st-${name}`,
    name,
    feature: f,
    areaKm2: km2(f),
    stats: STATES[name],
    drillTo: name === 'Telangana' ? 'telangana' : undefined,
  }
})

export const districts: Region[] = rewind(tsRaw as unknown as FeatureCollection).features.map((f) => {
  const name = f.properties!.district as string
  return {
    id: `dt-${name}`,
    name,
    feature: f,
    areaKm2: km2(f),
    stats: DISTRICTS[name],
    drillTo: DRILLABLE_DISTRICTS.has(name) ? 'ghmc' : undefined,
  }
})

export const wards: Region[] = rewind(wardsRaw as unknown as FeatureCollection).features
  .map((f) => {
    const raw = String(f.properties!.name ?? '')
    const m = raw.match(/^Ward\s+(\d+)\s+(.*)$/)
    const wardNo = m ? Number(m[1]) : NaN
    const name = m ? m[2] : raw
    return {
      id: `wd-${raw}`,
      name,
      wardNo,
      feature: f,
      areaKm2: km2(f),
      stats: Number.isFinite(wardNo) ? wardStats(wardNo) : undefined,
      drillTo: KUKATPALLY_WARDS.includes(wardNo) ? ('kukatpally' as ViewId) : undefined,
    }
  })
  .filter((w) => Number.isFinite(w.wardNo))

export const kukatpallyWards = wards
  .filter((w) => KUKATPALLY_WARDS.includes(w.wardNo!))
  .map((w) => ({ ...w, drillTo: undefined }))

export interface ViewDef {
  id: ViewId
  title: string
  subtitle: string
  levelLabel: string
  childLabel: string
  regions: Region[]
  focus: Feature[] // features the camera fits to
  total: Stats
  areaKm2: number
  parent?: ViewId
}

const sum = (rs: Region[]) => rs.reduce((a, r) => a + r.areaKm2, 0)
const telangana = states.find((s) => s.name === 'Telangana')!

export const VIEWS: Record<ViewId, ViewDef> = {
  india: {
    id: 'india',
    title: 'India',
    subtitle: '36 states & union territories',
    levelLabel: 'Country',
    childLabel: 'States',
    regions: states,
    focus: states.map((s) => s.feature),
    total: INDIA,
    areaKm2: sum(states),
  },
  telangana: {
    id: 'telangana',
    title: 'Telangana',
    subtitle: '33 districts',
    levelLabel: 'State',
    childLabel: 'Districts',
    regions: districts,
    focus: [telangana.feature],
    total: STATES['Telangana'],
    areaKm2: telangana.areaKm2,
    parent: 'india',
  },
  ghmc: {
    id: 'ghmc',
    title: 'Greater Hyderabad',
    subtitle: `GHMC · ${wards.length} wards mapped`,
    levelLabel: 'City',
    childLabel: 'Wards',
    regions: wards,
    focus: wards.map((w) => w.feature),
    total: GHMC,
    areaKm2: sum(wards),
    parent: 'telangana',
  },
  kukatpally: {
    id: 'kukatpally',
    title: 'Kukatpally',
    subtitle: `${kukatpallyWards.length} GHMC wards`,
    levelLabel: 'Area',
    childLabel: 'Wards',
    regions: kukatpallyWards,
    focus: kukatpallyWards.map((w) => w.feature),
    total: combine(kukatpallyWards.map((w) => w.stats!)),
    areaKm2: sum(kukatpallyWards),
    parent: 'ghmc',
  },
}

export const VIEW_ORDER: ViewId[] = ['india', 'telangana', 'ghmc', 'kukatpally']

/** Bounding box of features in projected (virtual) units. */
export function boundsOf(features: Feature[]): [[number, number], [number, number]] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const f of features) {
    const [[a, b], [c, d]] = pathGen.bounds(f)
    x0 = Math.min(x0, a)
    y0 = Math.min(y0, b)
    x1 = Math.max(x1, c)
    y1 = Math.max(y1, d)
  }
  return [
    [x0, y0],
    [x1, y1],
  ]
}

export function centroid(f: Feature): [number, number] {
  return pathGen.centroid(f) as [number, number]
}
