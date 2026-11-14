import { useEffect, useMemo, useState } from 'react'
import { acMeta, acName, boothById, booths } from '../booths'
import { fmtInt, fmtShort } from '../format'
import { dateLocale, t } from '../i18n'
import { ROLE_LABEL, type Session } from '../session'
import type { Scope } from '../scope'
import { errorText, listRequests, OPEN_STATUSES, type ReqStatus, type RequestList, type Team } from '../team'

/** What the attention list can ask the app to do. */
export type CentreAction =
  | { kind: 'requests'; status: 'open' | 'overdue' | ReqStatus }
  | { kind: 'team' }
  | { kind: 'coverage'; ac: number }
  | { kind: 'unit'; ac: number; unitId: string }

interface UnitRow {
  unitId: string
  name: string
  ac: number
  lead: string | null
  booths: number
  covered: number
  open: number
  overdue: number
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? t('Good morning') : h < 17 ? t('Good afternoon') : t('Good evening')
}

/**
 * Command centre: the first screen for admins and ward / mandal leads.
 * "How is my area doing, and what needs attention today?" — all limited to the
 * signed-in person's area (the server scopes requests and team data).
 */
export default function CommandCentre({
  user,
  scope,
  team,
  onAction,
  onClose,
}: {
  user: Session
  scope: Scope
  team: Team | null
  onAction: (a: CentreAction) => void
  onClose: () => void
}) {
  const [open, setOpen] = useState<RequestList | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // Open requests in my area (200 is plenty for a constituency-level demo).
    listRequests({ status: 'open', sort: 'oldest', limit: 200 })
      .then(setOpen)
      .catch((e) => setError(errorText(e)))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Voters and stations within reach.
  const reach = useMemo(() => {
    const mine = scope.boothIds ? booths.filter((b) => scope.boothIds!.has(b.id)) : booths
    let voters = 0
    for (const b of mine) voters += b.voters ?? 0
    return { stations: mine.length, voters, acs: [...new Set(mine.map((b) => b.ac))].sort() }
  }, [scope.boothIds])

  const counts = open?.counts ?? {}
  const openTotal = OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const overdue = counts.overdue ?? 0
  const resolved = counts.resolved ?? 0
  const covered = team ? team.booths.filter((b) => b.lead).length : 0
  const teamStations = team?.booths.length ?? 0
  const coverage = teamStations ? covered / teamStations : 0

  const units = useMemo<UnitRow[]>(() => {
    if (!team) return []
    const overdueBy = new Map<string, number>()
    for (const r of open?.rows ?? []) {
      const u = boothById.get(r.booth_id)?.unitId
      if (r.overdue && u) overdueBy.set(u, (overdueBy.get(u) ?? 0) + 1)
    }
    return team.units
      .map((u) => ({
        unitId: u.unitId,
        name: u.unitName,
        ac: u.ac,
        lead: u.lead?.name ?? null,
        booths: u.booths,
        covered: u.covered,
        open: u.open,
        overdue: overdueBy.get(u.unitId) ?? 0,
      }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name))
  }, [team, open])

  const schemes = useMemo(() => {
    const by = new Map<string, number>()
    for (const r of open?.rows ?? []) by.set(t(r.scheme_name), (by.get(t(r.scheme_name)) ?? 0) + 1)
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [open])

  // "Needs attention today", most urgent first.
  const attention: { tone: 'red' | 'amber' | 'blue'; text: string; action: string; go: CentreAction }[] = []
  if (overdue > 0)
    attention.push({
      tone: 'red',
      text: t('{n} help requests are past their time limit', { n: fmtInt(overdue) }),
      action: t('Review now'),
      go: { kind: 'requests', status: 'overdue' },
    })
  const hotspot = units.find((u) => u.overdue > 0)
  if (hotspot && units.length > 1)
    attention.push({
      tone: 'red',
      text: t('{area} has the most overdue requests ({n})', { area: t(hotspot.name), n: hotspot.overdue }),
      action: t('Show on map'),
      go: { kind: 'unit', ac: hotspot.ac, unitId: hotspot.unitId },
    })
  if (team && teamStations - covered > 0) {
    const gapsByAc = new Map<number, number>()
    for (const b of team.booths) if (!b.lead) gapsByAc.set(b.ac, (gapsByAc.get(b.ac) ?? 0) + 1)
    const worstAc = [...gapsByAc.entries()].sort((a, b) => b[1] - a[1])[0][0]
    attention.push({
      tone: 'amber',
      text: t('{n} polling stations have no booth lead', { n: fmtInt(teamStations - covered) }),
      action: t('See gaps on map'),
      go: { kind: 'coverage', ac: worstAc },
    })
  }
  const vacant = units.filter((u) => !u.lead).length
  if (user.role === 'admin' && vacant > 0)
    attention.push({
      tone: 'amber',
      text: t('{n} wards / mandals have no lead', { n: vacant }),
      action: t('Assign leads'),
      go: { kind: 'team' },
    })
  if ((counts.documents_pending ?? 0) > 0)
    attention.push({
      tone: 'blue',
      text: t('{n} people are waiting on documents', { n: fmtInt(counts.documents_pending ?? 0) }),
      action: t('Follow up'),
      go: { kind: 'requests', status: 'documents_pending' },
    })

  const area =
    user.role === 'unit_lead'
      ? (user.units ?? []).map((u) => t(u.name)).join(', ')
      : reach.acs.map((a) => t(acName(a))).join(' & ')
  const anySample = reach.acs.some((a) => acMeta(a).synthetic)
  const today = new Date().toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
  const maxScheme = schemes[0]?.[1] ?? 1

  return (
    <div className="voter-sheet finder help-sheet centre" role="dialog" aria-modal="false" aria-label={t('Command centre')}>
      <div className="vs-head">
        <div>
          <div className="kicker">
            {t('Command centre')} · {area} · {today}
          </div>
          <h2>
            {greeting()}, {user.name.split(' ')[0]}
          </h2>
          <div className="vs-chips">
            <span>{t(ROLE_LABEL[user.role ?? 'admin'])}</span>
            {anySample && <span className="badge badge-sample">⚠ {t('Sample data · made-up people')}</span>}
          </div>
        </div>
        <button className="ghost vs-close" onClick={onClose} aria-label={t('Close')}>
          ✕
        </button>
      </div>

      <div className="vs-body centre-body">
        <div className="centre-scroll">
          <div className="centre-kpis">
            <Kpi label={t('Voters')} value={fmtShort(reach.voters)} hint={fmtInt(reach.voters)} />
            <Kpi label={t('Polling stations')} value={fmtInt(reach.stations)} hint={reach.acs.map((a) => `AC ${a}`).join(' · ')} />
            <Kpi
              label={t('Booth lead coverage')}
              value={team ? `${Math.round(coverage * 100)}%` : '—'}
              hint={team ? t('{a} of {b} stations', { a: fmtInt(covered), b: fmtInt(teamStations) }) : undefined}
              meter={team ? coverage : undefined}
            />
            <Kpi label={t('Open help requests')} value={open ? fmtInt(openTotal) : '—'} hint={open ? t('{n} resolved so far', { n: fmtInt(resolved) }) : undefined} onClick={() => onAction({ kind: 'requests', status: 'open' })} />
            <Kpi
              label={t('Overdue')}
              value={open ? fmtInt(overdue) : '—'}
              hint={t('past the time limit')}
              tone={overdue > 0 ? 'red' : undefined}
              onClick={() => onAction({ kind: 'requests', status: 'overdue' })}
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <section className="centre-card">
            <h3>{t('Needs attention today')}</h3>
            {!open && !error ? (
              <p className="muted small">{t('Loading…')}</p>
            ) : attention.length === 0 ? (
              <p className="all-clear">✓ {t('All clear — nothing needs attention right now.')}</p>
            ) : (
              <ul className="attention">
                {attention.map((a, i) => (
                  <li key={i} className={`tone-${a.tone}`}>
                    <span className="dot" aria-hidden="true" />
                    <span className="att-text">{a.text}</span>
                    <button className="ghost" onClick={() => onAction(a.go)}>
                      {a.action} →
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="centre-grid">
            {units.length > 0 && (
              <section className="centre-card">
                <h3>{t('Wards & mandals')}</h3>
                <table className="vs-table centre-table">
                  <thead>
                    <tr>
                      <th>{t('Area')}</th>
                      <th className="hide-sm">{t('Lead')}</th>
                      <th>{t('Booth leads')}</th>
                      <th className="num">{t('Open')}</th>
                      <th className="num">{t('Overdue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u) => (
                      <tr
                        key={u.unitId}
                        tabIndex={0}
                        onClick={() => onAction({ kind: 'unit', ac: u.ac, unitId: u.unitId })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onAction({ kind: 'unit', ac: u.ac, unitId: u.unitId })
                          }
                        }}
                        title={t('Show on map')}
                      >
                        <td>
                          <b>{t(u.name)}</b>
                          <span className="muted small"> · {t(acName(u.ac))}</span>
                        </td>
                        <td className="hide-sm">{u.lead ?? <span className="gap">{t('vacant')}</span>}</td>
                        <td>
                          <span className="coverage">
                            <span className="bar-track">
                              <span className="bar-fill" style={{ width: `${(u.covered / Math.max(1, u.booths)) * 100}%` }} />
                            </span>
                            <span className="small">
                              {u.covered}/{u.booths}
                            </span>
                          </span>
                        </td>
                        <td className="num">{u.open}</td>
                        <td className="num">{u.overdue > 0 ? <b className="overdue-num">{u.overdue}</b> : <span className="muted">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <section className="centre-card">
              <h3>{t('Open requests by scheme')}</h3>
              {schemes.length === 0 ? (
                <p className="muted small">{open ? t('No open requests.') : t('Loading…')}</p>
              ) : (
                <div className="bars" role="list">
                  {schemes.map(([name, n]) => (
                    <div className="bar-row scheme-row" key={name} role="listitem" title={`${name}: ${n}`}>
                      <span className="bar-label">{name}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(n / maxScheme) * 100}%` }} />
                      </span>
                      <span className="bar-value">{n}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted small note">{t('Counts only — no amounts are recorded.')}</p>
            </section>
          </div>
        </div>
      </div>

      <div className="vs-foot">
        <span className="muted small">{t('Everything here is limited to your area. Click any row to see it on the map.')}</span>
        <button className="primary" onClick={onClose}>
          {t('Go to map')} →
        </button>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
  tone,
  meter,
  onClick,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'red'
  meter?: number
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {meter !== undefined && (
        <span className="bar-track kpi-meter">
          <span className="bar-fill" style={{ width: `${meter * 100}%` }} />
        </span>
      )}
      {hint && <div className="kpi-hint">{hint}</div>}
    </>
  )
  const cls = `kpi ${tone === 'red' ? 'is-red' : ''} ${onClick ? 'is-link' : ''}`
  return onClick ? (
    <button className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}
