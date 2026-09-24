// Message templates (plan §10, English only). DB overrides in the `templates` collection take precedence.
export type TemplateDef = {
  key: string
  name: string
  channel: ('EMAIL' | 'WHATSAPP' | 'PUSH')[]
  audience: 'Patient' | 'Staff' | 'Admin' | 'Department'
  subject: string
  body: string
}

export const PLACEHOLDERS = [
  'patientName',
  'requestNo',
  'serviceType',
  'date',
  'slot',
  'staffName',
  'designation',
  'address',
  'patientPhone',
  'age',
  'gender',
  'notes',
  'feedbackLink',
  'hospitalPhone',
  'minutes',
  'reason',
  'nextStaff',
  'checkInAt',
  'checkOutAt',
  'durationMin',
  'doneCount',
  'totalCount',
  'code',
] as const

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    key: 'patient_confirmed',
    name: 'Request confirmed',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your home care visit is confirmed · {requestNo}',
    body: 'Dear {patientName}, your home care request ({requestNo}) is confirmed.\nService: {serviceType}\nTime: {date}, {slot}\nOur team will arrive at the scheduled time. Need help? Call {hospitalPhone}.\n— Unico Hospitals, Family Medicine',
  },
  {
    key: 'patient_assigned',
    name: 'Team assigned (patient)',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your care team for {requestNo}',
    body: 'Dear {patientName}, {staffName} ({designation}) has been assigned to your visit.\nTime: {date}, {slot}.\n— Unico Hospitals, Family Medicine',
  },
  {
    key: 'staff_assigned',
    name: 'Assignment notice (staff)',
    channel: ['WHATSAPP', 'PUSH', 'EMAIL'],
    audience: 'Staff',
    subject: 'New home care assignment · {requestNo}',
    body: 'Home care assignment — {requestNo}\nPatient: {patientName} ({age}/{gender})\nService: {serviceType}\nAddress: {address}\nTime: {date}, {slot}\nPhone: {patientPhone}\nNotes: {notes}\nPlease Accept in the app.',
  },
  {
    key: 'patient_en_route',
    name: 'Staff on the way',
    channel: ['WHATSAPP'],
    audience: 'Patient',
    subject: 'Your care team is on the way',
    body: '{staffName} ({designation}) is on the way to your home. — Unico Hospitals',
  },
  {
    key: 'patient_arrived',
    name: 'Staff arrived',
    channel: ['WHATSAPP'],
    audience: 'Patient',
    subject: 'Your care team has arrived',
    body: '{staffName} ({designation}) has arrived at your home. — Unico Hospitals',
  },
  {
    key: 'patient_completed',
    name: 'Visit completed · thank you',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Thank you · your home care visit is complete',
    body: 'Dear {patientName}, your home care visit ({requestNo}) is complete. Thank you for choosing Unico Hospitals.\nShare your feedback: {feedbackLink}',
  },
  {
    key: 'patient_rescheduled',
    name: 'Visit rescheduled',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your visit has been rescheduled · {requestNo}',
    body: 'Dear {patientName}, your home care visit ({requestNo}) has been rescheduled to {date}, {slot}. Call {hospitalPhone} if this time does not suit you.',
  },
  {
    key: 'patient_cancelled',
    name: 'Request cancelled',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your home care request was cancelled · {requestNo}',
    body: 'Dear {patientName}, your home care request ({requestNo}) has been cancelled. Call {hospitalPhone} if you need help.',
  },
  {
    key: 'dept_visit_report',
    name: 'Visit report (department)',
    channel: ['EMAIL'],
    audience: 'Department',
    subject: 'Visit report {requestNo} · {patientName} · {serviceType}',
    body: 'Visit report {requestNo}\nPatient: {patientName}\nService: {serviceType}\nStaff: {staffName}\nCheck-in {checkInAt} · Check-out {checkOutAt} · Duration {durationMin} min\nChecklist {doneCount}/{totalCount}\nNotes: {notes}',
  },
  {
    key: 'admin_escalation',
    name: 'Escalation alert',
    channel: ['PUSH', 'EMAIL'],
    audience: 'Admin',
    subject: 'Escalation · {requestNo} still unaccepted',
    body: '{requestNo} still unaccepted after {minutes} min ({staffName} declined: {reason}). Next candidate: {nextStaff}.',
  },
  {
    key: 'admin_daily_digest',
    name: 'Daily digest',
    channel: ['EMAIL'],
    audience: 'Admin',
    subject: 'Home care daily digest · {date}',
    body: '{notes}',
  },
  {
    key: 'auth_code',
    name: 'Sign-in / reset code',
    channel: ['EMAIL'],
    audience: 'Staff',
    subject: 'Your Unico HomeCare code: {code}',
    body: 'Your one-time code is {code}. It expires in 10 minutes. If you did not request it, ignore this email.',
  },
]

export function renderText(tpl: string, vars: Record<string, unknown>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null || vars[k] === '' ? (k === 'notes' ? '—' : m) : String(vars[k])))
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Branded email shell (E1). Inline styles only, for email clients. */
export function emailShell(opts: { title: string; bodyText: string; cta?: { label: string; url: string }; footer?: string; preheader?: string }) {
  const base = process.env.APP_BASE_URL ?? ''
  const paragraphs = esc(opts.bodyText)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#334155">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#F1F5F9;font-family:'DM Sans',Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${esc(opts.preheader ?? '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08)">
<tr><td style="padding:20px 28px;border-bottom:3px solid #0090CA"><img src="${base}/logo.svg" alt="Unico Hospitals" height="36" style="display:block;height:36px"></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#0F172A">${esc(opts.title)}</h1>
${paragraphs}
${opts.cta ? `<a href="${opts.cta.url}" style="display:inline-block;background:#0090CA;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;margin-top:6px">${esc(opts.cta.label)}</a>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;background:#F8FAFC;font-size:12px;line-height:18px;color:#64748B">${esc(opts.footer ?? 'Unico Hospitals PLC · Family Medicine · Home Care · Dhaka')}<br>This is an automated message from Unico HomeCare.</td></tr>
</table></td></tr></table></body></html>`
}
