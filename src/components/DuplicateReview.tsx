import { useEffect, useMemo, useState } from 'react'
import { acMeta, acName, boothById, booths, buildingName, type Booth } from '../booths'
import { fmtInt } from '../format'
import { nameKey, phonetic, words } from '../nameMatch'
import { votersOf, type Voter } from '../voters'
import { findDuplicates, onStatus, warmUp, type DupPair, type IndexStatus } from '../voterSearch'

type Tier = 'high' | 'medium' | 'low'
type Where = 'same-station' | 'same-ac' | 'cross-ac'

interface Side {
  booth: Booth
  voter: Voter
}
/** One pair, cheap to build: no voter details yet. */
interface Base {
  n: number
  pair: DupPair
  ba: Booth
  bb: Booth
  tier: Tier
  where: Where
}
/** A pair with both voters' details and reasons (built only when shown or exported). */
interface Row extends Base {
  a: Side
  b: Side
  reasons: string[]
}

/** Fills in voter details; `lists` caches each station's list for this batch only. */
function detail(rows: Base[], lists = new Map<string, Voter[]>()): Row[] {
  const list = (b: Booth) => {
    let l = lists.get(b.id)
    if (!l) lists.set(b.id, (l = votersOf(b, { cache: false })))
    return l
  }
  return rows.flatMap((r) => {
    const va = list(r.ba)[r.pair.a.serial - 1]
    const vb = list(r.bb)[r.pair.b.serial - 1]
    return va && vb ? [{ ...r, a: { booth: r.ba, voter: va }, b: { booth: r.bb, voter: vb }, reasons: reasons(va, vb) }] : []
  })
}

const PAGE = 20
export const tierOf = (s: number): Tier => (s >= 0.92 ? 'high' : s >= 0.85 ? 'medium' : 'low')
const TIER_LABEL: Record<Tier, string> = { high: 'High', medium: 'Medium', low: 'Possible' }
const WHERE_LABEL: Record<Where, string> = {
  'same-station': 'Same station',
  'same-ac': 'Different stations',
  'cross-ac': 'Different constituencies',
}

const sound = (n: string) => words(n).map(phonetic).join(' ')
const hasInitial = (n: string) => nameKey(n).bare.length > 0

/** Plain-language reasons why two records look like the same person. */
function reasons(a: Voter, b: Voter): string[] {
  const out: string[] = []
  const nameWhy = (x: string, y: string, what: string) => {
    if (x === y) return `Same ${what}`
    if (hasInitial(x) !== hasInitial(y)) return `${what[0].toUpperCase() + what.slice(1)}: initial vs full (${x} ≈ ${y})`
    const What = what[0].toUpperCase() + what.slice(1)
    if (sound(x) === sound(y)) return `${What}: spelling variant (${x} ≈ ${y})`
    const sorted = (n: string) => words(n).map(phonetic).sort().join(' ')
    if (sorted(x) === sorted(y)) {
      const sameSpelling = [...words(x)].sort().join(' ') === [...words(y)].sort().join(' ')
      return `${What}: words in a different order${sameSpelling ? '' : ' + spelling variant'} (${x} ≈ ${y})`
    }
    return `Similar ${what} (${x} ≈ ${y})`
  }
  out.push(nameWhy(a.name, b.name, 'name'))
  out.push(nameWhy(a.relative, b.relative, a.relation === 'W/o' || b.relation === 'W/o' ? 'husband / father name' : 'father name'))
  out.push(a.age === b.age ? `Same age (${a.age})` : `Age differs by ${Math.abs(a.age - b.age)} (${a.age} / ${b.age})`)
  out.push(a.gender === b.gender ? `Same gender` : `Gender differs`)
  return out
}

function csvCell(v: string | number) {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(base: Base[]) {
  const rows = detail(base)
  const head = [
    'pair', 'score', 'confidence', 'where',
    'a_constituency', 'a_ps', 'a_serial', 'a_voter_id', 'a_name', 'a_relation', 'a_relative', 'a_age', 'a_gender', 'a_house',
    'b_constituency', 'b_ps', 'b_serial', 'b_voter_id', 'b_name', 'b_relation', 'b_relative', 'b_age', 'b_gender', 'b_house',
    'reasons',
  ]
  const side = (s: Side) => [
    `AC ${s.booth.ac} ${acName(s.booth.ac)}`, s.booth.no, s.voter.serial, s.voter.id, s.voter.name,
    s.voter.relation, s.voter.relative, s.voter.age, s.voter.gender, s.voter.house,
  ]
  const lines = [
    head.join(','),
    ...rows.map((r) =>
      [r.n, r.pair.score, TIER_LABEL[r.tier], WHERE_LABEL[r.where], ...side(r.a), ...side(r.b), r.reasons.join('; ')]
        .map(csvCell)
        .join(','),
    ),
  ]
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `possible-duplicate-voters-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

/** Duplicates tab: likely double entries across both constituencies, for review. */
export default function DuplicateReview({
  onPick,
  boothIds,
}: {
  onPick: (booth: Booth, serial: number) => void
  /** A ward / mandal lead's stations: only pairs with a record there are shown. */
  boothIds?: Set<string> | null
}) {
  const [status, setStatus] = useState<IndexStatus>({ state: 'idle', progress: 0 })
  const [result, setResult] = useState<{ pairs: DupPair[]; compared: number; ms: number } | null>(null)
  const [tiers, setTiers] = useState<Record<Tier, boolean>>({ high: true, medium: true, low: false })
  const [where, setWhere] = useState<'' | Where>('')
  const [ac, setAc] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    warmUp()
    const off = onStatus(setStatus)
    findDuplicates().then(setResult)
    return off
  }, [])

  const rows = useMemo<Base[]>(() => {
    if (!result) return []
    return result.pairs.flatMap((pair, i) => {
      const ba = boothById.get(pair.a.boothId)
      const bb = boothById.get(pair.b.boothId)
      if (!ba || !bb) return []
      if (boothIds && !boothIds.has(ba.id) && !boothIds.has(bb.id)) return []
      const w: Where = ba.id === bb.id ? 'same-station' : ba.ac === bb.ac ? 'same-ac' : 'cross-ac'
      return [{ n: i + 1, pair, ba, bb, tier: tierOf(pair.score), where: w }]
    })
  }, [result, boothIds])

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => tiers[r.tier] && (!where || r.where === where) && (!ac || r.ba.ac === Number(ac) || r.bb.ac === Number(ac)),
      ),
    [rows, tiers, where, ac],
  )
  const count = (f: (r: Base) => boolean) => rows.filter(f).length
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const shown = useMemo(() => detail(filtered.slice(cur * PAGE, cur * PAGE + PAGE)), [filtered, cur])
  const anySample = booths.some((b) => acMeta(b.ac).synthetic)

  if (!result) {
    return (
      <div className="vs-body">
        <div className="finder-help muted">
          <p className="index-progress">
            {status.state === 'ready' ? 'Comparing voters…' : `Preparing voter index… ${Math.round(status.progress * 100)}%`}
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${status.state === 'ready' ? 100 : status.progress * 100}%` }} />
            </span>
          </p>
          <p>
            Looking for records that are probably the same person written differently: spelling variants, initials
            vs full names, names in a different order, age off by a year or two. This takes about 10 seconds the first
            time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="dup-summary">
        <div className="dup-stat">
          <b>{fmtInt(rows.length)}</b> possible duplicate pairs
          <span className="muted"> · {fmtInt(result.compared)} comparisons in {(result.ms / 1000).toFixed(1)} s</span>
        </div>
        <div className="dup-filters">
          {(['high', 'medium', 'low'] as Tier[]).map((t) => (
            <label key={t} className={`chip-toggle tier-${t} ${tiers[t] ? 'is-on' : ''}`}>
              <input
                type="checkbox"
                checked={tiers[t]}
                onChange={(e) => {
                  setTiers({ ...tiers, [t]: e.target.checked })
                  setPage(0)
                }}
              />
              {TIER_LABEL[t]} <b>{fmtInt(count((r) => r.tier === t))}</b>
            </label>
          ))}
          <select
            className="legend-select"
            value={where}
            onChange={(e) => {
              setWhere(e.target.value as '' | Where)
              setPage(0)
            }}
            aria-label="Where the two records are"
          >
            <option value="">Anywhere</option>
            {(Object.keys(WHERE_LABEL) as Where[]).map((w) => (
              <option key={w} value={w}>
                {WHERE_LABEL[w]} ({fmtInt(count((r) => r.where === w))})
              </option>
            ))}
          </select>
          <select
            className="legend-select"
            value={ac}
            onChange={(e) => {
              setAc(e.target.value)
              setPage(0)
            }}
            aria-label="Constituency"
          >
            <option value="">Both constituencies</option>
            <option value="46">AC 46 Kukatpally</option>
            <option value="79">AC 79 Gadwal</option>
          </select>
          <button className="ghost" onClick={() => downloadCsv(filtered)} disabled={filtered.length === 0}>
            ⬇ Export CSV ({fmtInt(filtered.length)})
          </button>
        </div>
        <p className="muted small">
          Nothing is removed automatically. Check each pair on the ground; a confirmed duplicate is removed by filing
          Form 7 with the Booth Level Officer.
          {anySample && ' Sample data: these pairs include ones planted on purpose to test the scan.'}
        </p>
      </div>

      <div className="vs-body">
        <div className="vs-table-wrap dup-list">
          {shown.map((r) => (
            <article key={r.n} className="dup-card">
              <header>
                <span className={`tier-badge tier-${r.tier}`}>
                  {TIER_LABEL[r.tier]} · {Math.round(r.pair.score * 100)}%
                </span>
                <span className="muted small">
                  #{r.n} · {WHERE_LABEL[r.where]}
                </span>
              </header>
              <div className="dup-sides">
                {[r.a, r.b].map((s, i) => (
                  <div key={i} className="dup-side">
                    <div className="dup-name">{s.voter.name}</div>
                    <div className="muted">
                      {s.voter.relation} {s.voter.relative}
                    </div>
                    <div>
                      {s.voter.age} · {s.voter.gender} · House {s.voter.house}
                    </div>
                    <div className="muted small">
                      {acName(s.booth.ac)} · PS {s.booth.no}, {buildingName(s.booth)} · Sl. {s.voter.serial}
                    </div>
                    <div className="dup-foot">
                      <span className="mono">{s.voter.id}</span>
                      <button className="link-btn" onClick={() => onPick(s.booth, s.voter.serial)}>
                        Open in list →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <ul className="dup-reasons">
                {r.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </article>
          ))}
          {shown.length === 0 && <p className="finder-help muted">No pairs match these filters.</p>}
        </div>
      </div>

      <div className="vs-foot">
        <span className="muted">
          {filtered.length === 0
            ? '0 pairs'
            : `${fmtInt(cur * PAGE + 1)}–${fmtInt(cur * PAGE + shown.length)} of ${fmtInt(filtered.length)} pairs`}
        </span>
        <div className="vs-pager">
          <button className="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            ← Prev
          </button>
          <span className="muted">
            Page {cur + 1} / {pages}
          </span>
          <button className="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
            Next →
          </button>
        </div>
      </div>
    </>
  )
}
