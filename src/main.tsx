import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LoginPage from './components/LoginPage.tsx'
import { currentSession, logout, type Session } from './auth.ts'

function Root() {
  const [session, setSession] = useState<Session | null>(currentSession)
  if (!session) return <LoginPage onLogin={setSession} />
  return (
    <App
      user={session}
      onLogout={() => {
        logout()
        setSession(null)
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
