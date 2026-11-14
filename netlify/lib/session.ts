// Shared by the Netlify edge guard (Deno) and the login/logout/me functions (Node).
// Uses only Web-standard APIs (crypto.subtle, TextEncoder, atob/btoa) so it runs in both.
//
// Configuration (Netlify → Site configuration → Environment variables):
//   SESSION_SECRET  long random string used to sign session cookies
//   DATABASE_URL    (optional) Supabase Postgres connection string — users, roles and
//                   team data then come from the database (see supabase/README.md)
//   AUTH_USERS      fallback when there is no database: JSON array
//                   [{"username":"admin","name":"Admin","hash":"pbkdf2-sha256$…"}]
//                   Create entries with:  npm run add-user -- <username> "<Display name>"

export const COOKIE = 'kd_session'
export const SESSION_HOURS = 12

export interface User {
  username: string
  name: string
  hash: string
}

export interface Session {
  username: string
  name: string
  exp: number // unix seconds
  /** app_users.id when the user comes from the database (team features). */
  uid?: number
  role?: string
}

declare const Netlify: { env: { get(name: string): string | undefined } } | undefined
declare const Deno: { env: { get(name: string): string | undefined } } | undefined

export function env(name: string): string | undefined {
  try {
    if (typeof Netlify !== 'undefined') {
      const v = Netlify.env.get(name)
      if (v !== undefined) return v
    }
  } catch {
    /* not on Netlify */
  }
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
  if (proc) return proc.env[name]
  try {
    return typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined
  } catch {
    return undefined
  }
}

const enc = new TextEncoder()

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Constant-time comparison of two byte arrays. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

/** Returns "payload.signature" for a session. */
export async function signSession(s: Session, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(s)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload))
  return `${payload}.${b64url(sig)}`
}

/** Verifies a signed session token; returns the session if valid and not expired. */
export async function verifySession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(payload))
    if (!ok) return null
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session
    if (typeof s.exp !== 'number' || s.exp < Date.now() / 1000) return null
    return s
  } catch {
    return null
  }
}

export function readCookie(req: Request, name = COOKIE): string | undefined {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

/** Users from AUTH_USERS; empty if unset or malformed. */
export function users(): User[] {
  try {
    const list = JSON.parse(env('AUTH_USERS') ?? '[]')
    return Array.isArray(list)
      ? list.filter((u) => typeof u?.username === 'string' && typeof u?.hash === 'string')
      : []
  } catch {
    return []
  }
}

/** New PBKDF2-SHA256 hash in the stored format (same as scripts/add-user.mjs). */
export async function hashPassword(password: string, iterations = 210000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return ['pbkdf2-sha256', iterations, b64url(salt), b64url(bits)].join('$')
}

/** A readable temporary password, e.g. "Kq7m-Xt3p-9Wza". */
export function tempPassword(): string {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint8Array(12))
  const s = Array.from(r, (b) => c[b % c.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

/** Hash format: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url> */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split('$')
  if (algo !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const expected = fromB64url(hash)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations: Number(iter) },
    key,
    expected.length * 8,
  )
  return equal(new Uint8Array(bits), expected)
}

/** Current session from the request cookie, or null. */
export async function sessionFrom(req: Request): Promise<Session | null> {
  const secret = env('SESSION_SECRET')
  if (!secret) return null
  return verifySession(readCookie(req), secret)
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
