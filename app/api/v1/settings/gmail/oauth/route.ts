import { randomBytes, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { canOpenSettings } from '@/lib/constants'
import { IntegrationSecret } from '@/lib/models'
import { getGmailConfig, saveGmailConfig } from '@/lib/gmail'
import { decryptIntegration, encryptIntegration } from '@/lib/integration-secrets'
import { audit } from '@/lib/audit'

// "Connect with Google": POST starts the OAuth consent (returns Google's URL), Google sends the browser back
// here with GET ?code&state, and we swap the code for a refresh token and save it encrypted. The callback URL
// below must be listed under "Authorized redirect URIs" of the OAuth client.
const PENDING = 'gmail-oauth-pending'
const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.send'
type Pending = { clientId: string; clientSecret: string; state: string; at: number }

const callbackUrl = (req: Request) => `${new URL(req.url).origin}/api/v1/settings/gmail/oauth`

const Start = z.object({ clientId: z.string().trim().min(10).max(500), clientSecret: z.string().trim().max(2000).optional() })

export const POST = route(async ({ req, user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(req.url).origin) throw forbidden()
  const input = await body(req, Start)
  const saved = await getGmailConfig()
  const clientSecret = input.clientSecret || (saved.oauth2.clientId === input.clientId ? saved.oauth2.clientSecret : '')
  if (!clientSecret) throw bad('Enter the OAuth client secret first')
  const state = randomBytes(24).toString('base64url')
  const pending: Pending = { clientId: input.clientId, clientSecret, state, at: Date.now() }
  await IntegrationSecret.updateOne({ _id: PENDING }, { encrypted: encryptIntegration(pending), updatedBy: user.id }, { upsert: true })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: callbackUrl(req),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // gives a refresh token
    prompt: 'consent', // …every time, even if the account approved before
    state,
  }).toString()
  return { url: url.toString(), redirectUri: callbackUrl(req) }
})

/** Google redirects the browser here after consent. Always answers with a redirect back to Settings. */
export const GET = route(async ({ req, user }) => {
  const back = (result: string) => NextResponse.redirect(new URL(`/settings?gmail=${encodeURIComponent(result)}`, req.url))
  if (!canOpenSettings(user)) return back('error:You do not have permission to change Gmail settings')
  const p = new URL(req.url).searchParams
  if (p.get('error')) return back(`error:${p.get('error') === 'access_denied' ? 'Google access was not approved' : `Google returned ${p.get('error')}`}`)

  const row = await IntegrationSecret.findById(PENDING).select('+encrypted').lean<any>()
  const pending = row ? decryptIntegration<Pending>(row.encrypted) : null
  const state = p.get('state') ?? ''
  const sameState = !!pending && state.length === pending.state.length && timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))
  if (!pending || !sameState || Date.now() - pending.at > 15 * 60_000) return back('error:This sign-in link expired. Click Connect with Google again.')
  await IntegrationSecret.deleteOne({ _id: PENDING })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ code: p.get('code') ?? '', client_id: pending.clientId, client_secret: pending.clientSecret, redirect_uri: callbackUrl(req), grant_type: 'authorization_code' }),
  })
  const token = await res.json().catch(() => ({}))
  if (!res.ok) return back(`error:Google refused the connection (${token.error_description || token.error || res.status}). Check the client ID, secret and redirect URI.`)
  if (!token.refresh_token) return back('error:Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.')
  if (!String(token.scope ?? '').includes('gmail.send')) return back('error:Tick the "Send email on your behalf" box on Google’s consent screen and connect again.')

  // the id_token comes straight from Google over TLS, so its payload can be read without re-verifying
  const email = (() => {
    try {
      return String(JSON.parse(Buffer.from(String(token.id_token).split('.')[1], 'base64url').toString('utf8')).email ?? '')
    } catch {
      return ''
    }
  })()
  const config = structuredClone(await getGmailConfig())
  config.mode = 'oauth2'
  config.oauth2 = { user: email || config.oauth2.user, clientId: pending.clientId, clientSecret: pending.clientSecret, refreshToken: token.refresh_token }
  await saveGmailConfig(config, user.id)
  await audit(user, 'settings.gmail_configure', 'settings', 'gmail', { after: { mode: 'oauth2', account: config.oauth2.user, via: 'connect' }, label: 'Gmail configuration' }, clientMeta(req, user))
  return back(`connected:${config.oauth2.user}`)
})
