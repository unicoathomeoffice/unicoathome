import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { addHouseholdMember, HouseholdAddInput, householdView } from '@/lib/services/household'

export const maxDuration = 60

/** GET — the patients on this household visit (same address, one trip). */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  return { members: (await householdView(r)) ?? [] }
})

/** POST — add another patient at this address: their own request with their own services, same time, team and car. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const input = await body(req, HouseholdAddInput)
  return addHouseholdMember(r, input, user, clientMeta(req, user))
})
