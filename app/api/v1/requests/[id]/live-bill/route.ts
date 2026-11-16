import { route } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { liveBill } from '@/lib/services/live-bill'

export const maxDuration = 30

/** GET /api/v1/requests/:id/live-bill — this visit priced as H360 bills it for the patient's UHID (corporate discounts
 *  per item, home care charges at full price), and the H360 bill already on the visit to compare. Read-only. */
export const GET = route<{ id: string }>(async ({ user, params }) => liveBill(await loadRequest(params.id, user)))
