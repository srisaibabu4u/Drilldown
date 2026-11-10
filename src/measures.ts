import { boothsOfAc, summarize, type ElectorSummary, type Site } from './booths'

/** A per-station statistic the map can colour polling stations by. */
export interface Measure {
  id: string
  label: string
  /** Value for a group of stations (one building, a ward, …); undefined if no data. */
  value: (s: ElectorSummary) => number | undefined
  format: (v: number) => string
}

const pct = (v: number) => `${v.toFixed(1)}%`
const share = (part: (s: ElectorSummary) => number | undefined) => (s: ElectorSummary) => {
  const p = part(s)
  return p === undefined || s.electors === 0 ? undefined : (p / s.electors) * 100
}

export const MEASURES: Measure[] = [
  { id: 'turnout', label: 'Turnout (last AE)', value: (s) => s.turnout, format: pct },
  { id: 'electors', label: 'Electors', value: (s) => s.electors, format: (v) => Math.round(v).toLocaleString('en-IN') },
  { id: 'firstTime', label: 'First-time voters (18–19)', value: share((s) => s.ages[0]), format: pct },
  { id: 'women', label: 'Women electors', value: share((s) => s.female), format: pct },
  { id: 'seniors', label: 'Electors aged 80+', value: share((s) => s.ages[s.ages.length - 1]), format: pct },
  { id: 'sc', label: 'SC electors', value: share((s) => s.social?.[0]), format: pct },
  { id: 'st', label: 'ST electors', value: share((s) => s.social?.[1]), format: pct },
  { id: 'bc', label: 'BC electors', value: share((s) => s.social?.[2]), format: pct },
  { id: 'oc', label: 'OC electors', value: share((s) => s.social?.[3]), format: pct },
]

export type MeasureClass = 0 | 1 | 2 // below, around, above average

export interface MeasureScale {
  measure: Measure
  /** Constituency-wide value (elector-weighted where it applies). */
  average: number
  low: number
  high: number
  classOf: (v: number | undefined) => MeasureClass | undefined
  /** Value for one map pin (a building). */
  siteValue: (site: Site) => number | undefined
  /** Custom class names (e.g. coverage); default: below / around / above average. */
  labels?: string[]
}

export const CLASS_LABELS = ['Below average', 'Around average', 'Above average']

/**
 * Three classes around the constituency average: a station is "around average"
 * when it is within half a standard deviation of it (measured across stations).
 */
export function scaleFor(measure: Measure, ac: number): MeasureScale | null {
  const booths = boothsOfAc(ac)
  const all = summarize(booths)
  const average = all ? measure.value(all) : undefined
  const values = booths.map((b) => summarize([b])).map((s) => (s ? measure.value(s) : undefined))
  const nums = values.filter((v): v is number => v !== undefined)
  if (average === undefined || nums.length === 0) return null
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length)
  const low = average - sd / 2
  const high = average + sd / 2
  const siteCache = new Map<Site, number | undefined>()
  return {
    measure,
    average,
    low,
    high,
    classOf: (v) => (v === undefined ? undefined : v < low ? 0 : v > high ? 2 : 1),
    siteValue: (site) => {
      if (!siteCache.has(site)) {
        const s = summarize(site.booths)
        siteCache.set(site, s ? measure.value(s) : undefined)
      }
      return siteCache.get(site)
    },
  }
}

/** Measures that actually have data in a constituency's stations. */
export const availableMeasures = (ac: number) => MEASURES.filter((m) => scaleFor(m, ac) !== null)
