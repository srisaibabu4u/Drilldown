import { useCallback, useEffect, useMemo, useState } from 'react'
import { dateLocale, t } from '../i18n'
import { acName, boothById, type Booth } from '../booths'
import { fmtInt } from '../format'
import { ROLE_LABEL, type Session } from '../session'
import PeopleManager from './PeopleManager'
import {
  daysSince,
  errorText,
  listRequests,
  loadTeam,
  OPEN_STATUSES,
  requestEvents,
  SLA_DAYS,
  STATUS_LABEL,
  STATUS_ORDER,
  updateRequest,
  whatsappLink,
  loadAssignments,
  setBoothLead,
  setUnitLead,
  type AssignmentRow,
  type Person,
  type HelpRequest,
  type ReqStatus,
  type RequestEvent,
  type RequestList,
  type Team,
} from '../team'

export type HelpTab = 'requests' | 'team'
const PAGE = 50

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })

/** Help requests + team / coverage, for leads and admins. */
export default function HelpPanel({
  user,
  tab,
  onTab,
  onClose,
  onOpenVoter,
  onShowCoverage,
  initialStatus = 'open',
}: {
  initialStatus?: 'open' | 'overdue' | ReqStatus
  user: Session
  tab: HelpTab
  onTab: (t: HelpTab) => void
  onClose: () => void
  onOpenVoter: (booth: Booth, serial: number) => void
  onShowCoverage: (ac: number) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const area =
    user.role === 'admin'
      ? t('All areas')
      : user.role === 'unit_lead'
        ? (user.units ?? []).map((u) => t(u.name)).join(', ')
        : t(user.booths?.length === 1 ? '{n} polling station' : '{n} polling stations', { n: user.booths?.length ?? 0 })

  return (
    <div className="voter-sheet finder help-sheet" role="dialog" aria-modal="false" aria-label={t('Help requests')}>
      <div className="vs-head">
        <div>
          <div className="kicker">
            {t(ROLE_LABEL[user.role ?? 'admin'])} · {area}
          </div>
          <h2>{tab === 'requests' ? t('Scheme help requests') : t('Team & coverage')}</h2>
          <div className="vs-chips">
            <span className="badge badge-sample">⚠ {t('Demo data · synthetic people')}</span>
          </div>
        </div>
        <button className="ghost vs-close" onClick={onClose} aria-label={t('Close')}>
          ✕
        </button>
      </div>
      <div className="vs-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'is-on' : ''} onClick={() => onTab('requests')}>
          {t('Help requests')}
        </button>
        <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'is-on' : ''} onClick={() => onTab('team')}>
          {t('Team & coverage')}
        </button>
      </div>
      {tab === 'requests' ? (
        <Requests user={user} onOpenVoter={onOpenVoter} initialStatus={initialStatus} />
      ) : (
        <TeamView user={user} onShowCoverage={onShowCoverage} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Help requests
// ---------------------------------------------------------------------------

function Requests({
  user,
  onOpenVoter,
  initialStatus,
}: {
  user: Session
  onOpenVoter: (b: Booth, serial: number) => void
  initialStatus: 'open' | 'overdue' | ReqStatus
}) {
  const [status, setStatus] = useState<'open' | 'overdue' | '' | ReqStatus>(initialStatus)
  const [sort, setSort] = useState<'recent' | 'oldest'>('recent')
  const [scheme, setScheme] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<RequestList | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const load = useCallback(() => {
    listRequests({ status, scheme, q: q.trim(), sort, limit: PAGE, offset: page * PAGE })
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
  }, [status, scheme, q, page, sort])

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  const counts = data?.counts ?? {}
  const openCount = OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const all = STATUS_ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE))
  const chip = (value: typeof status, label: string, n: number, extra = '') => (
    <button
      key={label}
      className={`chip-toggle ${status === value ? 'is-on' : ''} ${extra}`}
      onClick={() => {
        setStatus(value)
        setPage(0)
      }}
    >
      {label} <b>{fmtInt(n)}</b>
    </button>
  )

  return (
    <>
      <div className="dup-summary">
        <div className="dup-filters">
          {chip('overdue', `⚠ ${t('Overdue')}`, counts.overdue ?? 0, 'chip-overdue')}
          {chip('open', t('Open'), openCount)}
          {STATUS_ORDER.map((s) => chip(s, t(STATUS_LABEL[s]), counts[s] ?? 0))}
          {chip('', t('All'), all)}
        </div>
        <div className="dup-filters">
          <select
            className="legend-select"
            value={scheme}
            onChange={(e) => {
              setScheme(e.target.value)
              setPage(0)
            }}
            aria-label={t('Scheme')}
          >
            <option value="">{t('All schemes')}</option>
            {data?.schemes.map((s) => (
              <option key={s.code} value={s.code}>
                {t(s.name)}
              </option>
            ))}
          </select>
          <select
            className="legend-select"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as 'recent' | 'oldest')
              setPage(0)
            }}
            aria-label={t('Sort')}
          >
            <option value="recent">{t('Recently updated')}</option>
            <option value="oldest">{t('Waiting longest')}</option>
          </select>
          <input
            className="search"
            type="search"
            placeholder={t('Search name, voter ID or need')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
            }}
            aria-label={t('Search requests')}
          />
        </div>
        <p className="muted small">
          {t('To add a request, open the person from Find voter or a polling station’s voter list and choose “Needs help with a scheme”. No amounts are recorded.')}
        </p>
      </div>

      <div className="vs-body">
        <div className="vs-table-wrap dup-list">
          {error && <p className="form-error">{error}</p>}
          {data?.rows.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              user={user}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onChanged={load}
              onOpenVoter={onOpenVoter}
            />
          ))}
          {data && data.rows.length === 0 && <p className="finder-help muted">{t('No requests match.')}</p>}
          {!data && !error && <p className="finder-help muted">{t('Loading…')}</p>}
        </div>
      </div>

      <div className="vs-foot">
        <span className="muted">{data ? t(data.total === 1 ? '{n} request' : '{n} requests', { n: fmtInt(data.total) }) : ''}</span>
        <div className="vs-pager">
          <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← {t('Prev')}
          </button>
          <span className="muted">
            {t('Page')} {page + 1} / {pages}
          </span>
          <button className="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            {t('Next')} →
          </button>
        </div>
      </div>
    </>
  )
}

function RequestCard({
  r,
  user,
  open,
  onToggle,
  onChanged,
  onOpenVoter,
}: {
  r: HelpRequest
  user: Session
  open: boolean
  onToggle: () => void
  onChanged: () => void
  onOpenVoter: (b: Booth, serial: number) => void
}) {
  const booth = boothById.get(r.booth_id)
  return (
    <article className={`dup-card req-card ${open ? 'is-open' : ''}`}>
      <button className="req-summary" onClick={onToggle} aria-expanded={open}>
        <span className="req-status">
          <span className={`status-pill st-${r.status}`}>{t(STATUS_LABEL[r.status])}</span>
          {OPEN_STATUSES.includes(r.status) && (
            <span className={`days ${r.overdue ? 'is-overdue' : ''}`} title={t('Time limit: {n} days in this status', { n: SLA_DAYS[r.status] ?? '' })}>
              {r.overdue ? '⚠ ' : ''}
              {t(daysSince(r.status_since) === 1 ? '{n} day' : '{n} days', { n: daysSince(r.status_since) })}
              {r.overdue ? ` · ${t('overdue')}` : ''}
            </span>
          )}
        </span>
        <span className="req-main">
          <b>{r.voter_name}</b>
          <span className="muted">
            {' '}
            · {t(acName(r.ac))} PS {r.ps_no}
            {r.unit_name ? ` · ${t(r.unit_name)}` : ''}
          </span>
          <span className="req-need">
            <b>{t(r.scheme_name)}:</b> {r.need}
          </span>
        </span>
        <span className="muted small req-date">{t('Updated {date}', { date: when(r.updated_at) })}</span>
      </button>
      {open && <RequestDetail r={r} user={user} booth={booth} onChanged={onChanged} onOpenVoter={onOpenVoter} />}
    </article>
  )
}

function RequestDetail({
  r,
  user,
  booth,
  onChanged,
  onOpenVoter,
}: {
  r: HelpRequest
  user: Session
  booth?: Booth
  onChanged: () => void
  onOpenVoter: (b: Booth, serial: number) => void
}) {
  const [events, setEvents] = useState<RequestEvent[] | null>(null)
  const [status, setStatus] = useState<ReqStatus>(r.status)
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState<string>(r.assigned_to_id ? String(r.assigned_to_id) : '')
  const [team, setTeam] = useState<Team | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // Ward / mandal leads and admins update requests; booth leads only record them.
  const canAssign = user.role === 'admin' || user.role === 'unit_lead'

  useEffect(() => {
    requestEvents(r.id).then((d) => setEvents(d.events)).catch(() => setEvents([]))
    if (canAssign) loadTeam().then(setTeam).catch(() => {})
  }, [r.id, canAssign])

  // People who may own this request: the booth's lead and its ward / mandal lead.
  const assignees = useMemo(() => {
    if (!team || !booth) return []
    const out: { id: number; label: string }[] = []
    const bl = team.booths.find((b) => b.id === r.booth_id)?.lead
    if (bl) out.push({ id: bl.id, label: `${bl.name} (${t('booth lead')})` })
    const ul = team.units.find((u) => u.unitId === booth.unitId)?.lead
    if (ul) out.push({ id: ul.id, label: `${ul.name} (${t(booth.ac === 79 ? 'mandal lead' : 'ward lead')})` })
    return out
  }, [team, booth, r.booth_id])

  const save = async () => {
    setBusy(true)
    setMsg('')
    try {
      await updateRequest({
        id: r.id,
        status: status !== r.status ? status : undefined,
        note: note.trim() || undefined,
        assignedTo: canAssign && assignee && Number(assignee) !== r.assigned_to_id ? Number(assignee) : undefined,
      })
      setNote('')
      setMsg(t('Saved.'))
      onChanged()
      const d = await requestEvents(r.id)
      setEvents(d.events)
    } catch (e) {
      setMsg(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const changed = status !== r.status || note.trim() !== '' || (canAssign && assignee !== '' && Number(assignee) !== r.assigned_to_id)

  return (
    <div className="req-detail">
      <dl>
        <dt>{t('Voter')}</dt>
        <dd>
          {r.voter_name} · {t('Sl.')} {r.voter_serial} · <span className="mono">{r.voter_ref}</span>
        </dd>
        <dt>{t('Station')}</dt>
        <dd>
          {t(acName(r.ac))} PS {r.ps_no}, {r.booth_name}
        </dd>
        {r.contact_mobile && (
          <>
            <dt>{t('Mobile')}</dt>
            <dd>
              <span className="contact-actions">
                <a
                  className="wa-btn"
                  href={whatsappLink(r.contact_mobile, r, user.name)}
                  target="_blank"
                  rel="noreferrer"
                  title={t('Opens WhatsApp with a drafted message — review it before sending')}
                >
                  WhatsApp {r.contact_mobile}
                </a>
                <a className="ghost call-btn" href={`tel:${r.contact_mobile}`}>
                  {t('Call')}
                </a>
              </span>
            </dd>
          </>
        )}
        <dt>{t('Added')}</dt>
        <dd>
          {t('{date} by {name} · consent recorded', { date: when(r.created_at), name: r.created_by })}
        </dd>
        <dt>{t('Owner')}</dt>
        <dd>{r.assigned_to ?? '—'}</dd>
      </dl>
      {booth && (
        <button className="link-btn" onClick={() => onOpenVoter(booth, r.voter_serial)}>
          {t('Open this person in the voter list')} →
        </button>
      )}

      {!canAssign ? (
        <p className="read-only-note small">
          🔒 {t('Saved requests are updated by your ward / mandal lead or an admin. You can follow progress in the history below.')}
        </p>
      ) : (
      <div className="req-update">
        <label>
          {t('Status')}
          <select className="legend-select" value={status} onChange={(e) => setStatus(e.target.value as ReqStatus)}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_LABEL[s])}
              </option>
            ))}
          </select>
        </label>
        {canAssign && (
          <label>
            {t('Owner')}
            <select className="legend-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">—</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="wide">
          {t('Note (optional)')}
          <input className="search" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. Applied at MeeSeva, receipt no. noted')} />
        </label>
        <button className="primary" onClick={save} disabled={busy || !changed}>
          {busy ? t('Saving…') : t('Save')}
        </button>
        {msg && <span className="small muted">{msg}</span>}
      </div>
      )}

      <h4>{t('History')}</h4>
      <ol className="history">
        {events === null && <li className="muted">{t('Loading…')}</li>}
        {events?.map((e, i) => (
          <li key={i}>
            <span className="muted small">{new Date(e.at).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</span>{' '}
            <b>{e.by}</b>{' '}
            {e.action === 'created' && t('recorded the request')}
            {e.action === 'status' && (
              <>
                {t('changed status')} {e.from_status ? `${t(STATUS_LABEL[e.from_status])} → ` : ''}
                <b>{e.to_status ? t(STATUS_LABEL[e.to_status]) : ''}</b>
              </>
            )}
            {e.action === 'note' && t('added a note')}
            {e.action === 'assigned' && (e.note ? assignedNote(e.note) : t('changed the owner'))}
            {e.note && e.action !== 'assigned' && <div className="history-note">“{e.note}”</div>}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team & coverage
// ---------------------------------------------------------------------------

function TeamView({ user, onShowCoverage }: { user: Session; onShowCoverage: (ac: number) => void }) {
  const [team, setTeam] = useState<Team | null>(null)
  const [error, setError] = useState('')
  const [openUnit, setOpenUnit] = useState<string | null>(null)
  // Admins and ward / mandal leads can change who covers what.
  const canEdit = user.role === 'admin' || user.role === 'unit_lead'
  const [people, setPeople] = useState<{ people: Person[]; assignments: AssignmentRow[] } | null>(null)
  const [editMsg, setEditMsg] = useState('')

  const reload = useCallback(() => {
    loadTeam(true).then(setTeam).catch((e) => setError(errorText(e)))
    if (canEdit) loadAssignments().then(setPeople).catch((e) => setError(errorText(e)))
  }, [canEdit])
  useEffect(reload, [reload])

  const boothLeads = (people?.people ?? []).filter((p) => p.role === 'booth_lead' && p.active)
  const unitLeads = (people?.people ?? []).filter((p) => p.role === 'unit_lead' && p.active)
  const change = async (f: () => Promise<unknown>, done: string) => {
    setEditMsg(t('Saving…'))
    try {
      await f()
      setEditMsg(done)
      reload()
    } catch (e) {
      setEditMsg(errorText(e))
    }
  }

  if (error) return <p className="finder-help form-error">{error}</p>
  if (!team) return <p className="finder-help muted">{t('Loading…')}</p>

  const total = team.booths.length
  const covered = team.booths.filter((b) => b.lead).length
  const open = team.booths.reduce((n, b) => n + b.open, 0)
  const acs = [...new Set(team.units.map((u) => u.ac))]

  return (
    <>
      <div className="dup-summary">
        <div className="team-kpis">
          <div>
            <b>{team.units.length}</b> {t(team.units.length === 1 ? 'area' : 'wards / mandals')}
          </div>
          <div>
            <b>
              {fmtInt(covered)} / {fmtInt(total)}
            </b>{' '}
            {t('polling stations have a booth lead')} ({total ? Math.round((covered / total) * 100) : 0}%)
          </div>
          <div>
            <b>{fmtInt(open)}</b> {t('open help requests')}
          </div>
        </div>
        {canEdit && people && (
          <PeopleManager user={user} people={people.people} assignments={people.assignments} onChanged={reload} />
        )}
        {canEdit && <p className="muted small">{t('Changes apply to that person the next time they sign in.')}{editMsg && <b> {editMsg}</b>}</p>}
        {user.role !== 'booth_lead' && (
          <div className="dup-filters">
            {acs.map((ac) => (
              <button key={ac} className="ghost" onClick={() => onShowCoverage(ac)}>
                {t('Show {area} coverage on the map', { area: t(acName(ac)) })} →
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="vs-body">
        <div className="vs-table-wrap dup-list">
          {team.units.map((u) => {
            const booths = team.booths.filter((b) => b.unitId === u.unitId)
            const isOpen = openUnit === u.unitId
            return (
              <article key={u.unitId} className="dup-card">
                <button className="req-summary" onClick={() => setOpenUnit(isOpen ? null : u.unitId)} aria-expanded={isOpen}>
                  <span className="req-main">
                    <b>{t(u.unitName)}</b> <span className="muted">· {t(acName(u.ac))}</span>
                    <span className="req-need">
                      {t('Lead')}:{' '}
                      {u.lead ? (
                        u.lead.name
                      ) : (
                        <i>{t('vacant')}</i>
                      )}
                      {u.lead?.phone && (
                        <>
                          {' '}
                          · <a href={`tel:${u.lead.phone}`} onClick={(e) => e.stopPropagation()}>{u.lead.phone}</a>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="coverage">
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(u.covered / Math.max(1, u.booths)) * 100}%` }} />
                    </span>
                    <span className="small">
                      {u.covered}/{u.booths} {t('booths')} · {u.open} {t('open')}
                    </span>
                  </span>
                </button>
                {isOpen && user.role === 'admin' && people && (
                  <label className="unit-lead-pick">
                    {t('Ward / mandal lead')}
                    <select
                      className="legend-select inline-select"
                      value={u.lead?.id ?? ''}
                      onChange={(e) =>
                        change(() => setUnitLead(u.unitId, e.target.value ? Number(e.target.value) : null), `${t(u.unitName)}: ${t('lead updated.')}`)
                      }
                    >
                      <option value="">— {t('vacant')} —</option>
                      {unitLeads.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.username})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {isOpen && (
                  <table className="vs-table team-table">
                    <thead>
                      <tr>
                        <th>PS</th>
                        <th>{t('Booth lead')}</th>
                        <th className="hide-sm">{t('Phone')}</th>
                        <th>{t('Open')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {booths.map((b) => (
                        <tr key={b.id} className={b.lead ? '' : 'is-gap'}>
                          <td className="num">{b.psNo}</td>
                          <td>
                            {canEdit && people ? (
                              <select
                                className="legend-select inline-select"
                                value={b.lead?.id ?? ''}
                                onChange={(e) =>
                                  change(
                                    () => setBoothLead(b.id, e.target.value ? Number(e.target.value) : null),
                                    `PS ${b.psNo}: ${t('booth lead updated.')}`,
                                  )
                                }
                                aria-label={`Booth lead for PS ${b.psNo}`}
                              >
                                <option value="">— {t('No booth lead')} —</option>
                                {boothLeads.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.username})
                                  </option>
                                ))}
                              </select>
                            ) : b.lead ? (
                              b.lead.name
                            ) : (
                              <span className="gap">{t('No booth lead')}</span>
                            )}
                          </td>
                          <td className="hide-sm">{b.lead?.phone ? <a href={`tel:${b.lead.phone}`}>{b.lead.phone}</a> : '—'}</td>
                          <td className="num">{b.open}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </article>
            )
          })}
        </div>
      </div>
      <div className="vs-foot">
        <span className="muted small">{t('Phone numbers are shown only to people above in the team.')}</span>
      </div>
    </>
  )
}

/** Server notes like "Assigned to Mederu Ravi" in the current language. */
function assignedNote(note: string) {
  const m = note.match(/^Assigned to (.+)$/)
  return m ? t('Assigned to {name}', { name: m[1] }) : note
}
