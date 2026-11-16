import { useState } from 'react'
import { t } from '../i18n'

/** Same rule as the server (netlify/lib/session.ts passwordProblem). */
export const passwordOk = (pw: string) => pw.length >= 8 && pw.length <= 72 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw)

/** New password + confirm, with a show / hide switch and the rules. */
export default function PasswordFields({
  value,
  confirm,
  onValue,
  onConfirm,
  label,
}: {
  value: string
  confirm: string
  onValue: (v: string) => void
  onConfirm: (v: string) => void
  label?: string
}) {
  const [show, setShow] = useState(false)
  const type = show ? 'text' : 'password'
  const mismatch = confirm !== '' && confirm !== value
  return (
    <div className="pw-fields">
      <label>
        <span className="small">{label ?? t('New password')}</span>
        <input className="search" type={type} autoComplete="new-password" value={value} onChange={(e) => onValue(e.target.value)} maxLength={72} />
      </label>
      <label>
        <span className="small">{t('Type it again')}</span>
        <input className="search" type={type} autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} maxLength={72} />
      </label>
      <label className="pw-show small">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {t('Show password')}
      </label>
      <p className={`small ${value && !passwordOk(value) ? 'form-error' : 'muted'}`}>
        {t('At least 8 characters, with at least one letter and one number.')}
      </p>
      {mismatch && <p className="small form-error">{t('The two passwords don’t match.')}</p>}
    </div>
  )
}
