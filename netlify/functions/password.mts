// POST /api/password  { current, next }  — change your own password (any role).
// The current password is checked first; a wrong one is answered slowly.
import { actorFrom } from '../lib/db.ts'
import { hashPassword, json, passwordProblem, verifyPassword } from '../lib/session.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' })
  const ctx = await actorFrom(req)
  if (ctx instanceof Response) return ctx
  const { sql, actor } = ctx
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  try {
    const [u] = await sql<{ password_hash: string }[]>`select password_hash from app_users where id = ${actor.id}`
    if (!u || typeof body.current !== 'string' || !(await verifyPassword(body.current, u.password_hash))) {
      await sleep(800)
      return json({ error: 'wrong_password' }, 400)
    }
    const problem = passwordProblem(body.next, actor.username)
    if (problem) return json({ error: problem }, 400)
    if (body.next === body.current) return json({ error: 'same_password' }, 400)
    await sql`update app_users set password_hash = ${await hashPassword(body.next as string)} where id = ${actor.id}`
    return json({ ok: true })
  } catch (e) {
    console.error('password error', e)
    return json({ error: 'server_error' }, 500)
  }
}

export const config = { path: '/api/password' }
