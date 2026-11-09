#!/usr/bin/env node
// Writes SYNTHETIC polling stations to src/data/booths.json so the booth layer
// can be demoed before the official lists are imported. Every station is made up:
// positions are random points inside the map units and names are generic.
//   - AC 46 Kukatpally: urban stations inside the 11 GHMC wards
//   - AC 79 Gadwal: rural village stations inside its 4 mandals
// Each AC uses its own random streams, so changing one never moves the other.
// The app labels this data "Sample" everywhere. Replace it with
// `npm run import:booths -- stations.csv` when the real list is available.
//
// Usage: node scripts/generate-sample-booths.mjs [kukatpallyCount=417] [gadwalCount=296]
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

// Separate random stream for social categories, so adding them doesn't move
// any station or change the other numbers.
let seed2 = 2024
const rnd2 = () => {
  seed2 = (seed2 + 0x6d2b79f5) | 0
  let t = Math.imul(seed2 ^ (seed2 >>> 15), 1 | seed2)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

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

// Elector age bands (must match AGE_BANDS in src/booths.ts) and a rough urban
// Hyderabad profile to jitter around.
const AGE_SHARES = [0.025, 0.21, 0.25, 0.2, 0.14, 0.1, 0.05, 0.025] // 18-19 … 80+
// Social categories (must match SOCIAL_GROUPS in src/booths.ts): SC, ST, BC, OC.
// Rough urban mix to jitter around; illustrative only.
const SOCIAL_SHARES = [0.15, 0.04, 0.47, 0.34]
const wardTurnout = Object.fromEntries(KUKATPALLY_WARDS.map((n) => [n, 44 + rnd() * 10]))

/** Synthetic electoral-roll breakdown for one station. */
function electorsFor(total, wardNo) {
  const tg = rnd() < 0.15 ? 1 + Math.floor(rnd() * 2) : 0
  const female = Math.round((total - tg) * (0.465 + rnd() * 0.04))
  const male = total - tg - female
  const w = AGE_SHARES.map((s) => s * (0.8 + rnd() * 0.4))
  const sum = w.reduce((a, b) => a + b, 0)
  const ages = w.map((x) => Math.floor((x / sum) * total))
  ages[3] += total - ages.reduce((a, b) => a + b, 0) // keep the bands summing to total
  const turnout = Math.min(72, Math.max(34, wardTurnout[wardNo] + (rnd() - 0.5) * 16))
  const sw = SOCIAL_SHARES.map((x) => x * (0.7 + rnd2() * 0.6))
  const ssum = sw.reduce((a, b) => a + b, 0)
  const social = sw.map((x) => Math.floor((x / ssum) * total))
  social[2] += total - social.reduce((a, b) => a + b, 0)
  return {
    male,
    female,
    thirdGender: tg,
    ages,
    social,
    households: Math.round(total / (2.2 + rnd() * 0.6)),
    turnout: +turnout.toFixed(1),
  }
}

const totalArea = wards.reduce((a, w) => a + w.area, 0)
const booths = [] // Kukatpally
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
      const voters = 700 + Math.round(rnd() * 750)
      booths.push({
        ward: w.no,
        name: rooms > 1 ? `${building} (Room ${r})` : building,
        address,
        lat: +pt[1].toFixed(6),
        lng: +pt[0].toFixed(6),
        voters,
        precision: 'manual',
        electors: electorsFor(voters, w.no),
      })
    }
    made += rooms
  }
}
booths.sort((a, b) => a.ward - b.ward || b.lat - a.lat)
const kukatpally = booths.slice(0, COUNT).map(({ ward, ...b }, i) => ({ ac: 46, no: i + 1, ...b }))

// ---------------------------------------------------------------------------
// AC 79 Gadwal — rural: stations sit in village schools spread over 4 mandals.
// ---------------------------------------------------------------------------
const G_COUNT = Number(process.argv[3] ?? 296)
const stream = (s) => () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const g = stream(79)
const gPick = (a) => a[Math.floor(g() * a.length)]
const mandals = JSON.parse(readFileSync(resolve(root, 'src/data/geo/gadwal-mandals.json'), 'utf8')).features.map((f) => {
  const geom = f.geometry
  if (geom.type === 'Polygon') geom.coordinates = fixPoly(geom.coordinates)
  else geom.coordinates = geom.coordinates.map(fixPoly)
  return { name: f.properties.name, f, area: geoArea(f) }
})
const G_BUILDINGS = [
  'Mandal Parishad Primary School',
  'Zilla Parishad High School',
  'Gram Panchayat Office',
  'Anganwadi Centre',
  'Mandal Parishad Upper Primary School',
  'Community Hall',
]
// Rural Gadwal mix (illustrative): older roll, near-equal gender, high turnout.
const G_AGE = [0.03, 0.2, 0.22, 0.19, 0.15, 0.11, 0.07, 0.03]
const G_SOCIAL = [0.19, 0.02, 0.58, 0.21]
const mandalTurnout = Object.fromEntries(mandals.map((m) => [m.name, 77 + g() * 8]))

function gElectors(total, mandal) {
  const tg = g() < 0.05 ? 1 : 0
  const female = Math.round((total - tg) * (0.485 + g() * 0.03))
  const w = G_AGE.map((s) => s * (0.8 + g() * 0.4))
  const sum = w.reduce((a, b) => a + b, 0)
  const ages = w.map((x) => Math.floor((x / sum) * total))
  ages[3] += total - ages.reduce((a, b) => a + b, 0)
  const sw = G_SOCIAL.map((x) => x * (0.6 + g() * 0.8))
  const ssum = sw.reduce((a, b) => a + b, 0)
  const social = sw.map((x) => Math.floor((x / ssum) * total))
  social[2] += total - social.reduce((a, b) => a + b, 0)
  return {
    male: total - tg - female,
    female,
    thirdGender: tg,
    ages,
    social,
    households: Math.round(total / (2.4 + g() * 0.7)),
    turnout: +Math.min(92, Math.max(62, mandalTurnout[mandal] + (g() - 0.5) * 14)).toFixed(1),
  }
}

const gBooths = []
const gArea = mandals.reduce((a, m) => a + m.area, 0)
for (const m of mandals) {
  const n = Math.round((m.area / gArea) * G_COUNT)
  const [[x0, y0], [x1, y1]] = geoBounds(m.f)
  let made = 0
  let village = 0
  while (made < n) {
    village++
    let pt
    do pt = [x0 + g() * (x1 - x0), y0 + g() * (y1 - y0)]
    while (!geoContains(m.f, pt))
    const vname = `${m.name} Village ${String(village).padStart(2, '0')}`
    const building = `${gPick(G_BUILDINGS)}, ${vname}`
    const rooms = Math.min(n - made, g() < 0.6 ? 1 : 2 + Math.floor(g() * 2))
    for (let r = 1; r <= rooms; r++) {
      const voters = 420 + Math.round(g() * 780)
      gBooths.push({
        mandal: m.name,
        name: rooms > 1 ? `${building} (Room ${r})` : building,
        address: `${vname}, ${m.name} mandal, Jogulamba Gadwal`,
        lat: +pt[1].toFixed(6),
        lng: +pt[0].toFixed(6),
        voters,
        precision: 'manual',
        electors: gElectors(voters, m.name),
      })
    }
    made += rooms
  }
}
gBooths.sort((a, b) => a.mandal.localeCompare(b.mandal) || b.lat - a.lat)
const gadwal = gBooths.slice(0, G_COUNT).map(({ mandal, ...b }, i) => ({ ac: 79, no: i + 1, ...b }))

writeFileSync(
  resolve(root, 'src/data/booths.json'),
  JSON.stringify(
    {
      acs: [46, 79].map((ac) => ({
        ac,
        name: ac === 46 ? 'Kukatpally' : 'Gadwal',
        synthetic: true,
        source: 'Synthetic sample data (not real polling stations)',
        updated: new Date().toISOString().slice(0, 10),
      })),
      booths: [...kukatpally, ...gadwal],
    },
    null,
    1,
  ) + '\n',
)
console.log(`Wrote ${kukatpally.length} Kukatpally + ${gadwal.length} Gadwal synthetic stations`)
