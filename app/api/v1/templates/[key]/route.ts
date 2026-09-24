import { z } from 'zod'
import { route, body, notFound, bad, clientMeta } from '@/lib/api'
import { Template } from '@/lib/models'
import { DEFAULT_TEMPLATES } from '@/lib/templates'
import { queueEmail, emailConfigured } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { getTemplateFull, previewVars, renderPreview } from '../_shared'

type P = { key: string }

/** GET /api/v1/templates/:key — the template (DB override or default) plus its version history. */
export const GET = route<P>(
  async ({ params }) => {
    const t = await getTemplateFull(params.key)
    if (!t) throw notFound('Template')
    return t
  },
  { perm: 'templates.manage' },
)

const Put = z.object({
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(5000).optional(),
  isActive: z.boolean().optional(),
})

/** PUT /api/v1/templates/:key {subject, body, isActive} — publish a new version (previous one goes to history). */
export const PUT = route<P>(
  async ({ req, user, params }) => {
    const input = await body(req, Put)
    const def = DEFAULT_TEMPLATES.find((t) => t.key === params.key)
    const row = await Template.findOne({ key: params.key })
    if (!def && !row) throw notFound('Template')
    const cur = { subject: row?.subject ?? def?.subject ?? '', body: row?.body ?? def?.body ?? '', isActive: row ? row.isActive !== false : true }
    const next = { subject: input.subject ?? cur.subject, body: input.body ?? cur.body, isActive: input.isActive ?? cur.isActive }
    if ((def?.channel ?? row?.channel ?? []).includes('EMAIL') && !next.subject.trim()) throw bad('Email templates need a subject', { subject: 'Required' })
    const contentChanged = next.subject !== cur.subject || next.body !== cur.body
    if (!contentChanged && next.isActive === cur.isActive) return { ok: true, version: row?.version ?? 1, unchanged: true }

    if (!row) {
      await Template.create({
        key: params.key,
        name: def!.name,
        channel: def!.channel,
        audience: def!.audience,
        subject: next.subject,
        body: next.body,
        isActive: next.isActive,
        version: contentChanged ? 2 : 1,
        history: contentChanged ? [{ version: 1, subject: def!.subject, body: def!.body }] : [],
        updatedBy: user.id,
      })
    } else {
      if (contentChanged) {
        row.history.push({ version: row.version ?? 1, subject: row.subject, body: row.body, by: row.updatedBy, at: row.updatedAt })
        row.version = (row.version ?? 1) + 1
      }
      row.subject = next.subject
      row.body = next.body
      row.isActive = next.isActive
      row.updatedBy = user.id
      await row.save()
    }
    const version = contentChanged ? (row?.version ?? 2) : row?.version ?? 1
    await audit(user, contentChanged ? 'template.publish' : 'template.toggle', 'template', params.key, { before: cur, after: { ...next, version }, label: params.key }, clientMeta(req, user))
    return { ok: true, version }
  },
  { perm: 'templates.manage' },
)

const Post = z.union([
  z.object({ preview: z.literal(true), requestId: z.string().optional(), subject: z.string().optional(), body: z.string().optional() }),
  z.object({ test: z.literal(true), to: z.string().email(), requestId: z.string().optional(), subject: z.string().optional(), body: z.string().optional() }),
])

/**
 * POST /api/v1/templates/:key
 *   {preview:true, requestId?, subject?, body?} → rendered {subject, text, html} with a real request's data
 *   {test:true, to, requestId?, subject?, body?} → sends that rendering as a test email (logged in message_logs)
 * subject/body default to the saved version, so unsaved drafts can be previewed and tested.
 */
export const POST = route<P>(
  async ({ req, user, params }) => {
    const input = await body(req, Post)
    const full = await getTemplateFull(params.key)
    if (!full) throw notFound('Template')
    const { vars, request } = await previewVars(input.requestId)
    const out = renderPreview(input.subject ?? full.template.subject, input.body ?? full.template.body, vars)
    if ('preview' in input) return { ...out, request }
    const log = await queueEmail({
      to: input.to,
      subject: `[Test] ${out.subject}`,
      text: out.text,
      templateKey: params.key,
      initiatedBy: user.id,
    })
    await audit(user, 'template.test_send', 'template', params.key, { after: { to: input.to, requestNo: request?.requestNo }, label: params.key }, clientMeta(req, user))
    return { id: String(log._id), configured: emailConfigured() }
  },
  { perm: 'templates.manage' },
)
