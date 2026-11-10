// Database access for the Netlify functions (Node only — never imported by the
// edge guard). Supabase: use the "Transaction pooler" connection string as
// DATABASE_URL. Without DATABASE_URL the site still works, minus team features.
import postgres from 'postgres'
import { env, json, sessionFrom, type Session } from './session.ts'

let client: postgres.Sql | null = null

export function db(): postgres.Sql | null {
  const url = env('DATABASE_URL')
  if (!url) return null
  if (!client) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
    client = postgres(url, {
      prepare: false, // required by Supabase's transaction pooler
      max: 1, // one connection per function instance
      idle_timeout: 10,
      connect_timeout: 10,
      ssl: local ? false : 'require',
    })
  }
  return client
}

/**
 * Turns a database failure into a clear 503: "not set up yet" when the tables
 * don't exist (run /setup.html), otherwise "unreachable" (check DATABASE_URL).
 */
export function dbErrorResponse(e: unknown): Response {
  const code = (e as { code?: string }).code
  console.error('database error', code, (e as Error).message)
  return json({ error: code === '42P01' ? 'database_not_ready' : 'database_unreachable' }, 503)
}

export type Role = 'admin' | 'unit_lead' | 'booth_lead'

export interface Actor {
  id: number
  username: string
  name: string
  role: Role
}

/**
 * The signed-in user, re-read from the database on every request, so a removed or
 * demoted user loses access at once (not when their cookie expires).
 */
export async function actorFrom(req: Request): Promise<{ sql: postgres.Sql; actor: Actor } | Response> {
  const sql = db()
  if (!sql) return json({ error: 'database_not_configured' }, 503)
  const s: Session | null = await sessionFrom(req)
  if (!s?.uid) return json({ error: 'unauthenticated' }, 401)
  try {
    const [u] = await sql<Actor[]>`select id::int, username, name, role from app_users where id = ${s.uid} and active`
    if (!u) return json({ error: 'unauthenticated' }, 401)
    return { sql, actor: u }
  } catch (e) {
    return dbErrorResponse(e)
  }
}

/**
 * SQL condition: booth `b` is inside the actor's area.
 * admin → everything; unit lead → booths in their wards / mandals;
 * booth lead → their own booths.
 */
export function boothInScope(sql: postgres.Sql, a: Actor) {
  if (a.role === 'admin') return sql`true`
  if (a.role === 'unit_lead')
    return sql`b.unit_id in (select unit_id from assignments where user_id = ${a.id} and unit_id is not null)`
  return sql`b.id in (select booth_id from assignments where user_id = ${a.id} and booth_id is not null)`
}

export async function canSeeBooth(sql: postgres.Sql, a: Actor, boothId: string): Promise<boolean> {
  const [r] = await sql`select 1 from booths b where b.id = ${boothId} and ${boothInScope(sql, a)}`
  return !!r
}
