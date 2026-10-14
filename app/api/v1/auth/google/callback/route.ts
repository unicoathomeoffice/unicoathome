import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { User } from '@/lib/models'
import { COOKIE, createSession } from '@/lib/auth'
import { googleProfile, OAUTH_COOKIE, signSignup, SIGNUP_COOKIE } from '@/lib/google-auth'
import { audit } from '@/lib/audit'
import { clientMeta } from '@/lib/api'

const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' }

/** Google sends the browser back here. Known staff get a session; new people continue to the sign-up form. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const [state = '', intent = 'login', client = 'web'] = (req.cookies.get(OAUTH_COOKIE)?.value ?? '').split('.')
  const loginPage = intent === 'register' ? '/join' : client === 'app' ? '/m/login' : '/login'
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url))
    res.cookies.delete(OAUTH_COOKIE)
    return res
  }
  const fail = (msg: string) => go(`${loginPage}?error=${encodeURIComponent(msg)}`)

  if (p.get('error')) return fail(p.get('error') === 'access_denied' ? 'Google sign-in was cancelled' : `Google returned ${p.get('error')}`)
  const got = p.get('state') ?? ''
  if (!state || got.length !== state.length || !timingSafeEqual(Buffer.from(got), Buffer.from(state))) return fail('Sign-in link expired. Please try again.')

  try {
    await db()
    const g = await googleProfile(p.get('code') ?? '', req)
    const user = await User.findOne({ email: g.email, deletedAt: null })
    const meta = { ...clientMeta(req), client }

    if (!user) {
      if (intent !== 'register') return fail(`No staff account uses ${g.email}. New to the team? Register at /join`)
      const res = go('/join/details')
      res.cookies.set(SIGNUP_COOKIE, await signSignup(g), { ...cookieOpts, maxAge: 1800 })
      return res
    }
    if (user.status === 'PENDING') return go('/join?status=pending')
    if (user.status !== 'ACTIVE') return fail('Your account is suspended. Contact the Home Care coordinator.')

    // use the platform the person started from, or the one their account has
    const access: string[] = user.platformAccess ?? []
    const use = (access.includes(client) ? client : access[0]) as 'web' | 'app' | undefined
    if (!use) return fail('Your account has no web or app access yet. Ask the administrator.')
    const { token, expiresAt } = await createSession(String(user._id), user.role, use, true)
    user.lastLoginAt = new Date()
    await user.save()
    await audit({ id: String(user._id), name: user.name, role: user.role }, 'auth.login', 'user', user._id, { after: { via: 'google' }, label: user.name }, { ...meta, client: use })
    const res = go(use === 'app' ? '/m' : '/dashboard')
    res.cookies.set(COOKIE, token, { ...cookieOpts, expires: expiresAt })
    return res
  } catch (e: any) {
    console.error('[google-auth]', e)
    return fail(/redirect_uri_mismatch/i.test(String(e?.message)) ? 'Google sign-in is not fully set up (redirect URI). Ask the administrator.' : e?.message || 'Google sign-in failed')
  }
}
