import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { SignJWT, jwtVerify } from 'jose'
import type { NextRequest } from 'next/server'
import { db } from './db'
import { Patient } from './models'
import { ApiError, json, toResponse } from './api'

// Patient accounts (the public portal under /my). Separate from staff sessions: own cookie, own JWT audience,
// no role. The token carries the patient's password version, so changing the password signs out every device.

export const PATIENT_COOKIE = 'hc_patient'
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET ?? '')

export type PatientSession = {
  id: string
  name: string
  phone: string
  whatsapp: string
  email?: string
  ageYears?: number
  gender?: string
  address?: { full?: string; house?: string; flat?: string; area?: string; landmark?: string; lat?: number | null; lng?: number | null }
  initials: string
  hasPassword: boolean
  google: boolean
}

export async function issuePatientToken(patientId: string, passwordVersion: number) {
  const expiresAt = new Date(Date.now() + 30 * 86400_000)
  const token = await new SignJWT({ pv: passwordVersion, aud: 'patient' }).setProtectedHeader({ alg: 'HS256' }).setSubject(patientId).setIssuedAt().setExpirationTime(expiresAt).sign(secret())
  return { token, expiresAt }
}

export const patientCookie = (token: string, expires: Date) => ({ name: PATIENT_COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', expires })

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'

/** Signed-in patient, or null. Checks the token, that the account still exists and the password hasn't changed. */
export const getPatient = cache(async function getPatient(): Promise<PatientSession | null> {
  const token = (await cookies()).get(PATIENT_COOKIE)?.value
  if (!token) return null
  let sub: string | undefined, pv: number
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: 'patient' })
    sub = payload.sub
    pv = Number(payload.pv ?? 0)
  } catch {
    return null
  }
  if (!sub) return null
  await db()
  const p = await Patient.findOne({ _id: sub, deletedAt: null, $or: [{ passwordHash: { $exists: true } }, { googleSub: { $exists: true } }] }).select('name phone whatsapp email ageYears gender address passwordVersion passwordHash googleSub').lean<any>()
  if (!p || Number(p.passwordVersion ?? 0) !== pv) return null
  return { id: String(p._id), name: p.name, phone: p.phone, whatsapp: p.whatsapp ?? p.phone, email: p.email, ageYears: p.ageYears, gender: p.gender, address: p.address, initials: initials(p.name), hasPassword: !!p.passwordHash, google: !!p.googleSub }
})

/** For server components under /my: signed-in patient or redirect to the patient login. */
export async function requirePatient(next?: string): Promise<PatientSession> {
  const p = await getPatient()
  if (!p) redirect(`/my/login${next ? `?next=${encodeURIComponent(next)}` : ''}`)
  return p
}

type Ctx<P> = { params: Promise<P> }
/** Route handler that needs a signed-in patient (401 otherwise). Same shape as route() in lib/api.ts. */
export function patientRoute<P = Record<string, string>>(fn: (args: { req: NextRequest; patient: PatientSession; params: P }) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      await db()
      const patient = await getPatient()
      if (!patient) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again')
      const out = await fn({ req, patient, params: (await ctx?.params) ?? ({} as P) })
      if (out instanceof Response) return out
      return json(out ?? { ok: true })
    } catch (e) {
      return toResponse(e)
    }
  }
}
