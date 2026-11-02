import { z } from 'zod'
import { route, body, bad, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { clearH360Config, DEFAULT_H360_URL, getH360Config, h360Status, saveH360Config, testH360 } from '@/lib/h360'

export const maxDuration = 60

/** GET /api/v1/integrations/h360 — saved? last test result (never the password). Super admin only. */
export const GET = route(async () => {
  const [st, cfg] = await Promise.all([h360Status(), getH360Config().catch(() => null)])
  return { ...st, username: cfg?.username ?? st.username ?? null, baseUrl: cfg?.baseUrl ?? DEFAULT_H360_URL }
}, { roles: ['SUPER_ADMIN'] })

const Save = z.object({
  baseUrl: z.string().url().default(DEFAULT_H360_URL),
  username: z.string().trim().min(1, 'User name is required').max(80),
  password: z.string().max(200).optional(), // empty = keep the saved one
})

/** POST { baseUrl, username, password? } saves (encrypted) · { test: true, sample? } tests the connection. */
export const POST = route(
  async ({ req, user }) => {
    const raw = await req.clone().json().catch(() => ({}))
    const meta = clientMeta(req, user)
    if (raw?.test) {
      const out = await testH360(typeof raw.sample === 'string' ? raw.sample : undefined)
      await audit(user, 'settings.h360_test', 'settings', 'h360', { after: { ok: out.ok, found: (out as any).found ?? null, error: (out as any).error } }, meta)
      return out
    }
    const input = await body(req, Save)
    const prev = await getH360Config().catch(() => null)
    const password = input.password || prev?.password
    if (!password) throw bad('Enter the H360 password', { password: 'Required' })
    if (!/^https?:\/\/[^/\s]+/.test(input.baseUrl)) throw bad('Use the http:// or https:// address of H360 (e.g. http://115.127.139.2:8085)')
    await saveH360Config({ baseUrl: input.baseUrl.replace(/\/+$/, ''), username: input.username, password }, user.id)
    await audit(user, 'settings.h360_update', 'settings', 'h360', { after: { baseUrl: input.baseUrl, username: input.username, passwordChanged: !!input.password } }, meta)
    return { ok: true }
  },
  { roles: ['SUPER_ADMIN'] },
)

/** DELETE — remove the saved H360 login. */
export const DELETE = route(
  async ({ req, user }) => {
    await clearH360Config()
    await audit(user, 'settings.h360_remove', 'settings', 'h360', {}, clientMeta(req, user))
    return { ok: true }
  },
  { roles: ['SUPER_ADMIN'] },
)
