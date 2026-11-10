import { route } from '@/lib/api'
import { probeGoogle } from '@/lib/maps-usage'

/** POST /api/v1/settings/maps-check — ask Google again now whether it accepts the key (after enabling the APIs). */
export const POST = route(async ({ req }) => probeGoogle(req.nextUrl.origin, true), { perm: 'settings.manage' })
