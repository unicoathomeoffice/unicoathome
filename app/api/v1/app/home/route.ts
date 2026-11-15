import { route } from '@/lib/api'
import { myDay } from '@/lib/services/home'
import { plain } from '@/lib/db'

/** GET — the field "Today" screen for the signed-in person (same data as web /m). */
export const GET = route(async ({ user }) => plain(await myDay(user)))
