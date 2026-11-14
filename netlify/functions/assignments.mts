// Who covers what — editable by admins (everything) and ward / mandal leads (booth
// leads within their own ward / mandal). Booth leads can't change assignments.
//
//   GET   /api/assignments
//         → { people, assignments } within the caller's reach
//   PUT   /api/assignments  { boothId, userId | null }   set / clear a booth's booth lead
//   PUT   /api/assignments  { unitId,  userId | null }   set / clear a ward's lead (admin only)
//   POST  /api/assignments  { action: 'add_person', name, username, role, phone? }
//         → { id, username, tempPassword }   (shown once)
//   POST  /api/assignments  { action: 'reset_password', userId } → { tempPassword }
//   POST  /api/assignments  { action: 'set_active', userId, active }
//
// A changed assignment takes effect for that person the next time they sign in
// (or reload the page).
import { actorFrom, type Actor } from '../lib/db.ts'
import { hashPassword, json, tempPassword } from '../lib/session.ts'

type Sql = Exclude<Awaited<ReturnType<typeof actorFrom>>, Response>['sql']
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '')

export default async (req: Request) => {
  const ctx = await actorFrom(req)
  if (ctx instanceof Response) return ctx
  const { sql, actor } = ctx
  if (actor.role === 'booth_lead') return json({ error: 'not_allowed' }, 403)
  try {
    if (req.method === 'GET') return await list(sql, actor)
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    if (req.method === 'PUT') return await assign(sql, actor, body)
    if (req.method === 'POST') return await people(sql, actor, body)
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, PUT, POST' })
  } catch (e) {
    console.error('assignments error', e)
    return json({ error: 'server_error' }, 500)
  }
}

/** Ward / mandal ids a unit lead covers. */
async function myUnits(sql: Sql, a: Actor): Promise<string[]> {
  const rows = await sql<{ unit_id: string }[]>`select unit_id from assignments where user_id = ${a.id} and unit_id is not null`
  return rows.map((r) => r.unit_id)
}

/** People a unit lead may manage: booth leads with booths in their area, or with none yet. */
async function manageable(sql: Sql, a: Actor, units: string[]) {
  if (a.role === 'admin') return null // everyone
  const rows = await sql<{ id: number }[]>`
    select u.id::int from app_users u
    where u.role = 'booth_lead' and (
      exists (select 1 from assignments x join booths b on b.id = x.booth_id where x.user_id = u.id and b.unit_id = any(${units}))
      or not exists (select 1 from assignments x where x.user_id = u.id))`
  return new Set(rows.map((r) => r.id))
}

async function list(sql: Sql, a: Actor) {
  const units = a.role === 'admin' ? [] : await myUnits(sql, a)
  const allowed = await manageable(sql, a, units)
  const people = await sql<{ id: number; username: string; name: string; role: string; phone: string | null; active: boolean }[]>`
    select id::int, username, name, role, phone, active from app_users
    ${allowed ? sql`where id = any(${[...allowed, a.id]})` : sql``}
    order by role, name`
  const assignments = await sql`
    select a.user_id::int, a.unit_id, a.booth_id, b.ps_no, b.ac, coalesce(b.unit_id, a.unit_id) as in_unit
    from assignments a left join booths b on b.id = a.booth_id
    ${a.role === 'admin' ? sql`` : sql`where (b.unit_id = any(${units}) or a.unit_id = any(${units}))`}`
  return json({ people, assignments })
}

async function assign(sql: Sql, a: Actor, body: Record<string, unknown>) {
  const boothId = clean(body.boothId, 20)
  const unitId = clean(body.unitId, 60)
  const userId = body.userId === null ? null : Number(body.userId)
  if ((!boothId && !unitId) || (userId !== null && !Number.isInteger(userId))) return json({ error: 'bad_request' }, 400)

  if (unitId) {
    if (a.role !== 'admin') return json({ error: 'not_allowed' }, 403)
    if (userId !== null) {
      const [u] = await sql`select 1 from app_users where id = ${userId} and role = 'unit_lead' and active`
      if (!u) return json({ error: 'bad_assignee' }, 400)
    }
    await sql.begin(async (tx) => {
      await tx`delete from assignments where unit_id = ${unitId}`
      if (userId !== null) await tx`insert into assignments (user_id, unit_id) values (${userId}, ${unitId})`
    })
    return json({ ok: true })
  }

  const [booth] = await sql<{ unit_id: string | null }[]>`select unit_id from booths where id = ${boothId}`
  if (!booth) return json({ error: 'not_found' }, 404)
  const units = a.role === 'admin' ? [] : await myUnits(sql, a)
  if (a.role !== 'admin' && (!booth.unit_id || !units.includes(booth.unit_id))) return json({ error: 'not_your_area' }, 403)
  if (userId !== null) {
    const [u] = await sql`select 1 from app_users where id = ${userId} and role = 'booth_lead' and active`
    if (!u) return json({ error: 'bad_assignee' }, 400)
    const allowed = await manageable(sql, a, units)
    if (allowed && !allowed.has(userId)) return json({ error: 'not_your_area' }, 403)
  }
  await sql.begin(async (tx) => {
    // One booth lead per booth: replace whoever had it.
    await tx`delete from assignments where booth_id = ${boothId}
             and user_id in (select id from app_users where role = 'booth_lead')`
    if (userId !== null) await tx`insert into assignments (user_id, booth_id) values (${userId}, ${boothId})`
  })
  return json({ ok: true })
}

async function people(sql: Sql, a: Actor, body: Record<string, unknown>) {
  const action = body.action
  const units = a.role === 'admin' ? [] : await myUnits(sql, a)

  if (action === 'add_person') {
    const name = clean(body.name, 80)
    const username = clean(body.username, 40).toLowerCase()
    const role = clean(body.role, 20)
    const phone = clean(body.phone, 10) || null
    if (name.length < 2 || !/^[a-z0-9._-]{3,40}$/.test(username)) return json({ error: 'bad_person' }, 400)
    if (!['admin', 'unit_lead', 'booth_lead'].includes(role)) return json({ error: 'bad_role' }, 400)
    if (a.role !== 'admin' && role !== 'booth_lead') return json({ error: 'not_allowed' }, 403)
    if (phone && !/^[6-9]\d{9}$/.test(phone)) return json({ error: 'bad_mobile' }, 400)
    const pw = tempPassword()
    try {
      const [u] = await sql<{ id: number }[]>`
        insert into app_users (username, name, role, password_hash, phone)
        values (${username}, ${name}, ${role}, ${await hashPassword(pw)}, ${phone}) returning id::int`
      return json({ ok: true, id: u.id, username, tempPassword: pw }, 201)
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return json({ error: 'username_taken' }, 409)
      throw e
    }
  }

  const userId = Number(body.userId)
  if (!Number.isInteger(userId) || userId === a.id) return json({ error: 'bad_request' }, 400)
  const allowed = await manageable(sql, a, units)
  if (allowed && !allowed.has(userId)) return json({ error: 'not_your_area' }, 403)

  if (action === 'reset_password') {
    const pw = tempPassword()
    await sql`update app_users set password_hash = ${await hashPassword(pw)} where id = ${userId}`
    return json({ ok: true, tempPassword: pw })
  }
  if (action === 'set_active') {
    await sql`update app_users set active = ${body.active === true} where id = ${userId}`
    return json({ ok: true })
  }
  return json({ error: 'bad_request' }, 400)
}

export const config = { path: '/api/assignments' }
