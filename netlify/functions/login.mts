// POST /api/login  { username, password }  → sets the signed session cookie.
// Users come from the database (app_users) when DATABASE_URL is set; otherwise
// from the AUTH_USERS environment variable (single-admin setup).
import { db } from '../lib/db.ts'
import { env, json, sessionCookie, SESSION_HOURS, signSession, users, verifyPassword } from '../lib/session.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DUMMY = 'pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

interface Candidate {
  id?: number
  username: string
  name: string
  role: string
  hash: string
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' })

  const secret = env('SESSION_SECRET')
  const sql = db()
  const envUsers = users()
  if (!secret || secret.length < 32 || (!sql && envUsers.length === 0)) {
    return json({ error: 'not_configured' }, 503)
  }

  let username = ''
  let password = ''
  try {
    const body = await req.json()
    username = String(body.username ?? '').trim().toLowerCase()
    password = String(body.password ?? '')
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  let user: Candidate | undefined
  if (sql) {
    const [u] = await sql<{ id: number; username: string; name: string; role: string; password_hash: string }[]>`
      select id::int, username, name, role, password_hash from app_users where username = ${username} and active`
    if (u) user = { id: u.id, username: u.username, name: u.name, role: u.role, hash: u.password_hash }
  } else {
    const u = envUsers.find((x) => x.username.toLowerCase() === username)
    if (u) user = { username: u.username, name: u.name || u.username, role: 'admin', hash: u.hash }
  }

  // Always run the hash check (against a dummy when the user is unknown) so timing
  // doesn't reveal which usernames exist.
  const ok = await verifyPassword(password, user?.hash ?? DUMMY)
  if (!user || !ok) {
    await sleep(600) // slow down password guessing
    return json({ error: 'invalid_credentials' }, 401)
  }

  const token = await signSession(
    {
      uid: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600,
    },
    secret,
  )
  return json({ ok: true, name: user.name }, 200, { 'set-cookie': sessionCookie(token) })
}

export const config = { path: '/api/login' }
