#!/usr/bin/env node
// Writes SYNTHETIC polling stations to src/data/booths.json so the booth layer
// can be demoed before the official list is imported. Every station is made up:
// positions are random points inside the Kukatpally wards and names are generic.
// The app labels this data "Sample" everywhere. Replace it with
// `npm run import:booths -- stations.csv` when the real list is available.
//
// Usage: node scripts/generate-sample-booths.mjs [count=417]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geoArea, geoBounds, geoContains } from 'd3-geo'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COUNT = Number(process.argv[2] ?? 417)
const KUKATPALLY_WARDS = [114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124]

let seed = 46
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (a) => a[Math.floor(rnd() * a.length)]

// Same winding fix as src/geo.ts
const fixPoly = (rings) =>
  geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings
const wards = JSON.parse(readFileSync(resolve(root, 'src/data/geo/ghmc-wards.json'), 'utf8'))
  .features.map((f) => {
    const m = String(f.properties.name).match(/^Ward\s+(\d+)\s+(.*)$/)
    const g = f.geometry
    if (g.type === 'Polygon') g.coordinates = fixPoly(g.coordinates)
    else g.coordinates = g.coordinates.map(fixPoly)
    return m && { no: +m[1], name: m[2], f, area: geoArea(f) }
  })
  .filter((w) => w && KUKATPALLY_WARDS.includes(w.no))

const BUILDINGS = [
  'Govt. High School',
  'Govt. Primary School',
  'Mandal Parishad Primary School',
  'Zilla Parishad High School',
  'GHMC Community Hall',
  'Govt. Junior College',
  'Anganwadi Centre',
  'Ward Office Building',
]
const STREETS = ['Main Road', 'Road No. 1', 'Road No. 3', 'Road No. 5', 'Colony Road', 'Temple Street', 'Park Road', 'Cross Road']

const totalArea = wards.reduce((a, w) => a + w.area, 0)
const booths = []
for (const w of wards) {
  const n = Math.max(6, Math.round((w.area / totalArea) * COUNT))
  const [[x0, y0], [x1, y1]] = geoBounds(w.f)
  let made = 0
  while (made < n) {
    // one building hosts 1-4 stations (rooms)
    let pt
    do pt = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)]
    while (!geoContains(w.f, pt))
    const building = `${pick(BUILDINGS)}, ${w.name}`
    const address = `${pick(STREETS)}, ${w.name}, Hyderabad`
    const rooms = Math.min(n - made, 1 + Math.floor(rnd() * 4))
    for (let r = 1; r <= rooms; r++) {
      booths.push({
        ward: w.no,
        name: rooms > 1 ? `${building} (Room ${r})` : building,
        address,
        lat: +pt[1].toFixed(6),
        lng: +pt[0].toFixed(6),
        voters: 700 + Math.round(rnd() * 750),
        precision: 'manual',
      })
    }
    made += rooms
  }
}
booths.sort((a, b) => a.ward - b.ward || b.lat - a.lat)
const out = booths.slice(0, COUNT).map(({ ward, ...b }, i) => ({ no: i + 1, ...b }))

writeFileSync(
  resolve(root, 'src/data/booths.json'),
  JSON.stringify(
    { ac: 46, acName: 'Kukatpally', synthetic: true, source: 'Synthetic sample data (not real polling stations)', updated: new Date().toISOString().slice(0, 10), booths: out },
    null,
    1,
  ) + '\n',
)
console.log(`Wrote ${out.length} synthetic stations`)
