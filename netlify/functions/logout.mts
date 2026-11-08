// POST /api/logout → clears the session cookie.
import { clearCookie, json } from '../lib/session.ts'

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' })
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() })
}

export const config = { path: '/api/logout' }
