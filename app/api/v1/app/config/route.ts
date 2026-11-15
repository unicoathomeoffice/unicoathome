import { route, qp } from '@/lib/api'
import { appConfig } from '@/lib/services/app'

/** GET ?build=N — what the native app shows this person (modules, tabs, permissions, constants, update state). */
export const GET = route(async ({ req, user }) => {
  const b = Number(qp(req).get('build'))
  return appConfig(user, Number.isFinite(b) && b > 0 ? b : undefined)
})
