import { useEffect, useMemo, useState } from 'react'
import { acMeta, acName, booths as allBooths, buildingName, type Booth } from '../booths'
import { fmtInt } from '../format'
import { dateLocale, t } from '../i18n'
import type { Scope } from '../scope'
import type { Session } from '../session'
import { errorText, type Team } from '../team'
import {
  byBooth,
  electorsOf,
  expectedBy,
  bestSlot,
  paceFor,
  paceOf,
  reportTurnout,
  resetPollDay,
  simulatePollDay,
  SLOT_LABEL,
  SLOT_SHORT,
  SLOTS,
  slotNow,
  type Slot,
  type TurnoutRow,
} from '../pollDay'

type Tab = 'dashboard' | 'enter'

/**
 * Poll day control room. Booth leads enter votes polled at their stations;
 * ward / mandal leads and admins see turnout against each station's usual pace,
 * who is behind and who hasn't reported, and can colour the map by it.
 */
export default function PollDay({
  user,
  scope,
  team,
  rows,
  updatedAt,
  onRefresh,
  onShowMap,
  onOpenStation,
  onClose,
}: {
  user: Session
  scope: Scope
  team: Team | null
  rows: TurnoutRow[] | null
  updatedAt: Date | null
  onRefresh: () => Promise<void>
  onShowMap: (slot: Slot) => void
  onOpenStation: (b: Booth) => void
  onClose: () => void
}) {
  const isBoothLead = user.role === 'booth_lead'
  const [tab, setTab] = useState<Tab>(isBoothLead ? 'enter' : 'dashboard')
  const [slot, setSlot] = useState<Slot>(() => (rows && bestSlot(rows)) ?? slotNow())
  // Follow the newest round as reports come in (unless the user picked one).
  const [pinned, setPinned] = useState(false)
  const newest = rows ? bestSlot(rows) : undefined
  useEffect(() => {
    if (!pinned && newest !== undefined) setSlot(newest)
  }, [newest, pinned])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mine = useMemo(
    () => (scope.boothIds ? allBooths.filter((b) => scope.boothIds!.has(b.id)) : allBooths).filter((b) => electorsOf(b) > 0),
    [scope.boothIds],
  )
  const reports = useMemo(() => byBooth(rows ?? []), [rows])
  const leadOf = useMemo(() => new Map((team?.booths ?? []).map((b) => [b.id, b.lead])), [team])
  const anySample = mine.some((b) => acMeta(b.ac).synthetic)
  const area =
    user.role === 'admin'
      ? t('All areas')
      : user.role === 'unit_lead'
        ? (user.units ?? []).map((u) => t(u.name)).join(', ')
        : t(mine.length === 1 ? '{n} polling station' : '{n} polling stations', { n: mine.length })

  return (
    <div className="voter-sheet finder help-sheet poll-sheet" role="dialog" aria-modal="false" aria-label={t('Poll day')}>
      <div className="vs-head">
        <div>
          <div className="kicker">
            {t('Poll day')} · {area}
          </div>
          <h2>{isBoothLead ? t('Report votes polled') : t('Poll day control room')}</h2>
          <div className="vs-chips">
            <span className="live-dot" aria-hidden="true" />
            <span>
              {updatedAt
                ? t('Live · updated {time}', { time: updatedAt.toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' }) })
                : t('Loading…')}
            </span>
            {anySample && <span className="badge badge-sample">⚠ {t('Sample data · made-up people')}</span>}
          </div>
        </div>
        <button className="ghost vs-close" onClick={onClose} aria-label={t('Close')}>
          ✕
        </button>
      </div>

      <div className="vs-tabs" role="tablist">
        {!isBoothLead && (
          <button role="tab" aria-selected={tab === 'dashboard'} className={tab === 'dashboard' ? 'is-on' : ''} onClick={() => setTab('dashboard')}>
            {t('Dashboard')}
          </button>
        )}
        <button role="tab" aria-selected={tab === 'enter'} className={tab === 'enter' ? 'is-on' : ''} onClick={() => setTab('enter')}>
          {t('Enter numbers')}
        </button>
        <div className="slot-tabs" role="group" aria-label={t('Reporting time')}>
          {SLOTS.map((s) => (
            <button
              key={s}
              className={`chip-toggle ${s === slot ? 'is-on' : ''}`}
              onClick={() => {
                setSlot(s)
                setPinned(true)
              }}
            >
              {t(SLOT_SHORT[s])}
            </button>
          ))}
        </div>
      </div>

      {tab === 'dashboard' && !isBoothLead ? (
        <Dashboard
          user={user}
          mine={mine}
          reports={reports}
          slot={slot}
          loaded={rows !== null}
          leadOf={leadOf}
          onShowMap={() => onShowMap(slot)}
          onOpenStation={onOpenStation}
          onRefresh={onRefresh}
          onSlot={(s) => {
            setSlot(s)
            setPinned(false)
          }}
        />
      ) : (
        <Entry mine={mine} reports={reports} slot={slot} onSaved={onRefresh} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard (ward / mandal leads, admins)
// ---------------------------------------------------------------------------

function Dashboard({
  user,
  mine,
  reports,
  slot,
  loaded,
  leadOf,
  onShowMap,
  onOpenStation,
  onRefresh,
  onSlot,
}: {
  user: Session
  mine: Booth[]
  reports: ReturnType<typeof byBooth>
  slot: Slot
  loaded: boolean
  leadOf: Map<string, Team['booths'][number]['lead']>
  onShowMap: () => void
  onOpenStation: (b: Booth) => void
  onRefresh: () => Promise<void>
  onSlot: (s: Slot) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const electors = mine.reduce((n, b) => n + electorsOf(b), 0)
  const reported = mine.filter((b) => reports.get(b.id)?.has(slot))
  const votes = reported.reduce((n, b) => n + (reports.get(b.id)!.get(slot) ?? 0), 0)
  const reportedElectors = reported.reduce((n, b) => n + electorsOf(b), 0)
  const turnoutPct = reportedElectors ? (votes / reportedElectors) * 100 : 0
  const usualPct = reportedElectors ? (reported.reduce((n, b) => n + expectedBy(b, slot), 0) / reportedElectors) * 100 : 0
  const pace = paceFor(mine, reports, slot)

  const rowsByPace = reported
    .map((b) => ({ b, votes: reports.get(b.id)!.get(slot)!, usual: expectedBy(b, slot) }))
    .map((r) => ({ ...r, ratio: r.usual > 0 ? r.votes / r.usual : 1 }))
    .sort((a, b) => a.ratio - b.ratio)
  const behind = rowsByPace.filter((r) => paceOf(r.ratio) === 'behind')
  const missing = mine.filter((b) => !reports.get(b.id)?.has(slot))
  const shownBehind = showAll ? behind : behind.slice(0, 12)

  // Turnout curve: % of electors at each slot (stations that reported) vs usual.
  const curve = SLOTS.map((s) => {
    const rep = mine.filter((b) => reports.get(b.id)?.has(s))
    const e = rep.reduce((n, b) => n + electorsOf(b), 0)
    const v = rep.reduce((n, b) => n + (reports.get(b.id)!.get(s) ?? 0), 0)
    const usualAll = mine.reduce((n, b) => n + expectedBy(b, s), 0) / Math.max(1, electors)
    return { s, today: e ? (v / e) * 100 : undefined, usual: usualAll * 100 }
  })

  return (
    <div className="vs-body centre-body">
      <div className="centre-scroll">
        <div className="centre-kpis">
          <div className="kpi">
            <div className="kpi-label">{t('Turnout so far')}</div>
            <div className="kpi-value">{reported.length ? `${turnoutPct.toFixed(1)}%` : '—'}</div>
            <div className="kpi-hint">{t('by {time}', { time: t(SLOT_LABEL[slot]) })}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{t('Votes polled')}</div>
            <div className="kpi-value">{fmtInt(votes)}</div>
            <div className="kpi-hint">{t('of {n} electors', { n: fmtInt(reportedElectors) })}</div>
          </div>
          <div className={`kpi ${pace !== undefined && pace < 0.97 ? 'is-red' : ''}`}>
            <div className="kpi-label">{t('vs usual pace')}</div>
            <div className="kpi-value">
              {pace === undefined ? '—' : `${turnoutPct - usualPct >= 0 ? '+' : '−'}${Math.abs(turnoutPct - usualPct).toFixed(1)} ${t('pts')}`}
            </div>
            <div className="kpi-hint">{t('usually {pct}% by now', { pct: usualPct.toFixed(1) })}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{t('Stations reported')}</div>
            <div className="kpi-value">
              {fmtInt(reported.length)}/{fmtInt(mine.length)}
            </div>
            <span className="bar-track kpi-meter">
              <span className="bar-fill" style={{ width: `${(reported.length / Math.max(1, mine.length)) * 100}%` }} />
            </span>
          </div>
          <div className={`kpi ${behind.length ? 'is-red' : ''}`}>
            <div className="kpi-label">{t('Behind usual pace')}</div>
            <div className="kpi-value">{fmtInt(behind.length)}</div>
            <div className="kpi-hint">{t('stations below 90% of usual')}</div>
          </div>
        </div>

        <div className="centre-grid">
          <section className="centre-card">
            <div className="card-row">
              <h3>{t('Turnout through the day')}</h3>
              <button className="primary" onClick={onShowMap}>
                {t('Show on map')} →
              </button>
            </div>
            <TurnoutChart points={curve} slot={slot} onSlot={onSlot} />
            <p className="muted small note">
              {t('Usual pace = each station’s turnout at the last assembly election, spread over the day the way polling usually goes.')}
            </p>
          </section>

          <section className="centre-card">
            <h3>
              {t('Not reported for {time}', { time: t(SLOT_LABEL[slot]) })} <span className="muted">({fmtInt(missing.length)})</span>
            </h3>
            {!loaded ? (
              <p className="muted small">{t('Loading…')}</p>
            ) : missing.length === 0 ? (
              <p className="all-clear">✓ {t('Every station has reported.')}</p>
            ) : (
              <ul className="missing-list">
                {missing.slice(0, 40).map((b) => (
                  <li key={b.id}>
                    <button className="link-btn" onClick={() => onOpenStation(b)}>
                      {t(acName(b.ac))} PS {b.no}
                    </button>
                    <LeadContact lead={leadOf.get(b.id)} />
                  </li>
                ))}
                {missing.length > 40 && <li className="muted small">{t('…and {n} more', { n: missing.length - 40 })}</li>}
              </ul>
            )}
          </section>
        </div>

        <section className="centre-card">
          <h3>
            {t('Behind usual pace at {time}', { time: t(SLOT_LABEL[slot]) })} <span className="muted">({fmtInt(behind.length)})</span>
          </h3>
          {behind.length === 0 ? (
            <p className="all-clear">{loaded ? `✓ ${t('No station is behind its usual pace.')}` : t('Loading…')}</p>
          ) : (
            <>
              <table className="vs-table centre-table">
                <thead>
                  <tr>
                    <th>{t('Station')}</th>
                    <th className="hide-sm">{t('Area')}</th>
                    <th className="num">{t('Votes')}</th>
                    <th className="num hide-sm">{t('Usual')}</th>
                    <th className="num">{t('Pace')}</th>
                    <th>{t('Booth lead')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownBehind.map(({ b, votes: v, usual, ratio }) => (
                    <tr key={b.id} onClick={() => onOpenStation(b)} title={t('Show on map')}>
                      <td>
                        <b>
                          {t(acName(b.ac))} PS {b.no}
                        </b>
                        <span className="muted small hide-sm"> · {buildingName(b)}</span>
                      </td>
                      <td className="hide-sm">{b.unitName ? t(b.unitName) : '—'}</td>
                      <td className="num">{fmtInt(v)}</td>
                      <td className="num hide-sm muted">{fmtInt(Math.round(usual))}</td>
                      <td className="num">
                        <b className="overdue-num">{Math.round(ratio * 100)}%</b>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <LeadContact lead={leadOf.get(b.id)} slot={slot} psNo={b.no} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {behind.length > shownBehind.length && (
                <button className="link-btn" onClick={() => setShowAll(true)}>
                  {t('Show all {n}', { n: behind.length })}
                </button>
              )}
            </>
          )}
        </section>

        {user.role === 'admin' && <DemoControls onDone={onRefresh} onSlot={onSlot} />}
      </div>
    </div>
  )
}

function LeadContact({ lead, slot, psNo }: { lead?: Team['booths'][number]['lead']; slot?: Slot; psNo?: number }) {
  if (!lead) return <span className="gap small">{t('No booth lead')}</span>
  const msg =
    slot && psNo
      ? t('Hi {name}, PS {ps} is behind its usual turnout at {time}. Can you check the queue and remind voters who haven’t come yet?', {
          name: lead.name.split(' ').slice(-1)[0],
          ps: psNo,
          time: t(SLOT_LABEL[slot]),
        })
      : t('Hi {name}, please send the votes-polled number for your station.', { name: lead.name.split(' ').slice(-1)[0] })
  return (
    <span className="lead-contact">
      <span className="small">{lead.name}</span>
      {lead.phone && (
        <>
          <a className="wa-btn small" href={`https://wa.me/91${lead.phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="ghost call-btn small" href={`tel:${lead.phone}`}>
            {t('Call')}
          </a>
        </>
      )}
    </span>
  )
}

/** Today vs usual, % of electors, at each reporting time. */
function TurnoutChart({
  points,
  slot,
  onSlot,
}: {
  points: { s: Slot; today?: number; usual: number }[]
  slot: Slot
  onSlot: (s: Slot) => void
}) {
  const W = 520
  const H = 210
  const pad = { l: 36, r: 22, t: 12, b: 26 }
  const max = Math.max(80, ...points.map((p) => Math.max(p.usual, p.today ?? 0))) * 1.05
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b)
  const line = (key: 'today' | 'usual') =>
    points
      .map((p, i) => (p[key] === undefined ? null : `${x(i)},${y(p[key]!)}`))
      .filter(Boolean)
      .join(' ')
  const ticks = [0, 20, 40, 60, 80].filter((v) => v <= max)
  return (
    <svg className="turnout-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Turnout through the day')}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 6} y={y(v) + 4} className="tick" textAnchor="end">
            {v}%
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <g key={p.s} className={`slot-col ${p.s === slot ? 'is-on' : ''}`} onClick={() => onSlot(p.s)}>
          <rect x={x(i) - 20} y={pad.t} width={40} height={H - pad.t - pad.b} className="slot-hit" />
          <text x={x(i)} y={H - 8} className="tick" textAnchor="middle">
            {t(SLOT_SHORT[p.s])}
          </text>
        </g>
      ))}
      <polyline points={line('usual')} className="usual" />
      <polyline points={line('today')} className="today" />
      {points.map((p, i) =>
        p.today === undefined ? null : (
          <g key={`d${p.s}`}>
            <circle cx={x(i)} cy={y(p.today)} r={p.s === slot ? 5 : 3.5} className="today-dot" />
            {p.s === slot && (
              <text x={x(i)} y={y(p.today) - 10} className="val" textAnchor="middle">
                {p.today.toFixed(1)}%
              </text>
            )}
          </g>
        ),
      )}
      <g className="chart-key" transform={`translate(${pad.l + 8}, ${pad.t + 6})`}>
        <line x1={0} x2={18} y1={0} y2={0} className="today" />
        <text x={24} y={4}>
          {t('Today')}
        </text>
        <line x1={80} x2={98} y1={0} y2={0} className="usual" />
        <text x={104} y={4}>
          {t('Usual pace')}
        </text>
      </g>
    </svg>
  )
}

/** Admin-only: load a simulated poll day for demos, or play it hour by hour. */
function DemoControls({ onDone, onSlot }: { onDone: () => Promise<void>; onSlot: (s: Slot) => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const run = async (f: () => Promise<unknown>, done = '') => {
    setBusy(true)
    setMsg('')
    try {
      await f()
      await onDone()
      setMsg(done)
    } catch (e) {
      setMsg(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const play = () =>
    run(async () => {
      for (const s of SLOTS) {
        await simulatePollDay(s)
        await onDone()
        onSlot(s)
        await new Promise((r) => setTimeout(r, 2200))
      }
    }, t('Done: the whole day has been played.'))

  return (
    <section className="centre-card demo-card">
      <h3>{t('Demo: simulate a poll day')}</h3>
      <p className="muted small">
        {t('Fills in made-up votes-polled numbers for every station so you can show how the day looks. Replaces any numbers already entered.')}
      </p>
      <div className="dup-filters">
        <button className="primary" disabled={busy} onClick={play}>
          ▶ {t('Play the day')}
        </button>
        {SLOTS.map((s) => (
          <button key={s} className="ghost" disabled={busy} onClick={() => run(() => simulatePollDay(s).then(() => onSlot(s)))}>
            {t('Up to {time}', { time: t(SLOT_LABEL[s]) })}
          </button>
        ))}
        <button className="ghost" disabled={busy} onClick={() => run(resetPollDay, t('Cleared.'))}>
          {t('Clear all')}
        </button>
        {busy && <span className="muted small">{t('Working…')}</span>}
        {msg && <span className="small">{msg}</span>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Entering numbers (booth leads; leads and admins for any station in their area)
// ---------------------------------------------------------------------------

function Entry({
  mine,
  reports,
  slot,
  onSaved,
}: {
  mine: Booth[]
  reports: ReturnType<typeof byBooth>
  slot: Slot
  onSaved: () => Promise<void>
}) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const f = s
      ? mine.filter((b) => String(b.no) === s || b.name.toLowerCase().includes(s) || (b.unitName ?? '').toLowerCase().includes(s))
      : mine
    return f.slice(0, 60)
  }, [mine, q])

  return (
    <div className="vs-body centre-body">
      <div className="centre-scroll">
        <p className="read-only-note small">
          📵 {t('Phones aren’t allowed inside polling stations. Enter the number from outside (for example at your booth camp), as your polling agent passes it on.')}
        </p>
        {mine.length > 6 && (
          <input
            className="search"
            type="search"
            placeholder={t('Find a station by number, building or area')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        <div className="entry-list">
          {list.map((b) => (
            <EntryCard key={b.id} booth={b} votesBySlot={reports.get(b.id)} slot={slot} onSaved={onSaved} />
          ))}
          {list.length === 0 && <p className="muted">{t('No matches.')}</p>}
          {mine.length > list.length && !q && <p className="muted small">{t('Showing 60 of {n} — search to narrow down.', { n: mine.length })}</p>}
        </div>
      </div>
    </div>
  )
}

function EntryCard({
  booth,
  votesBySlot,
  slot,
  onSaved,
}: {
  booth: Booth
  votesBySlot?: Map<Slot, number>
  slot: Slot
  onSaved: () => Promise<void>
}) {
  const current = votesBySlot?.get(slot)
  const [value, setValue] = useState(current !== undefined ? String(current) : '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Show the saved number for the chosen time; clear old messages when the time changes.
  useEffect(() => {
    setValue(current !== undefined ? String(current) : '')
  }, [slot, current])
  useEffect(() => setMsg(null), [slot])

  const e = electorsOf(booth)
  const usual = expectedBy(booth, slot)
  const n = Number(value)
  const ratio = value !== '' && usual > 0 ? n / usual : undefined
  const pace = paceOf(ratio)

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await reportTurnout(booth.id, slot, n)
      await onSaved()
      setMsg({ ok: true, text: t('Saved.') })
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="entry-card">
      <div className="entry-head">
        <div>
          <b>
            {t(acName(booth.ac))} PS {booth.no}
          </b>
          <div className="muted small">
            {buildingName(booth)}
            {booth.unitName && !buildingName(booth).includes(booth.unitName) ? ` · ${t(booth.unitName)}` : ''}
          </div>
        </div>
        <div className="muted small entry-electors">
          {fmtInt(e)} {t('electors')}
        </div>
      </div>
      <div className="entry-row">
        <label>
          <span className="small">{t('Votes polled by {time}', { time: t(SLOT_LABEL[slot]) })}</span>
          <input
            className="search entry-input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={value}
            onChange={(ev) => setValue(ev.target.value.replace(/\D/g, ''))}
            onKeyDown={(ev) => ev.key === 'Enter' && value !== '' && !busy && save()}
            aria-label={t('Votes polled by {time}', { time: t(SLOT_LABEL[slot]) })}
          />
        </label>
        <button className="primary" disabled={busy || value === '' || (current !== undefined && n === current)} onClick={save}>
          {busy ? t('Saving…') : current !== undefined ? t('Update') : t('Save')}
        </button>
        <div className={`entry-pace pace-${pace}`}>
          {ratio !== undefined ? (
            <>
              <b>{((n / Math.max(1, e)) * 100).toFixed(1)}%</b> {t('turnout')} ·{' '}
              {pace === 'behind' ? t('behind usual pace') : pace === 'ahead' ? t('ahead of usual pace') : t('on usual pace')}
            </>
          ) : (
            <span className="muted">{t('Usually about {n} by now', { n: fmtInt(Math.round(usual)) })}</span>
          )}
        </div>
      </div>
      {msg && <div className={`small ${msg.ok ? 'ok-note' : 'form-error'}`}>{msg.text}</div>}
      <ol className="slot-strip" aria-label={t('Reported so far')}>
        {SLOTS.map((s) => {
          const v = votesBySlot?.get(s)
          return (
            <li key={s} className={`${s === slot ? 'is-on' : ''} ${v === undefined ? 'is-empty' : ''}`}>
              <span className="muted">{t(SLOT_SHORT[s])}</span>
              <b>{v === undefined ? '—' : fmtInt(v)}</b>
            </li>
          )
        })}
      </ol>
    </article>
  )
}
