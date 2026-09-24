import { publicRoute, clientMeta } from '@/lib/api'
import { clearSession } from '@/lib/auth'
import { audit } from '@/lib/audit'

export const POST = publicRoute(async ({ req, user }) => {
  if (user) await audit(user, 'auth.logout', 'user', user.id, { label: user.name }, clientMeta(req, user))
  await clearSession()
  return { ok: true, redirect: user?.client === 'app' ? '/m/login' : '/login' }
})
