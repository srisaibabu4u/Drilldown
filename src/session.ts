// Who is signed in, as reported by the server (/api/me). The password check and
// session cookie live in netlify/functions; this file never sees credentials.

export type Role = 'admin' | 'unit_lead' | 'booth_lead'

export interface Session {
  username: string
  name: string
  role?: Role
  /** true when users come from the database — team features (help requests, coverage) are on. */
  team?: boolean
  /** Wards / mandals a unit lead covers. */
  units?: { id: string; name: string }[]
  /** Booth ids a booth lead covers. */
  booths?: string[]
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  unit_lead: 'Ward / mandal lead',
  booth_lead: 'Booth lead',
}

/** Can this user see / act on a polling station? (The server enforces the same rule.) */
export function canActOnBooth(s: Session, booth: { id: string; unitId?: string }) {
  if (!s.team) return false
  if (s.role === 'admin') return true
  if (s.role === 'unit_lead') return !!booth.unitId && !!s.units?.some((u) => u.id === booth.unitId)
  return !!s.booths?.includes(booth.id)
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
