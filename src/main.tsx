import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LoginPage from './components/LoginPage.tsx'
import { currentSession, logout, type Session } from './auth.ts'

/** Drop the #view from the address so the next sign-in starts on the home (India) map. */
function resetToHome() {
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)
}

function Root() {
  const [session, setSession] = useState<Session | null>(currentSession)
  if (!session)
    return (
      <LoginPage
        onLogin={(s) => {
          resetToHome()
          setSession(s)
        }}
      />
    )
  return (
    <App
      user={session}
      onLogout={() => {
        logout()
        resetToHome()
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
