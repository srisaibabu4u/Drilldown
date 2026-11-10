// GET /api/request-events?id=<request id> → who changed what, oldest first.
import { actorFrom, boothInScope } from '../lib/db.ts'
import { json } from '../lib/session.ts'

export default async (req: Request) => {
  const ctx = await actorFrom(req)
  if (ctx instanceof Response) return ctx
  const { sql, actor } = ctx
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isInteger(id)) return json({ error: 'bad_request' }, 400)
  const [r] = await sql`
    select 1 from help_requests r join booths b on b.id = r.booth_id where r.id = ${id} and ${boothInScope(sql, actor)}`
  if (!r) return json({ error: 'not_found' }, 404)
  const events = await sql`
    select e.action, e.from_status, e.to_status, e.note, e.at, u.name as by, u.role
    from request_events e join app_users u on u.id = e.user_id
    where e.request_id = ${id} order by e.at, e.id`
  return json({ events })
}

export const config = { path: '/api/request-events' }
