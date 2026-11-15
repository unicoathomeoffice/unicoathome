import { route } from '@/lib/api'
import { badgesFor } from '@/lib/services/app'

/** GET — badge numbers for the app's tabs and More grid (unread, open requests, WhatsApp waiting, approvals, store). */
export const GET = route(async ({ user }) => badgesFor(user))
