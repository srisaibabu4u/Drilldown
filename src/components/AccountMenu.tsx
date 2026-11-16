import { useEffect, useRef, useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { ROLE_LABEL, type Session } from '../session'
import { changeMyPassword, errorText } from '../team'
import PasswordFields, { passwordOk } from './PasswordFields'

/** Header account menu: who is signed in, change my password, log out. */
export default function AccountMenu({
  user,
  onLogout,
  onManagePeople,
}: {
  user: Session
  onLogout: () => void
  /** Admins and ward / mandal leads: open People (add people, set passwords). */
  onManagePeople?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="account" ref={ref}>
      <button className="ghost account-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {t('Account')} ▾
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-who">
            <b>{user.name}</b>
            <span className="muted small">
              {user.username}
              {user.role ? ` · ${t(ROLE_LABEL[user.role])}` : ''}
            </span>
          </div>
          {user.team && (
            <button
              role="menuitem"
              className="account-item"
              onClick={() => {
                setOpen(false)
                setChanging(true)
              }}
            >
              🔑 {t('Change my password')}
            </button>
          )}
          {onManagePeople && (
            <button
              role="menuitem"
              className="account-item"
              onClick={() => {
                setOpen(false)
                onManagePeople()
              }}
            >
              👥 {t('People & passwords')}
            </button>
          )}
          <button role="menuitem" className="account-item" onClick={onLogout}>
            ⎋ {t('Log out')}
          </button>
        </div>
      )}
      {changing && <ChangePassword user={user} onClose={() => setChanging(false)} />}
    </div>
  )
}

function ChangePassword({ user, onClose }: { user: Session; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ready = current !== '' && passwordOk(pw) && pw === pw2

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    if (pw.toLowerCase().includes(user.username.toLowerCase())) {
      setMsg({ ok: false, text: t('The password must not contain the username.') })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await changeMyPassword(current, pw)
      setMsg({ ok: true, text: t('Password changed. Use the new one next time you sign in.') })
      setCurrent('')
      setPw('')
      setPw2('')
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-label={t('Change my password')} onSubmit={submit}>
        <div className="modal-head">
          <h3>{t('Change my password')}</h3>
          <button type="button" className="ghost vs-close" onClick={onClose} aria-label={t('Close')}>
            ✕
          </button>
        </div>
        <p className="muted small">
          {user.name} · {user.username}
        </p>
        <label className="pw-current">
          <span className="small">{t('Current password')}</span>
          <input className="search" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </label>
        <PasswordFields value={pw} confirm={pw2} onValue={setPw} onConfirm={setPw2} />
        {msg && <p className={`small ${msg.ok ? 'ok-note' : 'form-error'}`}>{msg.text}</p>}
        <div className="help-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {msg?.ok ? t('Close') : t('Cancel')}
          </button>
          <button className="primary" disabled={busy || !ready}>
            {busy ? t('Saving…') : t('Change password')}
          </button>
        </div>
      </form>
    </div>
  )
}
