import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { callbackUri, googleClient, OAUTH_COOKIE } from '@/lib/google-auth'

/**
 * GET /api/v1/auth/google?intent=login|register&client=web|app
 * Starts Google sign-in. The callback finishes it (session for known staff, sign-up form for new ones).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const intent = p.get('intent') === 'register' ? 'register' : p.get('intent') === 'patient' ? 'patient' : 'login'
  const client = p.get('client') === 'app' ? 'app' : 'web'
  const back = intent === 'patient' ? '/my/login' : intent === 'register' ? '/join' : client === 'app' ? '/m/login' : '/login'
  await db()
  const g = await googleClient()
  if (!g) return NextResponse.redirect(new URL(`${back}?error=${encodeURIComponent('Google sign-in is not set up yet. Ask the administrator.')}`, req.url))

  const state = randomBytes(24).toString('base64url')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: g.id, redirect_uri: callbackUri(req), response_type: 'code', scope: 'openid email profile', prompt: 'select_account', state }).toString()
  const res = NextResponse.redirect(url)
  res.cookies.set(OAUTH_COOKIE, `${state}.${intent}.${client}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 })
  return res
}
