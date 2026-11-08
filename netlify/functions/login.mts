// POST /api/login  { username, password }  → sets the signed session cookie.
import { env, json, sessionCookie, SESSION_HOURS, signSession, users, verifyPassword } from '../lib/session.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' })

  const secret = env('SESSION_SECRET')
  const list = users()
  if (!secret || secret.length < 32 || list.length === 0) {
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

  const user = list.find((u) => u.username.toLowerCase() === username)
  // Always run the hash check (against a dummy when the user is unknown) so timing
  // doesn't reveal which usernames exist.
  const ok = await verifyPassword(
    password,
    user?.hash ?? 'pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  )
  if (!user || !ok) {
    await sleep(600) // slow down password guessing
    return json({ error: 'invalid_credentials' }, 401)
  }

  const token = await signSession(
    { username: user.username, name: user.name || user.username, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 },
    secret,
  )
  return json({ ok: true, name: user.name || user.username }, 200, { 'set-cookie': sessionCookie(token) })
}

export const config = { path: '/api/login' }
