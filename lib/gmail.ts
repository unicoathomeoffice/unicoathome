import 'server-only'
import { cache } from 'react'
import type { SendMailOptions } from 'nodemailer'
import { IntegrationSecret } from './models'
import { decryptIntegration, encryptIntegration } from './integration-secrets'
import type { GmailMode, GmailStatus } from './gmail-types'

export type GmailConfig = {
  mode: GmailMode
  smtp: { user: string; appPassword: string }
  oauth2: { user: string; clientId: string; clientSecret: string; refreshToken: string }
}
export const getGmailConfig = cache(async (): Promise<GmailConfig> => {
  const row = await IntegrationSecret.findById('gmail').select('+encrypted').lean<any>()
  if (row) return decryptIntegration<GmailConfig>(row.encrypted)
  return {
    mode: process.env.GMAIL_MODE === 'oauth2' ? 'oauth2' : 'smtp',
    smtp: { user: process.env.GMAIL_USER ?? '', appPassword: process.env.GMAIL_APP_PASSWORD ?? '' },
    oauth2: { user: process.env.GMAIL_OAUTH_USER ?? process.env.GMAIL_USER ?? '', clientId: process.env.GMAIL_CLIENT_ID ?? '', clientSecret: process.env.GMAIL_CLIENT_SECRET ?? '', refreshToken: process.env.GMAIL_REFRESH_TOKEN ?? '' },
  }
})
export function gmailReady(c: GmailConfig) {
  return c.mode === 'smtp' ? !!(c.smtp.user && c.smtp.appPassword) : !!(c.oauth2.user && c.oauth2.clientId && c.oauth2.clientSecret && c.oauth2.refreshToken)
}
export function gmailStatus(c: GmailConfig): GmailStatus {
  return {
    mode: c.mode, configured: gmailReady(c), user: c[c.mode].user || null,
    canSave: /^[a-f0-9]{64}$/i.test(process.env.INTEGRATION_ENCRYPTION_KEY ?? ''),
    smtp: { user: c.smtp.user, hasPassword: !!c.smtp.appPassword },
    oauth2: { user: c.oauth2.user, clientId: c.oauth2.clientId, hasClientSecret: !!c.oauth2.clientSecret, hasRefreshToken: !!c.oauth2.refreshToken },
  }
}
export async function getGmailStatus() { return gmailStatus(await getGmailConfig()) }
export async function saveGmailConfig(c: GmailConfig, userId: string) {
  await IntegrationSecret.updateOne({ _id: 'gmail' }, { encrypted: encryptIntegration(c), updatedBy: userId }, { upsert: true })
}

export async function sendGmail(c: GmailConfig, message: SendMailOptions): Promise<string> {
  const nodemailer = (await import('nodemailer')).default // loaded only when a mail is actually sent
  if (c.mode === 'smtp') {
    const mailer = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
      auth: { user: c.smtp.user, pass: c.smtp.appPassword },
    })
    try { return (await mailer.sendMail(message)).messageId }
    catch { throw new Error('Gmail SMTP rejected the send. Check the account and App Password in Settings.') }
    finally { mailer.close() }
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: c.oauth2.clientId, client_secret: c.oauth2.clientSecret, refresh_token: c.oauth2.refreshToken, grant_type: 'refresh_token' }),
  })
  if (!tokenResponse.ok) throw new Error('Google could not refresh authorization. Check the OAuth client and refresh token in Settings.')
  const token = await tokenResponse.json()
  if (!token.access_token) throw new Error('Google did not return an access token')
  const mime = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(message)
  if (!Buffer.isBuffer(mime.message)) throw new Error('Could not prepare the Gmail message')
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: mime.message.toString('base64url') }),
  })
  if (!response.ok) throw new Error(`Gmail API rejected the send (${response.status}). Check Gmail API access and the gmail.send permission.`)
  const result = await response.json()
  if (!result.id) throw new Error('Gmail API did not return a message ID')
  return result.id
}
