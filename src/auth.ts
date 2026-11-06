// TEMPORARY client-side login.
//
// This is NOT real security: the app is a static site, so anyone can read this
// file in the browser bundle and bypass the check. It only keeps casual visitors
// out. Replace it with a real auth provider (e.g. Netlify Identity, Auth0,
// Supabase) before putting anything sensitive behind it.
//
// Passwords are stored as SHA-256 hashes so the plain text isn't in the bundle.
// To add a user:  node -e "console.log(require('crypto').createHash('sha256').update('PASSWORD').digest('hex'))"

interface User {
  username: string
  name: string
  passwordSha256: string
}

const USERS: User[] = [
  {
    username: 'admin',
    name: 'Admin',
    passwordSha256: 'd59011fa1f91dd1a5378a970751c1853e968d53ab8824f1586f736c7cc39de22',
  },
]

const STORAGE_KEY = 'kd-session'

export interface Session {
  username: string
  name: string
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function login(username: string, password: string): Promise<Session | null> {
  const user = USERS.find((u) => u.username.toLowerCase() === username.trim().toLowerCase())
  if (!user || (await sha256(password)) !== user.passwordSha256) return null
  const session = { username: user.username, name: user.name }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* storage blocked: session lasts for this page load only */
  }
  return session
}

export function currentSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function logout() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
