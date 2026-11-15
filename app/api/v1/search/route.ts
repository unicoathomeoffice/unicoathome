import { route, qp } from '@/lib/api'
import { searchAll } from '@/lib/services/search'
import { plain } from '@/lib/db'

/** GET ?q= — global search (same as web /search). `exact` is a request id to open straight away. */
export const GET = route(async ({ req, user }) => plain(await searchAll(user, qp(req).get('q') ?? '')))
