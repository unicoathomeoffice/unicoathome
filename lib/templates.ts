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
  'uhid', // the patient's hospital UHID — a line with an empty {uhid} is left out
  'uhidTag', // " · UHID 1234567" after a name, or nothing
  'tests', // the tests on the request (H360 picks + typed) — a line with empty {tests} is left out
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
  'loginLink',
  'priority',
  'requestLink',
  'trackLink',
  'summary',
  'invoiceNo',
  'total',
  'paid',
  'due',
  'vehicle',
  'driverName',
  'driverPhone',
  'pickupTime',
  'returnTime',
  'eventTime',
  'transportMode',
  'amount',
  'cashCounter',
  'update',
  'team',
  'area',
] as const

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    key: 'patient_received',
    name: 'Request received (website)',
    channel: ['EMAIL', 'WHATSAPP'],
    audience: 'Patient',
    subject: 'We received your home care request · {requestNo}',
    body: 'Respected Sir/Madam, thank you — we received your home care request.\nService: {serviceType}\nPreferred time: {date}, {slot}\nAddress: {address}\nOur Home Care coordinator will call you shortly to confirm. Need help sooner? Call {hospitalPhone}.\n— Unico Hospitals, Family Medicine',
  },
  {
    key: 'staff_approved',
    name: 'Staff account approved',
    channel: ['EMAIL'],
    audience: 'Staff',
    subject: 'Your Unico HomeCare account is approved',
    body: 'Respected Sir/Madam, your Unico HomeCare account has been approved ({designation}).\nSign in with your Google account at {loginLink}\nWelcome to the Home Care team.\n— Unico Hospitals, Family Medicine',
  },
  {
    key: 'patient_confirmed',
    name: 'Request confirmed',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your home care visit is confirmed · {requestNo}',
    body: 'Respected Sir/Madam, your home care request is confirmed.\nService: {serviceType}\nTests: {tests}\nTime: {date}, {slot}\nOur team will arrive at the scheduled time. Need help? Call {hospitalPhone}.\n— Unico Hospitals, Family Medicine',
  },
  {
    key: 'patient_assigned',
    name: 'Team assigned (patient)',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your care team for {requestNo}',
    body: 'Respected Sir/Madam, {staffName} ({designation}) has been assigned to your visit.\nTime: {date}, {slot}.\n— Unico Hospitals, Family Medicine',
  },
  {
    key: 'staff_assigned',
    name: 'Assignment notice (staff)',
    channel: ['WHATSAPP', 'PUSH', 'EMAIL'],
    audience: 'Staff',
    subject: 'New home care assignment · {requestNo}',
    body: 'New home care assignment\nPatient: {patientName} ({age}/{gender})\nUHID: {uhid}\nService: {serviceType}\nTests: {tests}\nAddress: {address}\nTime: {date}, {slot}\nPhone: {patientPhone}\nNotes: {notes}\nPlease Accept in the app.',
  },
  {
    key: 'staff_rescheduled',
    name: 'Visit rescheduled (staff)',
    channel: ['WHATSAPP'],
    audience: 'Staff',
    subject: 'Visit rescheduled · {requestNo}',
    body: 'Respected Sir/Madam, the home visit for {patientName} ({serviceType}) has moved to {date}, {slot}.\nUHID: {uhid}\nReason: {reason}\nIt will be assigned again — watch the app.\n— Unico HomeCare',
  },
  {
    key: 'staff_cancelled',
    name: 'Visit cancelled (staff / driver)',
    channel: ['WHATSAPP'],
    audience: 'Staff',
    subject: 'Visit cancelled · {requestNo}',
    body: 'Respected Sir/Madam, the home visit for {patientName} on {date}, {slot} is cancelled.\nUHID: {uhid}\nReason: {reason}\n— Unico HomeCare',
  },
  {
    key: 'patient_en_route',
    name: 'Staff on the way',
    channel: ['WHATSAPP'],
    audience: 'Patient',
    subject: 'Your care team is on the way',
    body: '{staffName} ({designation}) is on the way to your home.\nTrack live: {trackLink}\n— Unico Hospitals',
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
    body: 'Respected Sir/Madam, your home care visit is complete. Thank you for choosing Unico Hospitals.\nShare your feedback: {feedbackLink}',
  },
  {
    key: 'patient_rescheduled',
    name: 'Visit rescheduled',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your visit has been rescheduled · {requestNo}',
    body: 'Respected Sir/Madam, your home care visit has been rescheduled to {date}, {slot}. Call {hospitalPhone} if this time does not suit you.',
  },
  {
    key: 'patient_cancelled',
    name: 'Request cancelled',
    channel: ['WHATSAPP', 'EMAIL'],
    audience: 'Patient',
    subject: 'Your home care request was cancelled · {requestNo}',
    body: 'Respected Sir/Madam, your home care request has been cancelled. Call {hospitalPhone} if you need help.',
  },
  {
    key: 'dept_visit_report',
    name: 'Visit report (department)',
    channel: ['EMAIL'],
    audience: 'Department',
    subject: 'Visit report {requestNo} · {patientName} · {serviceType}',
    body: 'Visit report {requestNo}\nPatient: {patientName}\nUHID: {uhid}\nService: {serviceType}\nTests: {tests}\nStaff: {staffName}\nCheck-in {checkInAt} · Check-out {checkOutAt} · Duration {durationMin} min\nChecklist {doneCount}/{totalCount}\nNotes: {notes}',
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
    key: 'hod_new_request',
    name: 'New request → head of department',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'New home care request · {requestNo}',
    body: 'Respected Sir/Madam, a new home care request needs assignment.\nPriority: {priority}\nService: {serviceType}\nTests: {tests}\nPatient: {patientName} ({age}/{gender}) · {patientPhone}\nUHID: {uhid}\nAddress: {address}\nPreferred: {date}, {slot}\nOpen: {requestLink}\n— Unico HomeCare',
  },
  {
    key: 'car_requested',
    name: 'Car requested → Security / Transport',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'Unico car requested · {requestNo}',
    body: 'Unico car requested · {patientName}{uhidTag}\nVisit: {date}, {slot}\nTo: {address}\nService: {serviceType}\nTests: {tests}\nOpen: {requestLink}\n— Unico HomeCare',
  },
  {
    key: 'car_allotted',
    name: 'Car allotted → Security / Transport',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'Car allotted · {requestNo}',
    body: 'Car allotted · {patientName}{uhidTag}\nVehicle: {vehicle}\nDriver: {driverName} {driverPhone}\nPick-up at hospital {pickupTime} · back about {returnTime}\nVisit: {date}, {slot}\nTo: {address}\n— Unico HomeCare',
  },
  {
    key: 'car_changed',
    name: 'Trip time changed → Security / Transport',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'Trip time changed · {requestNo}',
    body: 'UPDATED trip time · {patientName}{uhidTag}\nNew visit time: {date}, {slot}\nVehicle: {vehicle} · driver {driverName}\nTo: {address}\n— Unico HomeCare',
  },
  {
    key: 'car_cancelled',
    name: 'Trip cancelled → Security / Transport',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'Trip cancelled · {requestNo}',
    body: 'Trip CANCELLED · {patientName}{uhidTag}\nThe home visit on {date} ({slot}) is cancelled — the car is not needed.\nVehicle: {vehicle} · driver {driverName}\nReason: {reason}\n— Unico HomeCare',
  },
  {
    key: 'car_own',
    name: 'No car · own transport → Security / Transport',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'No hospital car · {requestNo}',
    body: 'No hospital car for the visit to {patientName}{uhidTag} — the team goes by {transportMode}.\nVisit: {date}, {slot}\nTo: {address}\nPetty cash: {amount} given\n— Unico HomeCare',
  },
  {
    key: 'petty_cash',
    name: 'Petty cash given → staff',
    channel: ['WHATSAPP'],
    audience: 'Staff',
    subject: 'Petty cash {amount} · {requestNo}',
    body: 'Respected Sir/Madam, petty cash {amount} is approved for your transport ({transportMode}) to the home visit on {date}, {slot}.\nTo: {address}\nCollect it from {cashCounter} with the voucher attached.\n— Unico HomeCare',
  },
  {
    key: 'car_out',
    name: 'Car left hospital → Security / Transport',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'Car left the hospital · {requestNo}',
    body: 'Car left the hospital at {eventTime} · {patientName}{uhidTag}\nVehicle: {vehicle} · driver {driverName}\nTo: {address}\nExpected back about {returnTime}\n— Unico HomeCare',
  },
  {
    key: 'car_back',
    name: 'Car back at hospital → Security / Transport',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'Car back at the hospital · {requestNo}',
    body: 'Car back at the hospital at {eventTime} · {patientName}{uhidTag}\nVehicle: {vehicle} · driver {driverName}\n— Unico HomeCare',
  },
  {
    key: 'visit_live',
    name: 'Live update at every step → Live updates group',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: '{requestNo} · live update',
    body: '{update}\nPatient: {patientName}{uhidTag} · {area}\nService: {serviceType}\nTests: {tests}\nTeam: {team}\nOpen: {requestLink}\n— Unico HomeCare',
  },
  {
    key: 'visit_update',
    name: 'Visit update (short summary)',
    channel: ['WHATSAPP'],
    audience: 'Department',
    subject: 'Visit update · {requestNo}',
    body: '{summary}\n— Unico HomeCare',
  },
  {
    key: 'patient_visit_summary',
    name: 'Visit summary for the patient',
    channel: ['WHATSAPP'],
    audience: 'Patient',
    subject: 'Your home visit summary · {requestNo}',
    body: '{summary}\nQuestions? Call {hospitalPhone}.\n— Unico Hospitals, Family Medicine',
  },
  {
    key: 'daily_summary',
    name: 'Daily WhatsApp summary',
    channel: ['WHATSAPP'],
    audience: 'Admin',
    subject: 'Home care · daily summary',
    body: '{summary}',
  },
  {
    key: 'patient_bill',
    name: 'Bill copy to patient',
    channel: ['WHATSAPP'],
    audience: 'Patient',
    subject: 'Your bill · {invoiceNo}',
    body: 'Respected Sir/Madam, here is your bill for your home care visit (invoice {invoiceNo}).\nUHID: {uhid}\nTotal {total} · Paid {paid} · Due {due}\nQuestions? Call {hospitalPhone}.\n— Unico Hospitals',
  },
  {
    key: 'staff_bill',
    name: 'Bill copy to care team',
    channel: ['WHATSAPP'],
    audience: 'Staff',
    subject: 'Bill copy · {requestNo}',
    body: 'Bill copy · {patientName}{uhidTag}\nInvoice {invoiceNo} · Total {total} · Paid {paid} · Due {due}\n— Unico HomeCare',
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

const empty = (v: unknown) => v == null || v === ''
/** Fill {placeholders}. Optional ones: a line with an empty {uhid} / {tests} is left out; an empty {uhidTag} is nothing. */
const LINE_OPTIONAL = ['uhid', 'tests']
export function renderText(tpl: string, vars: Record<string, unknown>) {
  return tpl
    .split('\n')
    .filter((line) => !LINE_OPTIONAL.some((k) => line.includes(`{${k}}`) && empty(vars[k])))
    .join('\n')
    .replace(/\{(\w+)\}/g, (m, k) => (empty(vars[k]) ? (k === 'notes' ? '—' : k === 'uhidTag' ? '' : m) : String(vars[k])))
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Branded email shell (E1). Inline styles only, for email clients. */
export function emailShell(opts: { title: string; bodyText: string; cta?: { label: string; url: string }; footer?: string; preheader?: string }) {
  // same origin rule as lib/links.ts baseUrl() (this module is also used by client components, so no server import)
  const base = (process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '')
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
