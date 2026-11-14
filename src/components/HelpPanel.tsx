import { useCallback, useEffect, useMemo, useState } from 'react'
import { acName, boothById, type Booth } from '../booths'
import { fmtInt } from '../format'
import { ROLE_LABEL, type Session } from '../session'
import {
  errorText,
  listRequests,
  loadTeam,
  OPEN_STATUSES,
  requestEvents,
  STATUS_LABEL,
  STATUS_ORDER,
  updateRequest,
  type HelpRequest,
  type ReqStatus,
  type RequestEvent,
  type RequestList,
  type Team,
} from '../team'

export type HelpTab = 'requests' | 'team'
const PAGE = 50

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Help requests + team / coverage, for leads and admins. */
export default function HelpPanel({
  user,
  tab,
  onTab,
  onClose,
  onOpenVoter,
  onShowCoverage,
}: {
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
      ? 'All areas'
      : user.role === 'unit_lead'
        ? (user.units ?? []).map((u) => u.name).join(', ')
        : `${user.booths?.length ?? 0} polling station${user.booths?.length === 1 ? '' : 's'}`

  return (
    <div className="voter-sheet finder help-sheet" role="dialog" aria-modal="false" aria-label="Help requests and team">
      <div className="vs-head">
        <div>
          <div className="kicker">
            {ROLE_LABEL[user.role ?? 'admin']} · {area}
          </div>
          <h2>{tab === 'requests' ? 'Scheme help requests' : 'Team & coverage'}</h2>
          <div className="vs-chips">
            <span className="badge badge-sample">⚠ Demo data · synthetic people</span>
          </div>
        </div>
        <button className="ghost vs-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="vs-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'is-on' : ''} onClick={() => onTab('requests')}>
          Help requests
        </button>
        <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'is-on' : ''} onClick={() => onTab('team')}>
          Team &amp; coverage
        </button>
      </div>
      {tab === 'requests' ? (
        <Requests user={user} onOpenVoter={onOpenVoter} />
      ) : (
        <TeamView user={user} onShowCoverage={onShowCoverage} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Help requests
// ---------------------------------------------------------------------------

function Requests({ user, onOpenVoter }: { user: Session; onOpenVoter: (b: Booth, serial: number) => void }) {
  const [status, setStatus] = useState<'open' | '' | ReqStatus>('open')
  const [scheme, setScheme] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<RequestList | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const load = useCallback(() => {
    listRequests({ status, scheme, q: q.trim(), limit: PAGE, offset: page * PAGE })
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
  }, [status, scheme, q, page])

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  const counts = data?.counts ?? {}
  const openCount = OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const all = STATUS_ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE))
  const chip = (value: typeof status, label: string, n: number) => (
    <button
      key={label}
      className={`chip-toggle ${status === value ? 'is-on' : ''}`}
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
          {chip('open', 'Open', openCount)}
          {STATUS_ORDER.map((s) => chip(s, STATUS_LABEL[s], counts[s] ?? 0))}
          {chip('', 'All', all)}
        </div>
        <div className="dup-filters">
          <select
            className="legend-select"
            value={scheme}
            onChange={(e) => {
              setScheme(e.target.value)
              setPage(0)
            }}
            aria-label="Scheme"
          >
            <option value="">All schemes</option>
            {data?.schemes.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            className="search"
            type="search"
            placeholder="Search name, voter ID or need"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
            }}
            aria-label="Search requests"
          />
        </div>
        <p className="muted small">
          To add a request, open the person from Find voter or a polling station’s voter list and choose “Needs help
          with a scheme”. No amounts are recorded.
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
          {data && data.rows.length === 0 && <p className="finder-help muted">No requests match.</p>}
          {!data && !error && <p className="finder-help muted">Loading…</p>}
        </div>
      </div>

      <div className="vs-foot">
        <span className="muted">{data ? `${fmtInt(data.total)} request${data.total === 1 ? '' : 's'}` : ''}</span>
        <div className="vs-pager">
          <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span className="muted">
            Page {page + 1} / {pages}
          </span>
          <button className="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next →
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
        <span className={`status-pill st-${r.status}`}>{STATUS_LABEL[r.status]}</span>
        <span className="req-main">
          <b>{r.voter_name}</b>
          <span className="muted">
            {' '}
            · {acName(r.ac)} PS {r.ps_no}
            {r.unit_name ? ` · ${r.unit_name}` : ''}
          </span>
          <span className="req-need">
            <b>{r.scheme_name}:</b> {r.need}
          </span>
        </span>
        <span className="muted small req-date">Updated {when(r.updated_at)}</span>
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
    if (bl) out.push({ id: bl.id, label: `${bl.name} (booth lead)` })
    const ul = team.units.find((u) => u.unitId === booth.unitId)?.lead
    if (ul) out.push({ id: ul.id, label: `${ul.name} (${booth.ac === 79 ? 'mandal' : 'ward'} lead)` })
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
      setMsg('Saved.')
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
        <dt>Voter</dt>
        <dd>
          {r.voter_name} · Sl. {r.voter_serial} · <span className="mono">{r.voter_ref}</span>
        </dd>
        <dt>Station</dt>
        <dd>
          {acName(r.ac)} PS {r.ps_no}, {r.booth_name}
        </dd>
        {r.contact_mobile && (
          <>
            <dt>Mobile</dt>
            <dd>
              <a href={`tel:${r.contact_mobile}`}>{r.contact_mobile}</a>
            </dd>
          </>
        )}
        <dt>Added</dt>
        <dd>
          {when(r.created_at)} by {r.created_by} · consent recorded
        </dd>
        <dt>Owner</dt>
        <dd>{r.assigned_to ?? '—'}</dd>
      </dl>
      {booth && (
        <button className="link-btn" onClick={() => onOpenVoter(booth, r.voter_serial)}>
          Open this person in the voter list →
        </button>
      )}

      {!canAssign ? (
        <p className="read-only-note small">
          🔒 Saved requests are updated by your ward / mandal lead or an admin. You can follow progress in the history below.
        </p>
      ) : (
      <div className="req-update">
        <label>
          Status
          <select className="legend-select" value={status} onChange={(e) => setStatus(e.target.value as ReqStatus)}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {canAssign && (
          <label>
            Owner
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
          Note (optional)
          <input className="search" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Applied at MeeSeva, receipt no. noted" />
        </label>
        <button className="primary" onClick={save} disabled={busy || !changed}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="small muted">{msg}</span>}
      </div>
      )}

      <h4>History</h4>
      <ol className="history">
        {events === null && <li className="muted">Loading…</li>}
        {events?.map((e, i) => (
          <li key={i}>
            <span className="muted small">{new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>{' '}
            <b>{e.by}</b>{' '}
            {e.action === 'created' && 'recorded the request'}
            {e.action === 'status' && (
              <>
                changed status {e.from_status ? `${STATUS_LABEL[e.from_status]} → ` : ''}
                <b>{e.to_status ? STATUS_LABEL[e.to_status] : ''}</b>
              </>
            )}
            {e.action === 'note' && 'added a note'}
            {e.action === 'assigned' && (e.note ?? 'changed the owner')}
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

  useEffect(() => {
    loadTeam(true).then(setTeam).catch((e) => setError(errorText(e)))
  }, [])

  if (error) return <p className="finder-help form-error">{error}</p>
  if (!team) return <p className="finder-help muted">Loading…</p>

  const total = team.booths.length
  const covered = team.booths.filter((b) => b.lead).length
  const open = team.booths.reduce((n, b) => n + b.open, 0)
  const acs = [...new Set(team.units.map((u) => u.ac))]

  return (
    <>
      <div className="dup-summary">
        <div className="team-kpis">
          <div>
            <b>{team.units.length}</b> {team.units.length === 1 ? 'area' : 'wards / mandals'}
          </div>
          <div>
            <b>
              {fmtInt(covered)} / {fmtInt(total)}
            </b>{' '}
            polling stations have a booth lead ({total ? Math.round((covered / total) * 100) : 0}%)
          </div>
          <div>
            <b>{fmtInt(open)}</b> open help requests
          </div>
        </div>
        {user.role !== 'booth_lead' && (
          <div className="dup-filters">
            {acs.map((ac) => (
              <button key={ac} className="ghost" onClick={() => onShowCoverage(ac)}>
                Show {acName(ac)} coverage on the map →
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
                    <b>{u.unitName}</b> <span className="muted">· {acName(u.ac)}</span>
                    <span className="req-need">
                      Lead: {u.lead ? u.lead.name : <i>vacant</i>}
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
                      {u.covered}/{u.booths} booths · {u.open} open
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <table className="vs-table team-table">
                    <thead>
                      <tr>
                        <th>PS</th>
                        <th>Booth lead</th>
                        <th className="hide-sm">Phone</th>
                        <th>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {booths.map((b) => (
                        <tr key={b.id} className={b.lead ? '' : 'is-gap'}>
                          <td className="num">{b.psNo}</td>
                          <td>{b.lead ? b.lead.name : <span className="gap">No booth lead</span>}</td>
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
        <span className="muted small">Phone numbers are shown only to people above in the team.</span>
      </div>
    </>
  )
}
