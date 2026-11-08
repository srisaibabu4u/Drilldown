import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadSession, logout, type Session } from './session.ts'

function Root() {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    loadSession().then(setSession)
  }, [])
  if (!session) return null // redirecting to the login page, or still checking
  return <App user={session} onLogout={logout} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
