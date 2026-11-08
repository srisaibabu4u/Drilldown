// Population statistics used by the drilldown.
//
// Provenance matters, so every record carries a `source`:
//  - "census-2011"  : Census of India 2011 figures (state totals; Telangana
//                     districts as re-aggregated after the 2016 reorganisation).
//  - "sample"       : ILLUSTRATIVE placeholder numbers, generated
//                     deterministically per ward. Replace them with official
//                     GHMC / Census ward data before using this for decisions.

export type Source = 'census-2011' | 'sample'

export interface AgeGroup {
  label: string
  share: number // 0..1
}

export interface Stats {
  population: number
  source: Source
  households?: number
  sexRatio?: number // females per 1000 males
  literacy?: number // percent
  ageGroups?: AgeGroup[]
  workers?: number // percent of population in workforce
}

export const INDIA: Stats = {
  population: 1_210_854_977,
  source: 'census-2011',
  households: 249_501_663,
  sexRatio: 943,
  literacy: 74.04,
  ageGroups: [
    { label: '0–14', share: 0.308 },
    { label: '15–24', share: 0.192 },
    { label: '25–44', share: 0.287 },
    { label: '45–59', share: 0.127 },
    { label: '60+', share: 0.086 },
  ],
}

export const STATES: Record<string, Stats> = Object.fromEntries(
  Object.entries({
    'Uttar Pradesh': 199_812_341,
    Maharashtra: 112_374_333,
    Bihar: 104_099_452,
    'West Bengal': 91_276_115,
    'Madhya Pradesh': 72_626_809,
    'Tamil Nadu': 72_147_030,
    Rajasthan: 68_548_437,
    Karnataka: 61_095_297,
    Gujarat: 60_439_692,
    'Andhra Pradesh': 49_386_799,
    Odisha: 41_974_218,
    Telangana: 35_003_674,
    Kerala: 33_406_061,
    Jharkhand: 32_988_134,
    Assam: 31_205_576,
    Punjab: 27_743_338,
    Chhattisgarh: 25_545_198,
    Haryana: 25_351_462,
    Delhi: 16_787_941,
    'Jammu and Kashmir': 12_267_013,
    Uttarakhand: 10_086_292,
    'Himachal Pradesh': 6_864_602,
    Tripura: 3_673_917,
    Meghalaya: 2_966_889,
    Manipur: 2_855_794,
    Nagaland: 1_978_502,
    Goa: 1_458_545,
    'Arunachal Pradesh': 1_383_727,
    Puducherry: 1_247_953,
    Mizoram: 1_097_206,
    Chandigarh: 1_055_450,
    Sikkim: 610_577,
    'Dadra and Nagar Haveli and Daman and Diu': 586_956,
    'Andaman and Nicobar Islands': 380_581,
    Ladakh: 274_289,
    Lakshadweep: 64_473,
  }).map(([k, population]) => [k, { population, source: 'census-2011' as Source }]),
)

STATES['Telangana'] = {
  ...STATES['Telangana'],
  households: 8_421_000,
  sexRatio: 988,
  literacy: 66.54,
}

// Telangana districts, Census 2011 re-aggregated to the post-2016 districts.
const TS_DISTRICTS: Record<string, number> = {
  Adilabad: 708_972,
  'Bhadradri Kothagudem': 1_069_261,
  Hyderabad: 3_943_323,
  Jagtial: 985_417,
  Jangaon: 566_376,
  'Jayashankar Bhupalapally': 416_763,
  'Jogulamba Gadwal': 609_990,
  Kamareddy: 972_625,
  Karimnagar: 1_005_711,
  Khammam: 1_401_639,
  'Komaram Bheem': 515_812,
  Mahabubabad: 774_549,
  Mahabubnagar: 919_903,
  Mancherial: 807_037,
  Medak: 767_428,
  'Medchal Malkajgiri': 2_460_095,
  Mulugu: 294_671,
  Nagarkurnool: 861_766,
  Nalgonda: 1_618_416,
  Narayanpet: 566_874,
  Nirmal: 709_418,
  Nizamabad: 1_571_022,
  Peddapalli: 795_332,
  'Rajanna Sircilla': 552_037,
  'Ranga Reddy': 2_446_265,
  Sangareddy: 1_527_628,
  Siddipet: 1_012_065,
  Suryapet: 1_099_560,
  Vikarabad: 927_140,
  Wanaparthy: 577_758,
  'Warangal Rural': 718_537,
  'Warangal Urban': 1_080_858,
  'Yadadri Bhuvanagiri': 739_448,
}

export const DISTRICTS: Record<string, Stats> = Object.fromEntries(
  Object.entries(TS_DISTRICTS).map(([k, population]) => [k, { population, source: 'census-2011' as Source }]),
)
Object.assign(DISTRICTS['Hyderabad'], { sexRatio: 954, literacy: 83.25 })
Object.assign(DISTRICTS['Medchal Malkajgiri'], { sexRatio: 957, literacy: 82.49 })
Object.assign(DISTRICTS['Ranga Reddy'], { sexRatio: 950, literacy: 71.95 })

export const GHMC: Stats = {
  population: 6_809_970,
  source: 'census-2011',
  sexRatio: 954,
  literacy: 83.26,
}

// ---------------------------------------------------------------------------
// Ward-level SAMPLE data (deterministic, illustrative only)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const wardCache = new Map<number, Stats>()

export function wardStats(wardNo: number): Stats {
  const cached = wardCache.get(wardNo)
  if (cached) return cached
  const r = mulberry32(wardNo * 7919)
  const between = (a: number, b: number) => a + (b - a) * r()
  const population = Math.round(between(42_000, 78_000) / 10) * 10
  const hhSize = between(3.5, 4.2)
  const young = between(0.2, 0.26)
  const youth = between(0.17, 0.21)
  const adult = between(0.33, 0.38)
  const mid = between(0.12, 0.15)
  const s: Stats = {
    population,
    source: 'sample',
    households: Math.round(population / hhSize),
    sexRatio: Math.round(between(918, 972)),
    literacy: +between(81, 92).toFixed(1),
    workers: +between(36, 45).toFixed(1),
    ageGroups: [
      { label: '0–14', share: young },
      { label: '15–24', share: youth },
      { label: '25–44', share: adult },
      { label: '45–59', share: mid },
      { label: '60+', share: 1 - young - youth - adult - mid },
    ],
  }
  wardCache.set(wardNo, s)
  return s
}

/** Population-weighted roll-up of several wards (for the Kukatpally area total). */
export function combine(list: Stats[]): Stats {
  const pop = list.reduce((a, s) => a + s.population, 0)
  const w = (f: (s: Stats) => number | undefined) =>
    list.reduce((a, s) => a + (f(s) ?? 0) * s.population, 0) / pop
  const shares = (key: 'ageGroups') =>
    list[0][key]!.map((g, i) => ({ label: g.label, share: w((s) => s[key]![i].share) }))
  return {
    population: pop,
    source: list.some((s) => s.source === 'sample') ? 'sample' : 'census-2011',
    households: list.reduce((a, s) => a + (s.households ?? 0), 0),
    sexRatio: Math.round(w((s) => s.sexRatio)),
    literacy: +w((s) => s.literacy).toFixed(1),
    workers: +w((s) => s.workers).toFixed(1),
    ageGroups: shares('ageGroups'),
  }
}
