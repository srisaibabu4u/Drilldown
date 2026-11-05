import type { Region } from './geo'

const intFmt = new Intl.NumberFormat('en-IN')
export const fmtInt = (n: number) => intFmt.format(Math.round(n))

/** Indian short scale: 12.1 Cr, 3.5 L, 48.2K */
export function fmtShort(n: number) {
  if (n >= 1e7) return `${(n / 1e7).toFixed(n >= 1e9 ? 0 : 1)} Cr`
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

export const fmtDensity = (d: number) => `${fmtInt(d)} / km²`
export const fmtArea = (a: number) => (a >= 100 ? `${fmtInt(a)} km²` : `${a.toFixed(1)} km²`)
export const fmtPct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`

// Sequential blue ramp (light → dark), used for population density.
export const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']

export interface DensityScale {
  thresholds: number[] // RAMP.length - 1 cut points
}

const density = (r: Region) => (r.stats ? r.stats.population / r.areaKm2 : NaN)

/** Quantile breaks over the regions currently on screen. */
export function densityScale(regions: Region[]): DensityScale {
  const vals = regions.map(density).filter(Number.isFinite).sort((a, b) => a - b)
  const n = RAMP.length
  const thresholds: number[] = []
  for (let i = 1; i < n; i++) thresholds.push(vals[Math.floor((i / n) * (vals.length - 1))] ?? 0)
  return { thresholds }
}

export function densityIndex(s: DensityScale, v: number) {
  let i = 0
  while (i < s.thresholds.length && v >= s.thresholds[i]) i++
  return i
}

export function densityColor(s: DensityScale, r: Region) {
  const v = density(r)
  return Number.isFinite(v) ? RAMP[densityIndex(s, v)] : 'var(--no-data)'
}
