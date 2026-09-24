import 'server-only'
import { after } from 'next/server'
import nodemailer, { type Transporter } from 'nodemailer'
import { MessageLog, Notification, Template, User } from './models'
import { DEFAULT_TEMPLATES, emailShell, renderText, type TemplateDef } from './templates'
import type { Role } from './constants'
import { getSettings, ruleAllows } from './settings'

/** Run work after the response is sent (Vercel-safe). Falls back to fire-and-forget outside a request. */
export function background(fn: () => Promise<unknown>) {
  const run = () => fn().catch((e) => console.error('[background]', e))
  try {
    after(run)
  } catch {
    void run()
  }
}

// ---------------------------------------------------------------- templates
export async function getTemplate(key: string): Promise<TemplateDef & { isActive?: boolean }> {
  const def = DEFAULT_TEMPLATES.find((t) => t.key === key)
  const row = await Template.findOne({ key }).lean<any>()
  if (!row && !def) throw new Error(`Unknown template ${key}`)
  if (!row) return def!
  return {
    key,
    name: row.name ?? def?.name ?? key,
    channel: row.channel?.length ? row.channel : def?.channel ?? [],
    audience: row.audience ?? def?.audience ?? 'Patient',
    subject: row.subject || def?.subject || '',
    body: row.body || def?.body || '',
    isActive: row.isActive,
  }
}

export async function renderTemplate(key: string, vars: Record<string, unknown>) {
  const t = await getTemplate(key)
  const subject = renderText(t.subject, vars)
  const text = renderText(t.body, vars)
  return { subject, text, active: t.isActive !== false }
}

// ---------------------------------------------------------------- email (Gmail SMTP + App Password)
let transporter: Transporter | null = null
export const emailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)

function mailer() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    })
  }
  return transporter
}

type EmailInput = {
  to: string
  toName?: string
  subject: string
  text: string
  html?: string
  templateKey?: string
  requestId?: unknown
  patientId?: unknown
  initiatedBy?: string
  cc?: string
  cta?: { label: string; url: string }
}

/** Log the email, then deliver after the response. Every send lands in message_logs. */
export async function queueEmail(input: EmailInput) {
  const html = input.html ?? emailShell({ title: input.subject, bodyText: input.text, cta: input.cta, preheader: input.text.slice(0, 90) })
  const log = await MessageLog.create({
    channel: 'EMAIL',
    provider: 'gmail_smtp',
    to: input.to,
    toName: input.toName,
    subject: input.subject,
    templateKey: input.templateKey,
    renderedText: input.text,
    renderedHtml: html,
    requestId: input.requestId,
    patientId: input.patientId,
    initiatedBy: input.initiatedBy,
    status: 'QUEUED',
    events: [{ status: 'QUEUED', at: new Date() }],
  })
  background(() => deliverEmail(String(log._id), input.cc))
  return log
}

export async function deliverEmail(logId: string, cc?: string) {
  const log = await MessageLog.findById(logId)
  if (!log) return
  if (!emailConfigured()) {
    log.status = 'SKIPPED'
    log.error = 'Gmail is not configured (GMAIL_USER / GMAIL_APP_PASSWORD)'
    log.events.push({ status: 'SKIPPED', at: new Date(), note: log.error })
    await log.save()
    return
  }
  log.attempts = (log.attempts ?? 0) + 1
  try {
    const s = await getSettings()
    const fromName = (s.email.fromName || process.env.EMAIL_FROM_NAME || 'Unico HomeCare').replace(/"/g, '')
    const from = `"${fromName}" <${process.env.GMAIL_USER}>`
    const info = await mailer().sendMail({ from, to: log.to, cc, replyTo: s.email.replyTo || undefined, subject: log.subject, text: log.renderedText, html: log.renderedHtml })
    log.status = 'SENT'
    log.providerId = info.messageId
    log.error = undefined
    log.events.push({ status: 'SENT', at: new Date() })
  } catch (e: any) {
    log.status = 'FAILED'
    log.error = e?.message ?? String(e)
    log.events.push({ status: 'FAILED', at: new Date(), note: log.error })
  }
  await log.save()
}

// ---------------------------------------------------------------- WhatsApp (tier 1: deep link)
export function waNumber(p?: string | null) {
  if (!p) return ''
  let d = p.replace(/\D/g, '')
  const cc = process.env.WA_DEFAULT_COUNTRY ?? '880'
  if (d.startsWith('0')) d = cc + d.slice(1)
  else if (!d.startsWith(cc) && d.length === 10) d = cc + d
  return d
}

export function waLink(phone: string, text: string) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`
}

/** Render and log a WhatsApp message; the user's device opens the link and taps Send. */
export async function prepareWhatsApp(input: { to: string; toName?: string; text: string; templateKey?: string; requestId?: unknown; patientId?: unknown; initiatedBy?: string }) {
  const log = await MessageLog.create({
    channel: 'WHATSAPP',
    provider: 'wa_deeplink',
    to: waNumber(input.to),
    toName: input.toName,
    templateKey: input.templateKey,
    renderedText: input.text,
    requestId: input.requestId,
    patientId: input.patientId,
    initiatedBy: input.initiatedBy,
    status: 'PREPARED',
    events: [{ status: 'PREPARED', at: new Date() }],
  })
  return { logId: String(log._id), url: waLink(input.to, input.text), text: input.text, to: waNumber(input.to) }
}

// ---------------------------------------------------------------- in-app notifications
type NotifyInput = {
  type: string
  title: string
  body?: string
  requestId?: unknown
  url?: string
  priority?: 'normal' | 'high'
  /** recipient column in the E4 matrix (STAFF, DRIVER…) — when set, the notification rules decide whether it is sent */
  as?: 'STAFF' | 'DRIVER'
  /** matrix event row when it differs from the type (e.g. PETTY_CASH for an APPROVAL notification) */
  event?: string
}

export async function notifyUsers(userIds: unknown[], n: NotifyInput) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))]
  if (!ids.length) return
  if (n.as) {
    const { notificationRules } = await getSettings()
    if (!ruleAllows(notificationRules, n.event ?? n.type, n.as, 'inapp')) return
  }
  await Notification.insertMany(
    ids.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body,
      priority: n.priority ?? 'normal',
      data: { requestId: n.requestId, url: n.url },
      channels: ['inapp'],
    })),
  )
  await MessageLog.insertMany(
    ids.map((userId) => ({ channel: 'PUSH', provider: 'inapp', to: userId, subject: n.title, renderedText: n.body, requestId: n.requestId, status: 'DELIVERED', events: [{ status: 'DELIVERED', at: new Date() }] })),
  )
}

export async function notifyRoles(roles: Role[], n: NotifyInput, exceptUserId?: string) {
  const { notificationRules } = await getSettings()
  roles = roles.filter((r) => ruleAllows(notificationRules, n.type, r, 'inapp'))
  if (!roles.length) return
  const users = await User.find({ role: { $in: roles }, status: 'ACTIVE', deletedAt: null }).select('_id').lean<any[]>()
  await notifyUsers(
    users.map((u) => u._id).filter((id) => String(id) !== exceptUserId),
    n,
  )
}
