// /api/requests — citizen help requests ("needs help applying for a scheme").
//
//   GET   ?status=<status|open|overdue>&scheme=&booth=&voter=<boothId>:<serial>&q=&sort=<recent|oldest>&limit=&offset=
//         Each row has status_since (when it entered its current status) and overdue
//         (past the SLA for that status, see lib/sla.ts).
//         → requests in the caller's area + counts by status
//   POST  { boothId, voterSerial, voterRef, voterName, scheme, need, mobile?, consent }
//   PATCH { id, status?, note?, assignedTo? }   — ward / mandal leads and admins only
//
// Every query is limited to the caller's area (see boothInScope). No amounts.
// Booth leads record requests; once saved, only higher roles can change them.
import { actorFrom, boothInScope, canSeeBooth, type Actor } from '../lib/db.ts'
import { json } from '../lib/session.ts'
import { SLA_DAYS } from '../lib/sla.ts'

const STATUSES = ['new', 'documents_pending', 'applied', 'resolved', 'not_eligible', 'closed'] as const
type Status = (typeof STATUSES)[number]
const isStatus = (s: unknown): s is Status => typeof s === 'string' && (STATUSES as readonly string[]).includes(s)
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '')

export default async (req: Request) => {
  const ctx = await actorFrom(req)
  if (ctx instanceof Response) return ctx
  const { sql, actor } = ctx
  try {
    if (req.method === 'GET') return await list(req, sql, actor)
    if (req.method === 'POST') return await create(req, sql, actor)
    if (req.method === 'PATCH') return await update(req, sql, actor)
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST, PATCH' })
  } catch (e) {
    console.error('requests error', e)
    return json({ error: 'server_error' }, 500)
  }
}

type Sql = Parameters<typeof boothInScope>[0]

async function list(req: Request, sql: Sql, a: Actor) {
  const u = new URL(req.url)
  const status = u.searchParams.get('status')
  const scheme = u.searchParams.get('scheme')
  const booth = u.searchParams.get('booth')
  const voter = u.searchParams.get('voter') // "46-172:381"
  const text = clean(u.searchParams.get('q'), 60)
  const sort = u.searchParams.get('sort')
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? 50) || 50))
  const offset = Math.max(0, Number(u.searchParams.get('offset') ?? 0) || 0)
  const [vBooth, vSerial] = voter?.split(':') ?? []

  // Requests with the time they entered their current status.
  const withSince = sql`(
    select h.*, coalesce((select max(e.at) from request_events e where e.request_id = h.id and e.to_status = h.status), h.created_at) as status_since
    from help_requests h)`
  const overdue = sql`(r.status in ('new', 'documents_pending', 'applied') and now() - r.status_since > make_interval(days =>
    case r.status when 'new' then ${SLA_DAYS.new}::int when 'documents_pending' then ${SLA_DAYS.documents_pending}::int else ${SLA_DAYS.applied}::int end))`

  const common = sql`
    ${boothInScope(sql, a)}
    ${scheme ? sql`and r.scheme_code = ${scheme}` : sql``}
    ${booth ? sql`and r.booth_id = ${booth}` : sql``}
    ${vBooth && vSerial ? sql`and r.booth_id = ${vBooth} and r.voter_serial = ${Number(vSerial)}` : sql``}`
  const where = sql`
    ${common}
    ${isStatus(status) ? sql`and r.status = ${status}` : status === 'open' ? sql`and r.status in ('new', 'documents_pending', 'applied')` : status === 'overdue' ? sql`and ${overdue}` : sql``}
    ${text ? sql`and (r.voter_name ilike ${'%' + text + '%'} or r.voter_ref ilike ${'%' + text + '%'} or r.need ilike ${'%' + text + '%'})` : sql``}`

  const rows = await sql`
    select r.id::int, r.booth_id, b.ac, b.ps_no, b.unit_name, b.name as booth_name,
           r.voter_serial, r.voter_ref, r.voter_name, r.scheme_code, s.name as scheme_name,
           r.need, r.contact_mobile, r.status, r.created_at, r.updated_at, r.status_since,
           ${overdue} as overdue,
           cu.name as created_by, au.name as assigned_to, r.assigned_to as assigned_to_id
    from ${withSince} r
    join booths b on b.id = r.booth_id
    join schemes s on s.code = r.scheme_code
    join app_users cu on cu.id = r.created_by
    left join app_users au on au.id = r.assigned_to
    where ${where}
    order by ${sort === 'oldest' ? sql`r.status_since asc` : sql`r.updated_at desc`}, r.id desc
    limit ${limit} offset ${offset}`
  // Counts by status (and overdue) for the same filters, minus the status filter itself.
  const counts = await sql<{ status: Status; n: number }[]>`
    select r.status, count(*)::int as n
    from help_requests r join booths b on b.id = r.booth_id
    where ${common}
    group by r.status`
  const [{ n: overdueCount }] = await sql<{ n: number }[]>`
    select count(*)::int as n from ${withSince} r join booths b on b.id = r.booth_id where ${common} and ${overdue}`
  const [{ total }] = await sql<{ total: number }[]>`
    select count(*)::int as total from ${withSince} r join booths b on b.id = r.booth_id where ${where}`
  const schemes = await sql`select code, name from schemes where active order by sort`
  return json({
    rows,
    total,
    counts: { ...Object.fromEntries(counts.map((c) => [c.status, c.n])), overdue: overdueCount },
    schemes,
    sla: SLA_DAYS,
  })
}

async function create(req: Request, sql: Sql, a: Actor) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const boothId = clean(body.boothId, 20)
  const serial = Number(body.voterSerial)
  const voterRef = clean(body.voterRef, 30)
  const voterName = clean(body.voterName, 120)
  const scheme = clean(body.scheme, 40)
  const need = clean(body.need, 500)
  const mobile = clean(body.mobile, 10) || null
  if (body.consent !== true) return json({ error: 'consent_required' }, 400)
  if (!boothId || !Number.isInteger(serial) || serial < 1 || !voterRef || !voterName || !scheme || need.length < 3)
    return json({ error: 'missing_fields' }, 400)
  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) return json({ error: 'bad_mobile' }, 400)
  if (!(await canSeeBooth(sql, a, boothId))) return json({ error: 'not_your_area' }, 403)
  const [s] = await sql`select 1 from schemes where code = ${scheme} and active`
  if (!s) return json({ error: 'unknown_scheme' }, 400)

  try {
    const id = await sql.begin(async (tx) => {
      const [r] = await tx<{ id: number }[]>`
        insert into help_requests (booth_id, voter_serial, voter_ref, voter_name, scheme_code, need, contact_mobile, consent, created_by, assigned_to)
        values (${boothId}, ${serial}, ${voterRef}, ${voterName}, ${scheme}, ${need}, ${mobile}, true, ${a.id}, ${a.id})
        returning id::int`
      await tx`insert into request_events (request_id, user_id, action, to_status) values (${r.id}, ${a.id}, 'created', 'new')`
      return r.id
    })
    return json({ ok: true, id }, 201)
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return json({ error: 'already_open' }, 409)
    throw e
  }
}

async function update(req: Request, sql: Sql, a: Actor) {
  // Saved requests are read-only for booth leads; their ward / mandal lead or an admin updates them.
  if (a.role === 'booth_lead') return json({ error: 'read_only_for_role' }, 403)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const id = Number(body.id)
  const status = body.status
  const note = clean(body.note, 1000) || null
  const assignedTo = body.assignedTo === undefined ? undefined : Number(body.assignedTo)
  if (!Number.isInteger(id)) return json({ error: 'bad_request' }, 400)
  if (status !== undefined && !isStatus(status)) return json({ error: 'bad_status' }, 400)

  const [r] = await sql<{ id: number; booth_id: string; status: Status; unit_id: string | null }[]>`
    select r.id::int, r.booth_id, r.status, b.unit_id
    from help_requests r join booths b on b.id = r.booth_id
    where r.id = ${id} and ${boothInScope(sql, a)}`
  if (!r) return json({ error: 'not_found' }, 404) // also when outside the caller's area

  if (assignedTo !== undefined) {
    // Assignee must lead this booth or its ward / mandal.
    const [ok] = await sql`
      select 1 from assignments where user_id = ${assignedTo} and (booth_id = ${r.booth_id} or unit_id = ${r.unit_id})`
    if (!ok) return json({ error: 'bad_assignee' }, 400)
  }

  await sql.begin(async (tx) => {
    if (status !== undefined && status !== r.status) {
      await tx`update help_requests set status = ${status}, updated_at = now() where id = ${id}`
      await tx`insert into request_events (request_id, user_id, action, from_status, to_status, note)
               values (${id}, ${a.id}, 'status', ${r.status}, ${status}, ${note})`
    } else if (note) {
      await tx`update help_requests set updated_at = now() where id = ${id}`
      await tx`insert into request_events (request_id, user_id, action, note) values (${id}, ${a.id}, 'note', ${note})`
    }
    if (assignedTo !== undefined) {
      await tx`update help_requests set assigned_to = ${assignedTo}, updated_at = now() where id = ${id}`
      await tx`insert into request_events (request_id, user_id, action, note)
               values (${id}, ${a.id}, 'assigned', (select 'Assigned to ' || name from app_users where id = ${assignedTo}))`
    }
  })
  return json({ ok: true })
}

export const config = { path: '/api/requests' }
