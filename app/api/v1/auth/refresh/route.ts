import { route, clientMeta } from '@/lib/api'
import { createSession, revokeSession, setSessionCookie } from '@/lib/auth'
import { Device } from '@/lib/models'
import { audit } from '@/lib/audit'

/**
 * POST — swap the current token for a new one (native app, before the old one expires). The new session keeps the
 * same client, the phone registered on the old session moves to the new one, and the old token stops working.
 */
export const POST = route(async ({ req, user }) => {
  const { token, expiresAt, jti } = await createSession(user.id, user.role, user.client, true)
  await Device.updateMany({ jti: user.jti }, { jti })
  await revokeSession(user.jti)
  const native = req.headers.get('x-hc-native') === '1'
  if (!native) await setSessionCookie(token, expiresAt)
  await audit(user, 'auth.refresh', 'user', user.id, { label: user.name }, clientMeta(req, user))
  // like /auth/login: only the native app receives the bearer token; browsers keep it in the httpOnly cookie
  return { ok: true, ...(native ? { token } : {}), expiresAt: expiresAt.toISOString() }
})
