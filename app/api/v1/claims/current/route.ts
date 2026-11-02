import { route, body, clientMeta } from '@/lib/api'
import { plain } from '@/lib/db'
import { addLine, draftOf, LineInput, submitClaim, suggestions } from '@/lib/services/claims'

export const maxDuration = 60

/** GET /api/v1/claims/current — my open claim + trips I could add. */
export const GET = route(async ({ user }) => {
  const [claim, suggest] = await Promise.all([draftOf(user), suggestions(user)])
  return plain({ claim, suggestions: suggest })
})

/** POST /api/v1/claims/current — add an expense line ({ submit: true } submits the claim instead). */
export const POST = route(async ({ req, user }) => {
  const raw = await req.clone().json().catch(() => ({}))
  if (raw?.submit === true) return submitClaim(user, clientMeta(req, user))
  const c = await addLine(user, await body(req, LineInput), clientMeta(req, user))
  return plain({ claim: c })
})
