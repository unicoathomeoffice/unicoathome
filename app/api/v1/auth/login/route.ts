import { z } from 'zod'
import { publicRoute, body, ApiError, clientMeta } from '@/lib/api'
import { User } from '@/lib/models'
import { createSession, setSessionCookie, verifyPassword } from '@/lib/auth'
import { audit } from '@/lib/audit'

const Input = z.object({
  identifier: z.string().min(2, 'Enter your employee ID, phone or email'),
  password: z.string().min(1, 'Enter your password'),
  client: z.enum(['web', 'app']).default('web'),
  remember: z.boolean().default(true),
})

// naive in-memory limiter per instance (swap for Upstash Ratelimit in production)
const attempts = new Map<string, { n: number; until: number }>()

export const POST = publicRoute(async ({ req }) => {
  const input = await body(req, Input)
  const meta = clientMeta(req)
  const key = `${meta.ip}:${input.identifier.toLowerCase()}`
  const a = attempts.get(key)
  if (a && a.n >= 8 && a.until > Date.now()) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.')

  const id = input.identifier.trim()
  const digits = id.replace(/\D/g, '')
  const phoneVariants = digits.length >= 10 ? [id, digits, `0${digits.slice(-10)}`, `+880${digits.slice(-10)}`, `880${digits.slice(-10)}`] : []
  const user = await User.findOne({
    deletedAt: null,
    $or: [{ employeeId: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { email: id.toLowerCase() }, ...(phoneVariants.length ? [{ phone: { $in: phoneVariants } }] : [])],
  }).select('+passwordHash')

  if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 15 * 60_000 })
    await audit(null, 'auth.login_failed', 'user', user?._id, { after: { identifier: id, client: input.client } }, { ...meta, client: input.client })
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Employee ID / phone or password is incorrect')
  }
  if (user.status !== 'ACTIVE') throw new ApiError(403, 'SUSPENDED', user.status === 'PENDING' ? 'Your account is waiting for admin approval.' : 'Your account is suspended. Contact the Home Care coordinator.')
  if (!user.platformAccess?.includes(input.client)) {
    throw new ApiError(
      403,
      'PLATFORM_DENIED',
      input.client === 'web'
        ? 'This account is app-only. Please use the Unico HomeCare app. Ask your coordinator if you need web access.'
        : 'This account is web-only. Please sign in on the web admin.',
    )
  }
  attempts.delete(key)
  const { token, expiresAt } = await createSession(String(user._id), user.role, input.client, input.remember)
  await setSessionCookie(token, expiresAt)
  user.lastLoginAt = new Date()
  await user.save()
  await audit({ id: String(user._id), name: user.name, role: user.role }, 'auth.login', 'user', user._id, { label: user.name }, { ...meta, client: input.client })
  const isField = !user.platformAccess.includes('web') || input.client === 'app'
  // Browsers rely on the httpOnly cookie; only a native app (x-hc-native: 1) receives the bearer token.
  const native = req.headers.get('x-hc-native') === '1'
  return { ok: true, ...(native ? { token } : {}), redirect: isField ? '/m' : '/dashboard', user: { id: String(user._id), name: user.name, role: user.role } }
})
