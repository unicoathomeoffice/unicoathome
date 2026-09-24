import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { db } from './db'
import { Session, User, Designation } from './models'
import { can, type Permission, type Role } from './constants'

export const COOKIE = 'hc_session'
const secret = () => {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set (32+ characters)')
  return new TextEncoder().encode(s)
}

export type Client = 'web' | 'app'
export type SessionUser = {
  id: string
  employeeId: string
  name: string
  role: Role
  designation?: string
  phone: string
  email?: string
  platformAccess: Client[]
  availability: string
  zones: string[]
  skills: string[]
  initials: string
  photoUrl?: string
  client: Client
  jti: string
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10)
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash)

export function initials(name: string) {
  const parts = name.replace(/^(Dr\.?|Md\.?|Mst\.?|Mohammad)\s+/i, '').split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export async function createSession(userId: string, role: Role, client: Client, remember: boolean) {
  const jti = randomUUID()
  const days = remember ? 30 : 1
  const expiresAt = new Date(Date.now() + days * 86400_000)
  const token = await new SignJWT({ role, aud: client })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret())
  const h = await headers()
  await Session.create({
    userId,
    jti,
    client,
    userAgent: h.get('user-agent') ?? '',
    ip: h.get('x-forwarded-for')?.split(',')[0] ?? '',
    lastSeenAt: new Date(),
    expiresAt,
  })
  return { token, expiresAt }
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: ['web', 'app'] })
    return payload as { sub: string; jti: string; role: Role; aud: Client }
  } catch {
    return null
  }
}

async function readToken(): Promise<string | undefined> {
  const h = await headers()
  const auth = h.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return (await cookies()).get(COOKIE)?.value
}

/** Current user, or null. Validates token, session revocation and account status on every call. */
export const getUser = cache(async function getUser(): Promise<SessionUser | null> {
  const token = await readToken()
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload?.sub || !payload.jti) return null
  await db()
  const [session, user] = await Promise.all([
    Session.findOne({ jti: payload.jti }).select('revokedAt lastSeenAt').lean<any>(),
    User.findById(payload.sub).lean<any>(),
  ])
  if (!session || session.revokedAt || !user || user.status !== 'ACTIVE' || user.deletedAt) return null
  if (!session.lastSeenAt || Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60_000) {
    Session.updateOne({ jti: payload.jti }, { lastSeenAt: new Date() }).catch(() => {})
  }
  const designation = user.designationId ? await Designation.findById(user.designationId).select('title').lean<any>() : null
  return {
    id: String(user._id),
    employeeId: user.employeeId,
    name: user.name ?? '',
    role: user.role,
    designation: designation?.title,
    phone: user.phone,
    email: user.email,
    platformAccess: user.platformAccess ?? [],
    availability: user.availability,
    zones: user.zones ?? [],
    skills: user.skills ?? [],
    initials: initials(user.name ?? ''),
    photoUrl: user.photoUrl,
    client: payload.aud,
    jti: payload.jti,
  }
})

/** For server components in the web admin. Field-only users are sent to the app. */
export async function requireWebUser(perm?: Permission): Promise<SessionUser> {
  const u = await getUser()
  if (!u) redirect('/login')
  if (!u.platformAccess.includes('web')) redirect('/m')
  if (perm && !can(u.role, perm)) redirect('/dashboard?denied=1')
  return u
}

/** For server components in the mobile app (/m). */
export async function requireAppUser(perm?: Permission): Promise<SessionUser> {
  const u = await getUser()
  if (!u) redirect('/m/login')
  if (!u.platformAccess.includes('app')) redirect('/dashboard')
  if (perm && !can(u.role, perm)) redirect('/m?denied=1')
  return u
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSession() {
  const token = (await cookies()).get(COOKIE)?.value
  if (token) {
    const p = await verifyToken(token)
    if (p?.jti) await Session.updateOne({ jti: p.jti }, { revokedAt: new Date() })
  }
  ;(await cookies()).delete(COOKIE)
}
