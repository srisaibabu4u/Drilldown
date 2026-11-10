// GET /api/me → the signed-in user, their role and area, or 401.
import { db } from '../lib/db.ts'
import { json, sessionFrom } from '../lib/session.ts'

export default async (req: Request) => {
  const s = await sessionFrom(req)
  if (!s) return json({ error: 'unauthenticated' }, 401)
  const sql = db()
  // No database (or an AUTH_USERS login): plain sign-in, no team features.
  if (!sql || !s.uid) return json({ username: s.username, name: s.name, role: s.role ?? 'admin', team: false })

  const [u] = await sql<{ username: string; name: string; role: string }[]>`
    select username, name, role from app_users where id = ${s.uid} and active`
  if (!u) return json({ error: 'unauthenticated' }, 401)
  const rows = await sql<{ unit_id: string | null; booth_id: string | null; unit_name: string | null }[]>`
    select a.unit_id, a.booth_id, coalesce(b.unit_name, (select unit_name from booths where unit_id = a.unit_id limit 1)) as unit_name
    from assignments a left join booths b on b.id = a.booth_id
    where a.user_id = ${s.uid}`
  return json({
    username: u.username,
    name: u.name,
    role: u.role,
    team: true,
    units: rows.filter((r) => r.unit_id).map((r) => ({ id: r.unit_id, name: r.unit_name })),
    booths: rows.filter((r) => r.booth_id).map((r) => r.booth_id),
  })
}

export const config = { path: '/api/me' }
