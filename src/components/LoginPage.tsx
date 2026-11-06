import { useState, type FormEvent } from 'react'
import { login, type Session } from '../auth'

export default function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const s = await login(username, password)
    setBusy(false)
    if (s) onLogin(s)
    else setError('Incorrect username or password.')
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◉
          </span>
          <div>
            <h1>Kukatpally Drilldown</h1>
            <p>Sign in to explore the map</p>
          </div>
        </div>

        <label className="field">
          <span>Username</span>
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>

        <div className="field">
          <label htmlFor="login-password">Password</label>
          <div className="pw-wrap">
            <input
              id="login-password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              aria-pressed={showPw}
              title={showPw ? 'Hide password' : 'Show password'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
                {showPw && <path d="M3 3l18 18" />}
              </svg>
            </button>
          </div>
        </div>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button className="primary login-btn" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
