import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { getGmailConfig } from './gmail'

// "Sign in with Google" for staff + Google sign-up (/join). Uses GOOGLE_CLIENT_ID/SECRET when set, otherwise the
// OAuth client already saved for Gmail in Settings. That client must list `${origin}/api/v1/auth/google/callback`
// under Authorized redirect URIs. Scopes are basic profile only (openid email profile) — no Google verification needed.

export const OAUTH_COOKIE = 'hc_oauth'
export const SIGNUP_COOKIE = 'hc_signup'

export async function googleClient() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }
  const c = await getGmailConfig().catch(() => null)
  return c?.oauth2.clientId && c.oauth2.clientSecret ? { id: c.oauth2.clientId, secret: c.oauth2.clientSecret } : null
}

export const callbackUri = (req: Request) => `${new URL(req.url).origin}/api/v1/auth/google/callback`

export type GoogleProfile = { sub: string; email: string; name: string; picture?: string }

/** Swap the authorization code for the user's verified Google profile. */
export async function googleProfile(code: string, req: Request): Promise<GoogleProfile> {
  const client = await googleClient()
  if (!client) throw new Error('Google sign-in is not set up')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ code, client_id: client.id, client_secret: client.secret, redirect_uri: callbackUri(req), grant_type: 'authorization_code' }),
  })
  const token = await res.json().catch(() => ({}))
  if (!res.ok || !token.id_token) throw new Error(token.error_description || token.error || 'Google sign-in failed')
  // id_token arrives straight from Google's token endpoint over TLS, so the payload can be trusted without re-verifying
  const p = JSON.parse(Buffer.from(String(token.id_token).split('.')[1], 'base64url').toString('utf8'))
  if (!p.email || p.email_verified === false) throw new Error('Your Google account email is not verified')
  return { sub: String(p.sub), email: String(p.email).toLowerCase(), name: String(p.name ?? p.email.split('@')[0]), picture: p.picture }
}

const key = () => new TextEncoder().encode(process.env.JWT_SECRET ?? '')

/** Short-lived signed proof of the Google account between the Google round trip and the /join/details form. */
export const signSignup = (p: GoogleProfile) => new SignJWT({ ...p }).setProtectedHeader({ alg: 'HS256' }).setAudience('signup').setIssuedAt().setExpirationTime('30m').sign(key())

export async function readSignup(token?: string): Promise<GoogleProfile | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { audience: 'signup' })
    return { sub: String(payload.sub), email: String(payload.email), name: String(payload.name), picture: payload.picture as string | undefined }
  } catch {
    return null
  }
}
