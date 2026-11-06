import { useState, type FormEvent } from 'react'
import { login, type Session } from '../auth'

export default function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

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
