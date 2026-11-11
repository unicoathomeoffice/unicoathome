import { route, body, clientMeta } from '@/lib/api'
import { ConsumptionInput, createConsumption, listConsumptions } from '@/lib/services/store-consumption'

/** GET ?month=YYYY-MM&reason= — consumption entered by hand in the store. */
export const GET = route(
  async ({ req }) => {
    const q = req.nextUrl.searchParams
    return { items: await listConsumptions({ month: q.get('month') ?? undefined, reason: q.get('reason') ?? undefined }) }
  },
  { perm: 'store.manage' },
)

/** POST { items: [{ itemId, qty }], reason, requestNo?, note?, at? } — take items out of the store by hand. */
export const POST = route(async ({ req, user }) => createConsumption(await body(req, ConsumptionInput), user, clientMeta(req, user)), { perm: 'store.manage' })
