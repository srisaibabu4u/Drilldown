import { useMemo, useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { ROLE_LABEL, type Role, type Session } from '../session'
import { addPerson, errorText, resetPassword, setActive, type AssignmentRow, type Person } from '../team'

/**
 * People in the caller's reach: add a person (temporary password shown once),
 * reset a password, deactivate / reactivate. Admins manage everyone; ward /
 * mandal leads manage booth leads in their area.
 */
export default function PeopleManager({
  user,
  people,
  assignments,
  onChanged,
}: {
  user: Session
  people: Person[]
  assignments: AssignmentRow[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('booth_lead')
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState<{ text: string; secret?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const isAdmin = user.role === 'admin'

  const covers = (id: number) => {
    const rows = assignments.filter((a) => a.user_id === id)
    const units = rows.filter((a) => a.unit_id).length
    const booths = rows.filter((a) => a.booth_id).length
    return units ? t('{n} wards / mandals', { n: units }) : booths ? t('{n} booths', { n: booths }) : t('no area yet')
  }
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return people
      .filter((p) => p.username !== user.username)
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.username.includes(s))
  }, [people, q, user.username])

  const run = async (f: () => Promise<{ text: string; secret?: string }>) => {
    setBusy(true)
    setMsg(null)
    try {
      setMsg(await f())
      onChanged()
    } catch (e) {
      setMsg({ text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      const r = await addPerson({ name, username, role: isAdmin ? role : 'booth_lead', phone: phone || undefined })
      setName('')
      setUsername('')
      setPhone('')
      setAdding(false)
      return { text: t('Added {user}. Share this temporary password with them privately:', { user: r.username }), secret: r.tempPassword }
    })
  }

  return (
    <section className="people">
      <button className="ghost people-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} {t('People')} ({people.length - 1})
      </button>
      {open && (
        <div className="people-body">
          {msg && (
            <div className={`people-msg ${msg.secret ? 'has-secret' : ''}`} role="status">
              {msg.text} {msg.secret && <b className="mono">{msg.secret}</b>}
              {msg.secret && <div className="muted small">{t('It isn’t shown again. They sign in with it and you can reset it any time.')}</div>}
            </div>
          )}
          {!adding ? (
            <button className="ghost" onClick={() => setAdding(true)}>
              + {isAdmin ? t('Add a person') : t('Add a booth lead')}
            </button>
          ) : (
            <form className="person-form" onSubmit={submit}>
              <input className="search" placeholder={t('Full name')} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              <input
                className="search"
                placeholder={t('Username, e.g. bl.moosapet.09')}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                required
                pattern="[a-z0-9._-]{3,40}"
              />
              {isAdmin && (
                <select className="legend-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="booth_lead">{t('Booth lead')}</option>
                  <option value="unit_lead">{t('Ward / mandal lead')}</option>
                  <option value="admin">{t('Admin')}</option>
                </select>
              )}
              <input
                className="search"
                placeholder={t('Mobile (optional)')}
                inputMode="numeric"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              />
              <div className="help-actions">
                <button type="button" className="ghost" onClick={() => setAdding(false)}>
                  {t('Cancel')}
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? t('Adding…') : t('Add')}
                </button>
              </div>
              <p className="muted small">{t('Then assign their booths (or ward) in the list below.')}</p>
            </form>
          )}
          <input className="search" type="search" placeholder={t('Search people')} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="people-list">
            {list.slice(0, 100).map((p) => (
              <li key={p.id} className={p.active ? '' : 'is-inactive'}>
                <span>
                  <b>{p.name}</b> <span className="muted">· {p.username} · {t(ROLE_LABEL[p.role])} · {covers(p.id)}</span>
                  {!p.active && <span className="gap"> · {t('deactivated')}</span>}
                </span>
                <span className="people-actions">
                  <button
                    className="link-btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await resetPassword(p.id)
                        return { text: t('New temporary password for {user}:', { user: p.username }), secret: r.tempPassword }
                      })
                    }
                  >
                    {t('Reset password')}
                  </button>
                  <button
                    className="link-btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await setActive(p.id, !p.active)
                        return { text: `${p.username}: ${p.active ? t('deactivated — they can no longer sign in.') : t('reactivated.')}` }
                      })
                    }
                  >
                    {p.active ? t('Deactivate') : t('Reactivate')}
                  </button>
                </span>
              </li>
            ))}
            {list.length > 100 && <li className="muted small">{t('Showing 100 of {n} — search to narrow down.', { n: list.length })}</li>}
          </ul>
        </div>
      )}
    </section>
  )
}
