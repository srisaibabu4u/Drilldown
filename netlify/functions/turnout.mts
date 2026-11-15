// /api/turnout — poll day: votes polled so far at each station, by time slot.
//
//   GET                                   → { rows: [{ booth_id, slot, votes, reported_at, by }] } in the caller's area
//   POST { boothId, slot, votes }         → record / correct one report (booth lead: own stations;
//                                           ward / mandal lead: their area; admin: anywhere)
//   POST { action: 'simulate', rows }     → admin only: load a simulated poll day (demo)
//   POST { action: 'reset' }              → admin only: clear all reports
//
// Counts only. Nothing about individual voters or how anyone voted.
import { actorFrom, boothInScope, canSeeBooth } from '../lib/db.ts'
import { json } from '../lib/session.ts'
import { MIGRATIONS } from '../lib/setup-sql.generated.ts'

const SLOTS = [9, 11, 13, 15, 17, 19]
type Sql = Exclude<Awaited<ReturnType<typeof actorFrom>>, Response>['sql']

// Create the table on first use, so an existing database needs no new setup run.
let ready: Promise<unknown> | null = null
function ensureTable(sql: Sql) {
  if (!ready) {
    const m = MIGRATIONS.find((x) => x.name.startsWith('002_'))
    ready = (m ? sql.unsafe(m.sql) : Promise.resolve()).catch((e) => {
      ready = null
      throw e
    })
  }
  return ready
}

export default async (req: Request) => {
  const ctx = await actorFrom(req)
  if (ctx instanceof Response) return ctx
  const { sql, actor } = ctx
  try {
    await ensureTable(sql)
    if (req.method === 'GET') {
      const rows = await sql`
        select t.booth_id, t.slot::int, t.votes::int, t.reported_at, u.name as by
        from turnout_reports t
        join booths b on b.id = t.booth_id
        left join app_users u on u.id = t.reported_by
        where ${boothInScope(sql, actor)}
        order by t.booth_id, t.slot`
      return json({ rows })
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' })

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'bad_request' }, 400)
    }

    if (body.action === 'reset') {
      if (actor.role !== 'admin') return json({ error: 'not_allowed' }, 403)
      await sql`delete from turnout_reports`
      return json({ ok: true })
    }

    if (body.action === 'simulate') {
      if (actor.role !== 'admin') return json({ error: 'not_allowed' }, 403)
      const raw = Array.isArray(body.rows) ? body.rows : []
      if (raw.length === 0 || raw.length > 10000) return json({ error: 'bad_request' }, 400)
      const known = new Set((await sql<{ id: string }[]>`select id from booths`).map((r) => r.id))
      const rows = raw.flatMap((r) => {
        const x = r as Record<string, unknown>
        const boothId = typeof x.boothId === 'string' ? x.boothId.slice(0, 20) : ''
        const slot = Number(x.slot)
        const votes = Number(x.votes)
        return known.has(boothId) && SLOTS.includes(slot) && Number.isInteger(votes) && votes >= 0 && votes <= 5000
          ? [{ booth_id: boothId, slot, votes, reported_by: actor.id }]
          : []
      })
      await sql.begin(async (tx) => {
        await tx`delete from turnout_reports`
        for (let i = 0; i < rows.length; i += 1000) {
          const chunk = rows.slice(i, i + 1000)
          await tx`insert into turnout_reports ${tx(chunk, 'booth_id', 'slot', 'votes', 'reported_by')}
                   on conflict (booth_id, slot) do nothing`
        }
      })
      return json({ ok: true, rows: rows.length })
    }

    // One report.
    const boothId = typeof body.boothId === 'string' ? body.boothId.slice(0, 20) : ''
    const slot = Number(body.slot)
    const votes = Number(body.votes)
    if (!boothId || !SLOTS.includes(slot)) return json({ error: 'bad_request' }, 400)
    if (!Number.isInteger(votes) || votes < 0 || votes > 5000) return json({ error: 'bad_votes' }, 400)
    if (!(await canSeeBooth(sql, actor, boothId))) return json({ error: 'not_your_area' }, 403)

    // Votes polled only go up through the day.
    const [around] = await sql<{ before: number | null; after: number | null }[]>`
      select (select max(votes)::int from turnout_reports where booth_id = ${boothId} and slot < ${slot}) as before,
             (select min(votes)::int from turnout_reports where booth_id = ${boothId} and slot > ${slot}) as after`
    if (around.before !== null && votes < around.before) return json({ error: 'less_than_earlier', limit: around.before }, 400)
    if (around.after !== null && votes > around.after) return json({ error: 'more_than_later', limit: around.after }, 400)

    await sql`
      insert into turnout_reports (booth_id, slot, votes, reported_by)
      values (${boothId}, ${slot}, ${votes}, ${actor.id})
      on conflict (booth_id, slot) do update
        set votes = excluded.votes, reported_by = excluded.reported_by, reported_at = now()`
    return json({ ok: true })
  } catch (e) {
    console.error('turnout error', e)
    return json({ error: 'server_error' }, 500)
  }
}

export const config = { path: '/api/turnout' }
