'use client'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Play, Save, Send, XCircle } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { MsgStatus } from '@/components/comms/MessageBits'
import { cx } from '@/lib/format'

// W15 editable cards. Each saves one settings key with PATCH /api/v1/settings {key, value}.

function useSave(key: string) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const save = async (value: Record<string, unknown>, msg = 'Saved') => {
    setBusy(true)
    try {
      await api('/settings', { method: 'PATCH', body: { key, value } })
      toast(msg, 'ok')
      router.refresh()
      return true
    } catch (e: any) {
      toast(e?.message ?? 'Could not save', 'err')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { save, busy }
}

export function SCard({ title, sub, right, children, className, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('flex flex-col rounded-card bg-white p-5 shadow-card', className)}>
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">{title}</div>
          {sub && <div className="mt-0.5 text-[12.5px] text-slate-500">{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function SaveBtn({ busy, onClick, disabled }: { busy: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={btnClass(disabled ? 'd' : 'p', 'md')}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
    </button>
  )
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex-1 text-[13.5px] text-slate-700">{label}</div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- General
type General = { hospitalName: string; department: string; hospitalPhone: string; address: string; workingHours: { from: string; to: string }; slots: string[] }
export function GeneralCard({ initial }: { initial: General }) {
  const [v, setV] = useState(initial)
  const { save, busy } = useSave('general')
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  return (
    <SCard title="General" sub="Hospital info, working hours">
      <label className="hc-label">Hospital name</label>
      <input className="hc-input" value={v.hospitalName} onChange={(e) => setV({ ...v, hospitalName: e.target.value })} />
      <label className="hc-label mt-3">Department</label>
      <input className="hc-input" value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })} />
      <label className="hc-label mt-3">Hospital phone (hotline in messages)</label>
      <input className="hc-input" value={v.hospitalPhone} onChange={(e) => setV({ ...v, hospitalPhone: e.target.value })} />
      <label className="hc-label mt-3">Address</label>
      <input className="hc-input" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
      <div className="mt-3">
        <div>
          <label className="hc-label">Working hours · Asia/Dhaka</label>
          <div className="flex items-center gap-1.5">
            <input type="time" className="hc-input px-2" value={v.workingHours.from} onChange={(e) => setV({ ...v, workingHours: { ...v.workingHours, from: e.target.value } })} />
            <span className="text-slate-400">–</span>
            <input type="time" className="hc-input px-2" value={v.workingHours.to} onChange={(e) => setV({ ...v, workingHours: { ...v.workingHours, to: e.target.value } })} />
          </div>
        </div>
      </div>
      <div className="hc-label mt-3">Visit slots</div>
      <div className="flex flex-wrap items-center gap-2">
        {v.slots.map((s) => (
          <span key={s} className="rounded-full bg-slate-100 px-3 py-1 text-[13px] font-semibold text-slate-700">
            {s}
          </span>
        ))}
        <Link href="/settings/zones" className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-[13px] font-semibold text-primary-700">
          Edit slots
        </Link>
      </div>
      <div className="mt-auto pt-4">
        <SaveBtn busy={busy} disabled={!dirty} onClick={() => save({ hospitalName: v.hospitalName, department: v.department, hospitalPhone: v.hospitalPhone, address: v.address, workingHours: v.workingHours }, 'General settings saved')} />
      </div>
    </SCard>
  )
}

// ---------------------------------------------------------------- Gmail
type Email = { fromName: string; replyTo: string; departmentCc: string[]; sendPatientEmails: boolean; sendDepartmentReport: boolean; dailyDigest: boolean }
export function GmailCard({
  initial,
  gmail,
  lastSend,
  myEmail,
}: {
  initial: Email
  gmail: { configured: boolean; user: string | null }
  lastSend: { at: string; label: string; status: string; id: string } | null
  myEmail?: string
}) {
  const toast = useToast()
  const [v, setV] = useState({ ...initial, cc: initial.departmentCc.join(', ') })
  const { save, busy } = useSave('email')
  const [to, setTo] = useState(myEmail ?? '')
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ id: string; status: string; error?: string } | null>(null)
  const cc = v.cc
    .split(/[,\s;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const badCc = cc.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
  const dirty = JSON.stringify({ ...v, cc: undefined, departmentCc: cc }) !== JSON.stringify({ ...initial, cc: undefined })

  async function sendTest() {
    if (!to) return toast('Enter an address for the test email', 'err')
    setTesting(true)
    setTest(null)
    try {
      const r = await api<{ id: string }>('/settings', { body: { test: 'email', to } })
      setTest({ id: r.id, status: 'QUEUED' })
      for (let i = 0; i < 6; i++) {
        await new Promise((res) => setTimeout(res, 1000))
        const m = await api<{ message: any }>(`/messages/${r.id}`).catch(() => null)
        if (m?.message) {
          setTest({ id: r.id, status: m.message.status, error: m.message.error })
          if (m.message.status !== 'QUEUED') break
        }
      }
    } catch (e: any) {
      toast(e?.message ?? 'Test failed', 'err')
    } finally {
      setTesting(false)
    }
  }

  return (
    <SCard
      title="Gmail"
      sub="Department mailbox for confirmations and reports"
      right={
        gmail.configured ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#DCFCE7] px-2 text-[11px] font-bold text-[#15803D]">
            <CheckCircle2 size={13} /> CONNECTED
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#FFEDD5] px-2 text-[11px] font-bold text-[#C2410C]">
            <XCircle size={13} /> NOT CONFIGURED
          </span>
        )
      }
    >
      <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px] text-[12.5px] font-semibold">
        <div className="flex h-8 flex-1 items-center justify-center rounded-lg bg-slate-900 text-white">A · SMTP + App Password</div>
        <div className="flex h-8 flex-1 items-center justify-center rounded-lg text-slate-500" title="Option B (Gmail API + OAuth2) can be added later">
          B · Gmail API OAuth2
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[13px]">
        <span className="text-slate-500">Sending account</span>
        <span className="font-mono font-semibold">{gmail.user ?? '— set GMAIL_USER'}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span className="text-slate-500">App password</span>
        <span className="font-mono font-semibold">{gmail.configured ? '•••• •••• •••• ••••' : '— set GMAIL_APP_PASSWORD'}</span>
      </div>
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span className="text-slate-500">Last send</span>
        {lastSend ? (
          <Link href={`/messages?channel=EMAIL&id=${lastSend.id}`} className="flex items-center gap-1.5 font-semibold text-slate-700 hover:underline">
            {lastSend.label} <MsgStatus status={lastSend.status} />
          </Link>
        ) : (
          <span className="text-slate-400">never</span>
        )}
      </div>
      <label className="hc-label mt-3">From name</label>
      <input className="hc-input" value={v.fromName} onChange={(e) => setV({ ...v, fromName: e.target.value })} />
      <label className="hc-label mt-3">Reply-to</label>
      <input className="hc-input" type="email" value={v.replyTo} placeholder="homecare@unicohospitals.com" onChange={(e) => setV({ ...v, replyTo: e.target.value })} />
      <label className="hc-label mt-3">Department CC (visit reports)</label>
      <input className={cx('hc-input', badCc.length > 0 && 'border-[#DC2626]')} value={v.cc} placeholder="familymedicine@unicohospitals.com" onChange={(e) => setV({ ...v, cc: e.target.value })} />
      {badCc.length > 0 && <div className="mt-1 text-[12px] text-[#B91C1C]">Not an email: {badCc.join(', ')}</div>}
      <div className="mt-3">
        <Row label="Send patient emails">
          <Toggle on={v.sendPatientEmails} onChange={(x) => setV({ ...v, sendPatientEmails: x })} label="Send patient emails" />
        </Row>
        <Row label="Email visit report to department">
          <Toggle on={v.sendDepartmentReport} onChange={(x) => setV({ ...v, sendDepartmentReport: x })} label="Department report" />
        </Row>
        <Row label="Daily digest 20:00">
          <Toggle on={v.dailyDigest} onChange={(x) => setV({ ...v, dailyDigest: x })} label="Daily digest" />
        </Row>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3">
        <label className="hc-label">Send test email to</label>
        <div className="flex gap-2">
          <input className="hc-input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@unicohospitals.com" />
          <button type="button" onClick={sendTest} disabled={testing} className={btnClass('o', 'md')}>
            {testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send test
          </button>
        </div>
        {test && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
            <MsgStatus status={test.status} />
            <span>
              {test.status === 'SKIPPED'
                ? 'Logged but not sent — Gmail is not configured.'
                : test.status === 'FAILED'
                  ? test.error
                  : test.status === 'QUEUED'
                    ? 'Still sending…'
                    : 'Sent — check the inbox.'}
            </span>
            <Link href={`/messages?channel=EMAIL&id=${test.id}`} className="font-semibold text-primary-700 underline">
              View in Messages log
            </Link>
          </div>
        )}
      </div>
      <div className="mt-auto pt-4">
        <SaveBtn
          busy={busy}
          disabled={!dirty || badCc.length > 0}
          onClick={() => save({ fromName: v.fromName, replyTo: v.replyTo, departmentCc: cc, sendPatientEmails: v.sendPatientEmails, sendDepartmentReport: v.sendDepartmentReport, dailyDigest: v.dailyDigest }, 'Email settings saved')}
        />
      </div>
    </SCard>
  )
}

// ---------------------------------------------------------------- WhatsApp
export function WhatsAppCard({ initial, envCountry }: { initial: { defaultCountry: string; mode: string }; envCountry: string }) {
  const [cc, setCc] = useState(initial.defaultCountry)
  const { save, busy } = useSave('whatsapp')
  return (
    <SCard title="WhatsApp" sub="Deep link now · Cloud API in Phase 3">
      <div className="flex items-center justify-between py-1 text-[13.5px]">
        <span className="text-slate-500">Mode</span>
        <span className="font-semibold">Deep link (wa.me)</span>
      </div>
      <div className="py-1 text-[12.5px] text-slate-500">Staff tap “WhatsApp” → the message opens pre-filled on their phone → they tap Send and confirm “I sent it”. Every message is logged.</div>
      <label className="hc-label mt-3">Default country code</label>
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold text-slate-500">+</span>
        <input className="hc-input" inputMode="numeric" value={cc} onChange={(e) => setCc(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="mt-1 text-[12px] text-slate-500">Server default (WA_DEFAULT_COUNTRY): +{envCountry}</div>
      <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
        <span className="text-[13.5px] font-semibold">Cloud API</span>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-600">Phase 3 · not connected</span>
      </div>
      <div className="mt-2 text-[12px] leading-[18px] text-slate-500">Requires Meta Business verification for Unico Hospitals PLC and a dedicated number. Token and phone ID will live in Vercel env vars.</div>
      <div className="mt-auto pt-4">
        <SaveBtn busy={busy} disabled={cc === initial.defaultCountry || !cc} onClick={() => save({ defaultCountry: cc, mode: 'deeplink' }, 'WhatsApp settings saved')} />
      </div>
    </SCard>
  )
}

// ---------------------------------------------------------------- Features
const FEATURES: { key: string; label: string; note?: string }[] = [
  { key: 'autoAssign', label: 'Auto-assign ROUTINE requests', note: 'Phase 4' },
  { key: 'gpsRequiredCheckIn', label: 'GPS required at check-in' },
  { key: 'otpConfirmation', label: 'OTP patient confirmation' },
  { key: 'transportModule', label: 'Transport module (cars & drivers)' },
  { key: 'pettyCash', label: 'Petty cash requests' },
]
export function FeaturesCard({ initial }: { initial: Record<string, boolean> }) {
  const [v, setV] = useState(initial)
  const { save } = useSave('features')
  return (
    <SCard title="Feature toggles" sub="Read at request time; every change is audited">
      {FEATURES.map((f) => (
        <Row
          key={f.key}
          label={
            <>
              {f.label}
              {f.note && <div className="text-[11.5px] text-slate-400">{f.note}</div>}
            </>
          }
        >
          <Toggle
            on={!!v[f.key]}
            label={f.label}
            onChange={async (x) => {
              setV({ ...v, [f.key]: x })
              const ok = await save({ [f.key]: x }, `${f.label}: ${x ? 'on' : 'off'}`)
              if (!ok) setV((p) => ({ ...p, [f.key]: !x }))
            }}
          />
        </Row>
      ))}
    </SCard>
  )
}

// ---------------------------------------------------------------- Scheduled jobs
const JOBS = [
  { job: 'sweep', label: 'Run sweep now', desc: 'Acceptance timeouts → back to Confirmed + escalation; overdue check-in alerts' },
  { job: 'reminders', label: 'Send reminders now', desc: 'T-2 h and T-30 min reminders to assigned staff' },
  { job: 'digest', label: 'Send daily digest now', desc: 'Today’s summary email to coordinators and management' },
] as const
export function JobsCard({ cron, schedules }: { cron: boolean; schedules: { path: string; when: string }[] }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [last, setLast] = useState<Record<string, string>>({})
  return (
    <SCard
      title="Scheduled jobs"
      sub="Vercel Cron calls /api/v1/jobs/* with CRON_SECRET"
      right={
        <span className={cx('inline-flex h-6 items-center rounded-full px-2 text-[11px] font-bold', cron ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FFEDD5] text-[#C2410C]')}>{cron ? 'CRON READY' : 'NO CRON SECRET'}</span>
      }
    >
      <div className="mb-2 flex flex-col gap-1">
        {schedules.map((s) => (
          <div key={s.path} className="flex items-center justify-between text-[13px]">
            <span className="font-mono text-[12px] text-slate-600">{s.path}</span>
            <span className="font-semibold">{s.when}</span>
          </div>
        ))}
        <div className="text-[12px] text-slate-500">Boards also run the sweep at most once a minute while open.</div>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-3">
        {JOBS.map((j) => (
          <div key={j.job} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{j.label.replace(' now', '')}</div>
              <div className="text-[12px] text-slate-500">{last[j.job] ?? j.desc}</div>
            </div>
            <button
              type="button"
              disabled={!!busy}
              className={btnClass('o', 'sm')}
              onClick={async () => {
                setBusy(j.job)
                try {
                  const r = await api<{ result: Record<string, unknown> }>('/jobs/run', { body: { job: j.job } })
                  const txt = Object.entries(r.result ?? {})
                    .map(([k, x]) => `${k}: ${x}`)
                    .join(' · ')
                  setLast((p) => ({ ...p, [j.job]: `Done ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' })} · ${txt || 'ok'}` }))
                  toast(`${j.label.replace(' now', '')} finished`, 'ok')
                } catch (e: any) {
                  toast(e?.message ?? 'Job failed', 'err')
                } finally {
                  setBusy('')
                }
              }}
            >
              {busy === j.job ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run
            </button>
          </div>
        ))}
      </div>
    </SCard>
  )
}
