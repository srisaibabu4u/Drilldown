#!/usr/bin/env node
// Import Kukatpally (AC 46) polling stations into src/data/booths.json.
//
// Usage:
//   node scripts/import-booths.mjs <stations.csv> [--source "CEO Telangana PS list, 2025"]
//
// CSV columns (header row required, see data/booths-template.csv):
//   ps_no, name, address, lat, lng, voters
// lat/lng and voters are optional. Rows without lat/lng are geocoded with
// OpenStreetMap Nominatim (max 1 request/second, results cached in
// scripts/.geocode-cache.json). Check the "approx" rows by hand afterwards:
// those only matched the locality, not the building.
//
// Get the station list from the Chief Electoral Officer, Telangana
// (ceotelangana.nic.in -> Polling Stations). If it is a PDF, convert the table
// to CSV first (e.g. with Tabula, or by opening it in Excel / Google Sheets).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'src/data/booths.json')
const CACHE = resolve(root, 'scripts/.geocode-cache.json')

// Rough box around Kukatpally / Moosapet / Balanagar (lng/lat) to keep matches local.
const VIEWBOX = '78.33,17.53,78.50,17.43'

const args = process.argv.slice(2)
const input = args.find((a) => !a.startsWith('--'))
const sourceIdx = args.indexOf('--source')
const source = sourceIdx >= 0 ? args[sourceIdx + 1] : 'Chief Electoral Officer, Telangana'
if (!input) {
  console.error('Usage: node scripts/import-booths.mjs <stations.csv> [--source "..."]')
  process.exit(1)
}

function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f.trim())) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim())) rows.push(row)
  const [head, ...body] = rows
  const keys = head.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function nominatim(q) {
  if (q in cache) return cache[q]
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({ q, format: 'jsonv2', limit: '1', countrycodes: 'in', viewbox: VIEWBOX, bounded: '1' })
  const res = await fetch(url, { headers: { 'User-Agent': 'kukatpally-drilldown-import/1.0' } })
  await sleep(1100) // Nominatim usage policy: max 1 request per second
  if (!res.ok) throw new Error(`Nominatim ${res.status} for "${q}"`)
  const [hit] = await res.json()
  cache[q] = hit ? { lat: +hit.lat, lng: +hit.lon } : null
  writeFileSync(CACHE, JSON.stringify(cache, null, 1))
  return cache[q]
}

const clean = (s) => s.replace(/\s+/g, ' ').replace(/^(room|r\.?no\.?)\s*[\w-]+[,\s]*/i, '').trim()

async function locate(name, address) {
  const tries = [
    [`${clean(name)}, ${address}, Hyderabad`, 'geocoded'],
    [`${clean(name)}, Kukatpally, Hyderabad`, 'geocoded'],
    [`${address}, Hyderabad`, 'approx'],
  ]
  // Last resort: the most specific locality word in the address.
  const locality = address.split(',').map((s) => s.trim()).filter(Boolean).pop()
  if (locality) tries.push([`${locality}, Hyderabad`, 'approx'])
  for (const [q, precision] of tries) {
    const hit = await nominatim(q)
    if (hit) return { ...hit, precision }
  }
  return null
}

const rows = parseCsv(readFileSync(input, 'utf8'))
const out = []
const missing = []
for (const r of rows) {
  const no = Number(r.ps_no)
  if (!Number.isFinite(no) || !r.name) continue
  const voters = r.voters ? Number(r.voters.replace(/,/g, '')) : undefined
  let pos = null
  if (r.lat && r.lng) pos = { lat: +r.lat, lng: +r.lng, precision: 'manual' }
  else pos = await locate(r.name, r.address || '')
  if (!pos) { missing.push(no); continue }
  out.push({ no, name: r.name, address: r.address || '', lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), ...(Number.isFinite(voters) ? { voters } : {}), precision: pos.precision })
  process.stdout.write(`\r${out.length}/${rows.length} located`)
}

writeFileSync(OUT, JSON.stringify({ ac: 46, acName: 'Kukatpally', synthetic: false, source, updated: new Date().toISOString().slice(0, 10), booths: out }, null, 1) + '\n')
const approx = out.filter((b) => b.precision === 'approx').map((b) => b.no)
console.log(`\nWrote ${out.length} booths to ${OUT}`)
if (approx.length) console.log(`Approximate (locality only), check by hand: ${approx.join(', ')}`)
if (missing.length) console.log(`Not found, add lat/lng in the CSV: ${missing.join(', ')}`)
