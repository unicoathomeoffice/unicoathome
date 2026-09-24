import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import { db } from './db'
import { getUser, type SessionUser } from './auth'
import { can, type Permission, type Role } from './constants'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
  }
}

export const bad = (message: string, fields?: Record<string, string>) => new ApiError(400, 'BAD_REQUEST', message, fields)
export const notFound = (what = 'Record') => new ApiError(404, 'NOT_FOUND', `${what} not found`)
export const forbidden = (message = 'You do not have permission to do this') => new ApiError(403, 'FORBIDDEN', message)
export const conflict = (code: string, message: string) => new ApiError(409, code, message)

type Ctx<P> = { params: Promise<P> }
type Handler<P> = (args: { req: NextRequest; user: SessionUser; params: P }) => Promise<unknown>
type PublicHandler<P> = (args: { req: NextRequest; user: SessionUser | null; params: P }) => Promise<unknown>

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === 'number' ? { status: init } : init)
}

function toResponse(e: unknown) {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message, fields: e.fields } }, e.status)
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {}
    for (const i of e.issues) fields[i.path.join('.') || '_'] = i.message
    const first = e.issues[0]
    return json({ error: { code: 'VALIDATION', message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input', fields } }, 422)
  }
  console.error('[api]', e)
  return json({ error: { code: 'SERVER_ERROR', message: e instanceof Error ? e.message : 'Unexpected error' } }, 500)
}

/**
 * Authenticated route handler. Usage:
 *   export const POST = route(async ({ req, user, params }) => {...}, { perm: 'requests.assign' })
 * Return a plain object (serialised as JSON) or a Response.
 */
export function route<P = Record<string, string>>(fn: Handler<P>, opt: { perm?: Permission; roles?: Role[] } = {}) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      await db()
      const user = await getUser()
      if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again')
      if (opt.perm && !can(user, opt.perm)) throw forbidden()
      if (opt.roles && !opt.roles.includes(user.role)) throw forbidden()
      const out = await fn({ req, user, params: (await ctx?.params) ?? ({} as P) })
      if (out instanceof Response) return out
      return json(out ?? { ok: true })
    } catch (e) {
      return toResponse(e)
    }
  }
}

export function publicRoute<P = Record<string, string>>(fn: PublicHandler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      await db()
      const out = await fn({ req, user: await getUser().catch(() => null), params: (await ctx?.params) ?? ({} as P) })
      if (out instanceof Response) return out
      return json(out ?? { ok: true })
    } catch (e) {
      return toResponse(e)
    }
  }
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  return schema.parse(raw)
}

export function qp(req: NextRequest) {
  return req.nextUrl.searchParams
}

export function clientMeta(req: NextRequest, user?: SessionUser | null) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? '',
    userAgent: req.headers.get('user-agent') ?? '',
    client: user?.client ?? 'web',
  }
}
