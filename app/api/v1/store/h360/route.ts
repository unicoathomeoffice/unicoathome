import { route, body, clientMeta } from '@/lib/api'
import { H360Error } from '@/lib/h360'
import { ActionInput, compareTrend, runCompare, storeAction } from '@/lib/services/store-sync'

export const maxDuration = 60 // reading H360's history of each difference can take a while

/** GET — compare the Family Medicine store with H360 now (saved as a snapshot + follow-up list). */
export const GET = route(
  async ({ user }) => {
    try {
      const [compare, trend] = await Promise.all([runCompare(user), compareTrend()])
      return { compare, trend }
    } catch (e) {
      if (e instanceof H360Error) return { error: e.message, code: e.code }
      throw e
    }
  },
  { perm: 'store.manage' },
)

/** POST { action: match | consumed | received | add | link | accept | assign | reopen | tolerance, … } */
export const POST = route(async ({ req, user }) => storeAction(await body(req, ActionInput), user, clientMeta(req, user)), { perm: 'store.manage' })
