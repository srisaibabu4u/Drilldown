// GET /api/me → the signed-in user, or 401.
import { json, sessionFrom } from '../lib/session.ts'

export default async (req: Request) => {
  const s = await sessionFrom(req)
  return s ? json({ username: s.username, name: s.name }) : json({ error: 'unauthenticated' }, 401)
}

export const config = { path: '/api/me' }
