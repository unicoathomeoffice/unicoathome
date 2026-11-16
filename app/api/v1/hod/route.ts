import { route } from '@/lib/api'
import { hodBoard } from '@/lib/services/department-heads'

/** GET /api/v1/hod — the signed-in head of department's requests and staff (empty when they head none). */
export const GET = route(async ({ user }) => hodBoard(user))
