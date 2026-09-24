import 'server-only'
import { HomecareRequest, Template, User, isOid } from '@/lib/models'
import { DEFAULT_TEMPLATES, emailShell, renderText, type TemplateDef } from '@/lib/templates'
import { templateVars } from '@/lib/services/requests'

// Helpers for the E5 template editor (GET list / one, preview, test send). DB rows in `templates`
// override DEFAULT_TEMPLATES; lib/messaging.getTemplate() reads the same fields (subject, body, isActive…).

export type TemplateView = TemplateDef & {
  isActive: boolean
  version: number
  customised: boolean
  updatedAt?: string
  updatedByName?: string
  defaultSubject: string
  defaultBody: string
}

function view(def: TemplateDef | undefined, row: any, names: Map<string, string>): TemplateView {
  const key = row?.key ?? def!.key
  return {
    key,
    name: row?.name || def?.name || key,
    channel: row?.channel?.length ? row.channel : def?.channel ?? ['EMAIL'],
    audience: row?.audience || def?.audience || 'Patient',
    subject: row?.subject || def?.subject || '',
    body: row?.body || def?.body || '',
    isActive: row ? row.isActive !== false : true,
    version: row?.version ?? 1,
    customised: !!row,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
    updatedByName: row?.updatedBy ? names.get(String(row.updatedBy)) : undefined,
    defaultSubject: def?.subject ?? '',
    defaultBody: def?.body ?? '',
  }
}

async function nameMap(ids: unknown[]) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }).select('name').lean<any[]>()
  return new Map(users.map((u) => [String(u._id), u.name as string]))
}

export async function listTemplates(): Promise<TemplateView[]> {
  const rows = await Template.find({}).select('-history').lean<any[]>()
  const names = await nameMap(rows.map((r) => r.updatedBy))
  const out = DEFAULT_TEMPLATES.map((d) => view(d, rows.find((r) => r.key === d.key), names))
  for (const r of rows) if (!DEFAULT_TEMPLATES.some((d) => d.key === r.key)) out.push(view(undefined, r, names))
  return out
}

export async function getTemplateFull(key: string) {
  const def = DEFAULT_TEMPLATES.find((t) => t.key === key)
  const row = await Template.findOne({ key }).lean<any>()
  if (!def && !row) return null
  const history: any[] = row?.history ?? []
  const names = await nameMap([row?.updatedBy, ...history.map((h) => h.by)])
  return {
    template: view(def, row, names),
    history: history
      .map((h) => ({ version: h.version as number, subject: h.subject as string, body: h.body as string, at: h.at ? new Date(h.at).toISOString() : null, byName: h.by ? names.get(String(h.by)) ?? 'Unknown' : h.at ? 'System' : 'Default' }))
      .sort((a, b) => b.version - a.version),
  }
}

/** Sample values for placeholders that a request cannot provide (escalations, digests, codes). */
const EXTRA: Record<string, string> = { minutes: '15', reason: 'Unavailable', nextStaff: 'Next best candidate', code: '471903' }

export async function previewVars(requestId?: string) {
  const r = requestId && isOid(requestId) ? await HomecareRequest.findById(requestId).lean<any>() : await HomecareRequest.findOne({ deletedAt: null, 'assignment.primaryStaffId': { $ne: null } }).sort({ 'timeline.requestedAt': -1 }).lean<any>()
  const vars: Record<string, unknown> = r ? await templateVars(r, r.assignment?.primaryStaffId) : {}
  for (const [k, v] of Object.entries(EXTRA)) if (vars[k] == null || vars[k] === '') vars[k] = v
  return { vars, request: r ? { id: String(r._id), requestNo: r.requestNo as string, patientName: r.patientSnapshot?.name as string } : null }
}

export function renderPreview(subject: string, body: string, vars: Record<string, unknown>) {
  const s = renderText(subject, vars)
  const text = renderText(body, vars)
  return { subject: s, text, html: emailShell({ title: s, bodyText: text, preheader: text.slice(0, 90) }) }
}
