import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { route, body, bad, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { clearH360Config, DEFAULT_H360_URL, h360Status, ownConfig, saveH360Config, testH360, testH360Store, type H360Profile } from '@/lib/h360'

export const maxDuration = 60

// Two saved H360 logins (super admin): ?profile=main (patients, bills, staff) · ?profile=store (Family Medicine store).
const profileOf = (req: NextRequest): H360Profile => (req.nextUrl.searchParams.get('profile') === 'store' ? 'store' : 'main')

/** GET /api/v1/integrations/h360?profile= — saved? last test result (never the password). */
export const GET = route(
  async ({ req }) => {
    const profile = profileOf(req)
    const [st, cfg] = await Promise.all([h360Status(profile), ownConfig(profile).catch(() => null)])
    return { ...st, profile, username: cfg?.username ?? st.username ?? null, baseUrl: cfg?.baseUrl ?? DEFAULT_H360_URL }
  },
  { roles: ['SUPER_ADMIN'] },
)

const Save = z.object({
  baseUrl: z.string().url().default(DEFAULT_H360_URL),
  username: z.string().trim().min(1, 'User name is required').max(80),
  password: z.string().max(200).optional(), // empty = keep the saved one
})

/** POST { baseUrl, username, password? } saves (encrypted) · { test: true, sample? } tests the connection. */
export const POST = route(
  async ({ req, user }) => {
    const profile = profileOf(req)
    const raw = await req.clone().json().catch(() => ({}))
    const meta = clientMeta(req, user)
    if (raw?.test) {
      const out = profile === 'store' ? await testH360Store() : await testH360(typeof raw.sample === 'string' ? raw.sample : undefined)
      await audit(user, 'settings.h360_test', 'settings', `h360:${profile}`, { after: { ok: out.ok, found: (out as any).found ?? null, error: (out as any).error } }, meta)
      return out
    }
    const input = await body(req, Save)
    const prev = await ownConfig(profile).catch(() => null)
    const password = input.password || prev?.password
    if (!password) throw bad('Enter the H360 password', { password: 'Required' })
    if (!/^https?:\/\/[^/\s]+/.test(input.baseUrl)) throw bad('Use the http:// or https:// address of H360 (e.g. https://his.unicohospitals.com)')
    await saveH360Config({ baseUrl: input.baseUrl.replace(/\/+$/, ''), username: input.username, password }, user.id, profile)
    await audit(user, 'settings.h360_update', 'settings', `h360:${profile}`, { after: { profile, baseUrl: input.baseUrl, username: input.username, passwordChanged: !!input.password } }, meta)
    return { ok: true }
  },
  { roles: ['SUPER_ADMIN'] },
)

/** DELETE — remove a saved H360 login (the store login then falls back to the main one). */
export const DELETE = route(
  async ({ req, user }) => {
    const profile = profileOf(req)
    await clearH360Config(profile)
    await audit(user, 'settings.h360_remove', 'settings', `h360:${profile}`, { after: { profile } }, clientMeta(req, user))
    return { ok: true }
  },
  { roles: ['SUPER_ADMIN'] },
)
