import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { getGmailConfig, getGmailStatus, gmailReady, gmailStatus, saveGmailConfig } from '@/lib/gmail'
import { audit } from '@/lib/audit'
import { canOpenSettings } from '@/lib/constants'

const Input = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('smtp'), user: z.string().trim().email().max(254), appPassword: z.string().max(200).optional() }),
  z.object({ mode: z.literal('oauth2'), user: z.string().trim().email().max(254), clientId: z.string().trim().min(1).max(500), clientSecret: z.string().trim().max(2000).optional(), refreshToken: z.string().trim().max(8192).optional() }),
])
export const GET = route(async ({ user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  return { gmail: await getGmailStatus() }
})
export const PATCH = route(async ({ req, user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(req.url).origin) throw forbidden()
  const input = await body(req, Input)
  const config = structuredClone(await getGmailConfig())
  config.mode = input.mode
  if (input.mode === 'smtp') {
    const changed = input.user.toLowerCase() !== config.smtp.user.toLowerCase()
    const password = input.appPassword?.replace(/\s/g, '')
    if (changed && !password) throw bad('Enter an App Password for the new sending account')
    if (password && !/^[a-zA-Z]{16}$/.test(password)) throw bad('Enter the 16-letter Google App Password')
    config.smtp = { user: input.user, appPassword: password || config.smtp.appPassword }
  } else {
    const changed = input.user.toLowerCase() !== config.oauth2.user.toLowerCase() || input.clientId !== config.oauth2.clientId
    if (changed && (!input.clientSecret || !input.refreshToken)) throw bad('Enter the client secret and refresh token for the new OAuth account/client')
    config.oauth2 = { user: input.user, clientId: input.clientId, clientSecret: input.clientSecret || config.oauth2.clientSecret, refreshToken: input.refreshToken || config.oauth2.refreshToken }
  }
  if (!gmailReady(config)) throw bad('Complete the credentials for the selected delivery method')
  await saveGmailConfig(config, user.id)
  await audit(user, 'settings.gmail_configure', 'settings', 'gmail', { after: { mode: config.mode, account: input.user }, label: 'Gmail configuration' }, clientMeta(req, user))
  return { gmail: gmailStatus(config) }
})
