// Runs before every request. Without a valid session cookie, nothing but the
// login page (and the login API) is served, so the app code and its data never
// reach a signed-out visitor.
import { sessionFrom } from '../lib/session.ts'

interface Context {
  next(): Promise<Response>
}

export default async (req: Request, context: Context) => {
  if (await sessionFrom(req)) return context.next()

  const url = new URL(req.url)
  const wantsPage = req.method === 'GET' && (req.headers.get('accept') ?? '').includes('text/html')
  if (wantsPage) return Response.redirect(new URL('/login.html', url), 302)
  return new Response('Sign in required', { status: 401, headers: { 'cache-control': 'no-store' } })
}

export const config = {
  path: '/*',
  // /setup.html + /api/setup: one-time database setup, protected by SETUP_KEY (off unless set)
  excludedPath: ['/login.html', '/favicon.svg', '/api/login', '/api/logout', '/api/me', '/setup.html', '/api/setup'],
}
