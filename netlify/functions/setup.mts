// POST /api/setup  { key, replace? }  — one-time database setup from the browser.
//
// Creates the tables (migrations are safe to re-run) and loads the synthetic demo
// team + help requests, so nobody has to paste SQL into Supabase by hand.
//
// Disabled unless the SETUP_KEY environment variable is set (12+ characters).
// Remove SETUP_KEY in Netlify after setup to switch this off again.
// Runs only the fixed SQL bundled with the site — never SQL from the request.
import { db } from '../lib/db.ts'
import { env, json } from '../lib/session.ts'
import { MIGRATIONS, SEED } from '../lib/setup-sql.generated.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const enc = new TextEncoder()

/** Constant-time string comparison. */
function same(a: string, b: string) {
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' })
  const setupKey = env('SETUP_KEY') ?? ''
  if (setupKey.length < 12) return json({ error: 'setup_disabled' }, 403)
  const sql = db()
  if (!sql) return json({ error: 'database_not_configured' }, 503)

  let key = ''
  let replace = false
  try {
    const body = await req.json()
    key = String(body.key ?? '')
    replace = body.replace === true
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (!same(key, setupKey)) {
    await sleep(800)
    return json({ error: 'wrong_key' }, 401)
  }

  try {
    for (const m of MIGRATIONS) await sql.unsafe(m.sql)
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from app_users`
    if (n > 0 && !replace) return json({ error: 'already_has_data', users: n }, 409)
    await sql.unsafe(SEED)
    const [counts] = await sql<{ users: number; booths: number; requests: number; covered: number }[]>`
      select (select count(*)::int from app_users) as users,
             (select count(*)::int from booths) as booths,
             (select count(*)::int from help_requests) as requests,
             (select count(distinct booth_id)::int from assignments where booth_id is not null) as covered`
    return json({ ok: true, migrations: MIGRATIONS.map((m) => m.name), ...counts })
  } catch (e) {
    console.error('setup failed', e)
    return json({ error: 'setup_failed', detail: String((e as Error).message ?? e).slice(0, 300) }, 500)
  }
}

export const config = { path: '/api/setup' }
