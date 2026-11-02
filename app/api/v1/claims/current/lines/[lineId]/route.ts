import { route, body, clientMeta } from '@/lib/api'
import { plain } from '@/lib/db'
import { LinePatch, removeLine, updateLine } from '@/lib/services/claims'

export const PATCH = route<{ lineId: string }>(async ({ req, user, params }) => plain({ claim: await updateLine(user, params.lineId, await body(req, LinePatch), clientMeta(req, user)) }))

export const DELETE = route<{ lineId: string }>(async ({ req, user, params }) => plain({ claim: await removeLine(user, params.lineId, clientMeta(req, user)) }))
