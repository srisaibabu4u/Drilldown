// Who is signed in, as reported by the server (/api/me). The password check and
// session cookie live in netlify/functions; this file never sees credentials.

export interface Session {
  username: string
  name: string
}

/**
 * Resolves the signed-in user. In production a missing session sends the browser
 * to the login page. In `npm run dev` (plain Vite, no Netlify functions) it falls
 * back to a local developer user so the map can be worked on without the server.
 */
export async function loadSession(): Promise<Session | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) {
      return (await res.json()) as Session
    }
    if (import.meta.env.DEV && res.status !== 401) return { username: 'dev', name: 'Developer' }
  } catch {
    if (import.meta.env.DEV) return { username: 'dev', name: 'Developer' }
  }
  window.location.replace('/login.html')
  return null
}

export async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
  } finally {
    // A full page load also drops the #view, so the next sign-in starts on the home map.
    window.location.replace('/login.html')
  }
}
