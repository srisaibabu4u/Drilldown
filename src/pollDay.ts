// Poll day: votes polled so far at each station, reported in time slots, compared
// with each station's usual pace (its turnout at the last assembly election spread
// over the day with a typical Telangana polling curve). Counts only.
import { booths as allBooths, type Booth } from './booths'
import { call } from './team'

/** Reporting slots: the hour the count is taken; 19 = close of poll. */
export const SLOTS = [9, 11, 13, 15, 17, 19] as const
export type Slot = (typeof SLOTS)[number]
export const SLOT_LABEL: Record<Slot, string> = { 9: '9 AM', 11: '11 AM', 13: '1 PM', 15: '3 PM', 17: '5 PM', 19: 'Close of poll' }
/** Short labels for the chart axis (polls close at 6 PM in most of Telangana). */
export const SLOT_SHORT: Record<Slot, string> = { ...SLOT_LABEL, 19: '6 PM' }

/** Share of a station's final turnout usually polled by each slot. */
export const CURVE: Record<Slot, number> = { 9: 0.13, 11: 0.33, 13: 0.53, 15: 0.72, 17: 0.9, 19: 1 }

/** Pace bands: below 90% of the usual pace is "behind", above 110% "ahead". */
export const BEHIND = 0.9
export const AHEAD = 1.1

export interface TurnoutRow {
  booth_id: string
  slot: Slot
  votes: number
  reported_at: string
  by: string | null
}

/** boothId → slot → votes */
export type Reports = Map<string, Map<Slot, number>>

export const loadTurnout = () => call<{ rows: TurnoutRow[] }>('/api/turnout').then((r) => r.rows)
export const reportTurnout = (boothId: string, slot: Slot, votes: number) =>
  call<{ ok: true }>('/api/turnout', { method: 'POST', body: JSON.stringify({ boothId, slot, votes }) })
export const resetPollDay = () => call<{ ok: true }>('/api/turnout', { method: 'POST', body: JSON.stringify({ action: 'reset' }) })

export function byBooth(rows: TurnoutRow[]): Reports {
  const m: Reports = new Map()
  for (const r of rows) {
    let s = m.get(r.booth_id)
    if (!s) m.set(r.booth_id, (s = new Map()))
    s.set(r.slot, r.votes)
  }
  return m
}

export const electorsOf = (b: Booth) => b.voters ?? 0
/** Last-election turnout for a station (fraction); a typical 65% when unknown. */
export const usualTurnout = (b: Booth) => (b.electors?.turnout ?? 65) / 100
/** Votes a station usually has polled by this slot. */
export const expectedBy = (b: Booth, slot: Slot) => electorsOf(b) * usualTurnout(b) * CURVE[slot]

/** Latest slot with any report (what the dashboard opens on). */
export function latestSlot(rows: TurnoutRow[]): Slot | undefined {
  let best: Slot | undefined
  for (const r of rows) if (best === undefined || r.slot > best) best = r.slot
  return best
}

/** Slot for "now" on a real poll day (7 AM–6 PM); outside polling hours, the first slot. */
export function slotNow(d = new Date()): Slot {
  const h = d.getHours()
  let s: Slot = 9
  for (const x of SLOTS) if (h >= x) s = x
  return s
}

export type Pace = 'behind' | 'on' | 'ahead' | 'none'
export const paceOf = (ratio: number | undefined): Pace =>
  ratio === undefined ? 'none' : ratio < BEHIND ? 'behind' : ratio > AHEAD ? 'ahead' : 'on'

/** Votes reported / usual votes by this slot, for a group of stations (only those that reported). */
export function paceFor(list: Booth[], reports: Reports, slot: Slot): number | undefined {
  let got = 0
  let usual = 0
  for (const b of list) {
    const v = reports.get(b.id)?.get(slot)
    if (v === undefined) continue
    got += v
    usual += expectedBy(b, slot)
  }
  return usual > 0 ? got / usual : undefined
}

// ---------------------------------------------------------------------------
// Demo: a simulated poll day (admin only on the server)
// ---------------------------------------------------------------------------

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
/** Deterministic 0..1 from a key, so each demo run shows the same story. */
const rnd = (key: string) => (hash(key) % 100000) / 100000

/**
 * Reports for every station up to `upTo`: most stations near their usual pace,
 * about one in eight clearly behind, a few ahead, and ~5% missing the latest round.
 */
export function simulatedRows(upTo: Slot, list: Booth[] = allBooths) {
  const rows: { boothId: string; slot: Slot; votes: number }[] = []
  for (const b of list) {
    const e = electorsOf(b)
    if (!e) continue
    const r = rnd(b.id)
    // The station's pace for the day.
    const pace = r < 0.12 ? 0.68 + rnd(b.id + 'l') * 0.14 : r > 0.93 ? 1.12 + rnd(b.id + 'h') * 0.1 : 0.88 + rnd(b.id + 'n') * 0.16
    let prev = 0
    for (const slot of SLOTS) {
      if (slot > upTo) break
      if (slot === upTo && rnd(b.id + 'miss' + slot) < 0.05) break // hasn't reported yet
      const wobble = 0.96 + rnd(b.id + 's' + slot) * 0.08
      const v = Math.min(e, Math.max(prev, Math.round(expectedBy(b, slot) * pace * wobble)))
      rows.push({ boothId: b.id, slot, votes: v })
      prev = v
    }
  }
  return rows
}

export const simulatePollDay = (upTo: Slot) =>
  call<{ ok: true; rows: number }>('/api/turnout', {
    method: 'POST',
    body: JSON.stringify({ action: 'simulate', rows: simulatedRows(upTo) }),
  })
