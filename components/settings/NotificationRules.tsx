'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, Save, Send } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Rules = Record<string, Record<string, string[]>>
const CHANNELS = [
  { key: 'inapp', label: 'In-app' },
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp' },
] as const

const RECIPIENT: Record<string, { label: string; allowed: string[] }> = {
  HC_ADMIN: { label: 'HC_ADMIN', allowed: ['inapp', 'push', 'email', 'whatsapp'] },
  FRONT_DESK: { label: 'Front desk', allowed: ['inapp', 'push', 'email', 'whatsapp'] },
  STAFF: { label: 'Staff', allowed: ['inapp', 'push', 'email', 'whatsapp'] },
  DOCTOR: { label: 'On-call doctor', allowed: ['inapp', 'push', 'email', 'whatsapp'] },
  DRIVER: { label: 'Driver', allowed: ['inapp', 'push', 'whatsapp'] },
  PATIENT: { label: 'Patient', allowed: ['email', 'whatsapp'] },
  DEPARTMENT: { label: 'Department', allowed: ['email'] },
  VIEWER: { label: 'VIEWER', allowed: ['inapp', 'email'] },
}

/** Event rows (plan §5.7). `defaults` fills events that are not in settings yet. */
export const EVENTS: { key: string; label: string; recipients: string[]; defaults?: Record<string, string[]>; tpl?: Record<string, string> }[] = [
  { key: 'REQUEST_CREATED', label: 'Request created', recipients: ['HC_ADMIN'] },
  { key: 'CONFIRMED', label: 'Confirmed', recipients: ['PATIENT', 'FRONT_DESK'], tpl: { PATIENT: 'patient_confirmed' } },
  { key: 'ASSIGNED', label: 'Assigned', recipients: ['STAFF', 'PATIENT', 'HC_ADMIN'], tpl: { STAFF: 'staff_assigned', PATIENT: 'patient_assigned' } },
  { key: 'ACCEPTED', label: 'Accepted', recipients: ['HC_ADMIN'] },
  { key: 'DECLINED', label: 'Declined / timeout', recipients: ['HC_ADMIN'], tpl: { HC_ADMIN: 'admin_escalation' } },
  { key: 'REMINDER', label: 'Reminder T-2 h · T-30 min', recipients: ['STAFF', 'PATIENT'] },
  { key: 'EN_ROUTE', label: 'En route', recipients: ['PATIENT', 'HC_ADMIN'], tpl: { PATIENT: 'patient_en_route' } },
  { key: 'CHECK_IN', label: 'Check-in', recipients: ['PATIENT', 'HC_ADMIN'], tpl: { PATIENT: 'patient_arrived' } },
  { key: 'ABNORMAL_VITALS', label: 'Abnormal vitals', recipients: ['HC_ADMIN', 'DOCTOR'] },
  { key: 'COMPLETED', label: 'Completed + report', recipients: ['HC_ADMIN', 'PATIENT', 'DEPARTMENT'], tpl: { PATIENT: 'patient_completed', DEPARTMENT: 'dept_visit_report' } },
  { key: 'OVERDUE', label: 'Overdue check-in', recipients: ['STAFF', 'HC_ADMIN'] },
  { key: 'RESCHEDULED', label: 'Rescheduled', recipients: ['STAFF', 'PATIENT'], tpl: { PATIENT: 'patient_rescheduled' } },
  { key: 'CANCELLED', label: 'Cancelled', recipients: ['STAFF', 'PATIENT'], tpl: { PATIENT: 'patient_cancelled' } },
  { key: 'TRANSPORT_ASSIGNED', label: 'Transport assigned', recipients: ['DRIVER', 'STAFF'], defaults: { DRIVER: ['inapp', 'push'], STAFF: ['inapp'] } },
  { key: 'PETTY_CASH', label: 'Petty cash decision', recipients: ['STAFF'], defaults: { STAFF: ['inapp', 'push'] } },
  { key: 'DAILY_DIGEST', label: 'Daily digest 20:00', recipients: ['HC_ADMIN', 'VIEWER'], tpl: { HC_ADMIN: 'admin_daily_digest', VIEWER: 'admin_daily_digest' } },
]
const LOCKED = (ev: string, r: string, ch: string) => ev === 'ASSIGNED' && r === 'STAFF' && ch === 'push'

function Mini({ on, onChange, disabled, locked, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; locked?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={locked ? 'Push for assignments cannot be switched off' : label}
      disabled={disabled || locked}
      onClick={() => onChange(!on)}
      className={cx('relative h-[22px] w-[38px] flex-none rounded-full transition', on ? 'bg-primary' : 'bg-slate-300', locked && 'cursor-not-allowed opacity-70', disabled && !locked && 'opacity-40')}
    >
      <span className={cx('absolute top-[3px] size-4 rounded-full bg-white shadow transition-all', on ? 'left-[19px]' : 'left-[3px]')} />
      {locked && <Lock size={9} className="absolute left-[23px] top-[6.5px] text-primary" />}
    </button>
  )
}

export function NotificationRules({ initial, quiet, integrations, myEmail }: { initial: Rules; quiet: { from: string; to: string; enabled?: boolean }; integrations: { gmail: boolean; cron: boolean }; myEmail?: string }) {
  const router = useRouter()
  const toast = useToast()
  const start = useMemo(() => {
    const r: Rules = {}
    for (const e of EVENTS) {
      r[e.key] = {}
      for (const rc of e.recipients) r[e.key][rc] = [...(initial[e.key]?.[rc] ?? e.defaults?.[rc] ?? [])]
      if (e.key === 'ASSIGNED' && !r[e.key].STAFF.includes('push')) r[e.key].STAFF.push('push')
    }
    return r
  }, [initial])
  const [rules, setRules] = useState<Rules>(start)
  const [q, setQ] = useState({ from: quiet.from ?? '22:00', to: quiet.to ?? '07:00', enabled: quiet.enabled !== false })
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('')
  const dirty = JSON.stringify(rules) !== JSON.stringify(start) || q.from !== quiet.from || q.to !== quiet.to || q.enabled !== (quiet.enabled !== false)

  const set = (ev: string, rc: string, ch: string, on: boolean) =>
    setRules((prev) => {
      const cur = prev[ev][rc] ?? []
      const next = on ? [...new Set([...cur, ch])] : cur.filter((c) => c !== ch)
      return { ...prev, [ev]: { ...prev[ev], [rc]: next } }
    })

  async function save() {
    setBusy('save')
    try {
      await api('/settings', { method: 'PATCH', body: { key: 'notificationRules', value: rules } })
      await api('/settings', { method: 'PATCH', body: { key: 'quietHours', value: q } })
      toast('Notification rules saved', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Could not save', 'err')
    } finally {
      setBusy('')
    }
  }

  async function testMe() {
    if (!myEmail) return toast('Add an email to your account first', 'err')
    setBusy('test')
    try {
      const r = await api<{ configured: boolean }>('/settings', { body: { test: 'email', to: myEmail } })
      toast(r.configured ? `Test email queued to ${myEmail}` : 'Test logged as SKIPPED — Gmail is not configured', r.configured ? 'ok' : 'info')
    } catch (e: any) {
      toast(e?.message ?? 'Test failed', 'err')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex gap-1 border-b border-slate-200">
          {[
            ['#rules', 'Rules'],
            ['#roles', 'Per-role defaults'],
            ['#quiet', 'Quiet hours & batching'],
            ['#delivery', 'Delivery & retries'],
          ].map(([h, l], i) => (
            <a key={h} href={h} className={cx('-mb-px flex h-10 items-center px-3.5 text-sm font-semibold', i === 0 ? 'border-b-2 border-primary text-primary-700' : 'text-slate-500 hover:text-slate-700')}>
              {l}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <button type="button" onClick={testMe} disabled={busy === 'test'} className={btnClass('o', 'md')}>
          {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Test email to me
        </button>
        <button type="button" onClick={save} disabled={!dirty || !!busy} className={btnClass(dirty ? 'p' : 'd', 'md')}>
          {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save rules
        </button>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div id="rules" className="overflow-hidden rounded-card bg-white shadow-card">
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid h-11 grid-cols-[minmax(150px,1.3fr)_minmax(110px,1fr)_repeat(4,78px)_70px] items-center border-b border-slate-200 bg-slate-50 px-5 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500">
                <div>Event</div>
                <div>Recipient</div>
                {CHANNELS.map((c) => (
                  <div key={c.key} className="text-center">
                    {c.label}
                  </div>
                ))}
                <div className="text-center">Template</div>
              </div>
              {EVENTS.map((e) => (
                <div key={e.key} className="border-t border-slate-100 px-5 py-1.5 first:border-t-0">
                  {e.recipients.map((rc, i) => (
                    <div key={rc} className="grid min-h-9 grid-cols-[minmax(150px,1.3fr)_minmax(110px,1fr)_repeat(4,78px)_70px] items-center">
                      <div className="pr-3 text-[13.5px] font-semibold">{i === 0 ? e.label : ''}</div>
                      <div className="text-[13px] text-slate-500">{RECIPIENT[rc]?.label ?? rc}</div>
                      {CHANNELS.map((c) => {
                        const allowed = RECIPIENT[rc]?.allowed.includes(c.key) ?? true
                        const on = rules[e.key]?.[rc]?.includes(c.key) ?? false
                        return (
                          <div key={c.key} className="flex justify-center">
                            {allowed ? <Mini on={on} locked={LOCKED(e.key, rc, c.key)} onChange={(v) => set(e.key, rc, c.key, v)} label={`${e.label} · ${rc} · ${c.label}`} /> : <span className="text-slate-300">—</span>}
                          </div>
                        )
                      })}
                      <div className="text-center">
                        {e.tpl?.[rc] ? (
                          <Link href={`/settings/templates?key=${e.tpl[rc]}`} className="text-[13px] font-semibold text-primary-700 hover:underline">
                            Edit
                          </Link>
                        ) : (
                          <span className="text-[12px] text-slate-300">—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500">
            <span>Push for “Assigned” cannot be switched off by users.</span>
            <span>Patients get WhatsApp / email only. WhatsApp = deep link now, Cloud API in Phase 3.</span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <section id="quiet" className="rounded-card bg-white p-5 shadow-card">
            <div className="text-[15px] font-bold">Quiet hours</div>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex-1 text-[13.5px]">Batch non-urgent notifications</span>
              <Toggle on={q.enabled} onChange={(v) => setQ({ ...q, enabled: v })} label="Batch non-urgent notifications" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="hc-label">From</label>
                <input type="time" className="hc-input" value={q.from} disabled={!q.enabled} onChange={(e) => setQ({ ...q, from: e.target.value })} />
              </div>
              <div>
                <label className="hc-label">Until</label>
                <input type="time" className="hc-input" value={q.to} disabled={!q.enabled} onChange={(e) => setQ({ ...q, to: e.target.value })} />
              </div>
            </div>
            <div className="mt-2 text-[12.5px] text-slate-500">Urgent, emergency, escalation and overdue always go through.</div>
          </section>

          <section id="delivery" className="rounded-card bg-white p-5 shadow-card">
            <div className="mb-2 text-[15px] font-bold">Delivery & retries</div>
            {[
              ['Retry failed sends', 'Manual · Resend from Messages log'],
              ['Automatic retries', '3× · 2, 5, 15 min (Phase 2)'],
              ['Email provider', integrations.gmail ? 'Gmail SMTP · app password' : 'Gmail · not configured'],
              ['Push provider', 'In-app centre · Expo push in Phase 2'],
              ['Fallback', 'Every alert also lands in-app'],
              ['Scheduled jobs', integrations.cron ? 'Vercel Cron · configured' : 'Cron secret not set'],
              ['Log retention', 'message_logs · 7 years'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-1.5 text-[13px]">
                <span className="text-slate-500">{k}</span>
                <span className="text-right font-semibold">{v}</span>
              </div>
            ))}
          </section>

          <section id="roles" className="rounded-card bg-white p-5 shadow-card">
            <div className="mb-3 text-[15px] font-bold">Per-role defaults</div>
            <div className="flex flex-col gap-2">
              {[
                ['NURSE / DOCTOR / ALLIED', 'Push + in-app · WhatsApp for assignments'],
                ['HC_ADMIN', 'Everything · email digest 20:00'],
                ['TRANSPORT_SUPERVISOR / DRIVER', 'Push for trips · in-app'],
                ['FRONT_DESK', 'In-app · email on confirmation'],
                ['VIEWER', 'Email digest only'],
              ].map(([r, d]) => (
                <div key={r} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="w-[120px] flex-none font-mono text-[10.5px] font-bold leading-tight text-slate-700">{r}</span>
                  <span className="flex-1 text-right text-[13px] text-slate-600">{d}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[12px] text-slate-500">Users can switch off push / email / WhatsApp in their account, except push for assignments.</div>
          </section>
        </div>
      </div>
    </div>
  )
}
