'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Laptop, Loader2, LogOut, Smartphone } from 'lucide-react'
import { api, useAction, Toggle } from '@/components/client'
import { btnClass, Tag } from '@/components/ui'
import { cx } from '@/lib/format'

// ---------------------------------------------------------------- change password
export function PasswordForm() {
  const { run, busy } = useAction()
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [err, setErr] = useState<Record<string, string>>({})
  const strong = f.next.length >= 8 && /[A-Za-z]/.test(f.next) && /\d/.test(f.next)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errors: Record<string, string> = {}
    if (!f.current) errors.current = 'Enter your current password'
    if (f.next.length < 8) errors.next = 'At least 8 characters'
    else if (!strong) errors.next = 'Use letters and numbers'
    if (f.next !== f.confirm) errors.confirm = 'Passwords do not match'
    if (f.next && f.next === f.current) errors.next = 'Choose a different password'
    setErr(errors)
    if (Object.keys(errors).length) return
    const ok = await run(() => api('/users/me', { method: 'PATCH', body: { currentPassword: f.current, newPassword: f.next } }), 'Password changed', { refresh: false })
    if (ok) setF({ current: '', next: '', confirm: '' })
  }
  const input = (k: keyof typeof f, label: string, auto: string) => (
    <label className="block">
      <span className="hc-label">{label}</span>
      <input type={show ? 'text' : 'password'} autoComplete={auto} className={cx('hc-input', err[k] && 'border-[#DC2626]')} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
      {err[k] && <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{err[k]}</span>}
    </label>
  )
  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      {input('current', 'Current password', 'current-password')}
      <div className="grid gap-3.5 sm:grid-cols-2">
        {input('next', 'New password', 'new-password')}
        {input('confirm', 'Confirm new password', 'new-password')}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setShow((s) => !s)} className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-slate-600">
          {show ? <EyeOff size={15} /> : <Eye size={15} />} {show ? 'Hide' : 'Show'} passwords
        </button>
        <span className="text-[12px] text-slate-500">8+ characters with letters and numbers</span>
        <button type="submit" className={btnClass('p', 'md', 'ml-auto')} disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />} Change password
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- sessions
export type SessionRow = { id: string; client: string; device: string; ip: string; lastSeen: string; created: string; current: boolean }

export function Sessions({ rows }: { rows: SessionRow[] }) {
  const { run, busy } = useAction()
  const router = useRouter()
  const others = rows.filter((r) => !r.current).length
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, 6)
  return (
    <div>
      <div className="flex flex-col">
        {shown.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-t border-slate-100 py-3 first:border-t-0">
            <div className="flex size-10 flex-none items-center justify-center rounded-full bg-slate-100 text-slate-600">{s.client === 'app' ? <Smartphone size={18} /> : <Laptop size={18} />}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[14px] font-semibold">
                <span className="truncate">{s.device}</span>
                {s.current && <Tag tone="green">This device</Tag>}
                <Tag tone="slate">{s.client === 'app' ? 'Field app' : 'Web'}</Tag>
              </div>
              <div className="truncate text-[12px] text-slate-500">
                {s.ip || 'unknown IP'} · last active {s.lastSeen} · signed in {s.created}
              </div>
            </div>
            {!s.current && (
              <button
                type="button"
                disabled={busy}
                className={btnClass('o', 'sm')}
                onClick={() => run(() => api('/users/me', { method: 'PATCH', body: { signOutSessionId: s.id } }), 'Device signed out')}
              >
                Sign out
              </button>
            )}
          </div>
        ))}
        {rows.length > shown.length && (
          <button type="button" onClick={() => setAll(true)} className="border-t border-slate-100 py-2.5 text-left text-[13px] font-semibold text-primary-700 hover:underline">
            Show all {rows.length} sessions
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3.5">
        <button
          type="button"
          disabled={busy || others === 0}
          className={btnClass('r', 'md')}
          onClick={() => {
            if (window.confirm(`Sign out ${others} other device${others === 1 ? '' : 's'}?`)) run(() => api('/users/me', { method: 'PATCH', body: { signOutOthers: true } }), 'Other devices signed out')
          }}
        >
          Sign out other devices
        </button>
        <button
          type="button"
          className={btnClass('o', 'md', 'ml-auto')}
          onClick={async () => {
            await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {})
            router.push('/login')
          }}
        >
          <LogOut size={16} /> Sign out here
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- notification preferences
export function Prefs({ initial }: { initial: { push: boolean; email: boolean; whatsapp: boolean; quietHours: { from: string; to: string } } }) {
  const { run, busy } = useAction()
  const [p, setP] = useState(initial)
  const save = (next: typeof p) => {
    setP(next)
    run(() => api('/users/me', { method: 'PATCH', body: { notificationPrefs: next } }), 'Preferences saved', { refresh: false })
  }
  const row = (k: 'push' | 'email' | 'whatsapp', title: string, sub: string, locked?: boolean) => (
    <div className="flex items-center gap-3 border-t border-slate-100 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="text-[12.5px] text-slate-500">{sub}</div>
      </div>
      <Toggle on={locked ? true : p[k]} disabled={busy || locked} onChange={(v) => save({ ...p, [k]: v })} label={title} />
    </div>
  )
  return (
    <div>
      {row('push', 'Push & in-app', 'Assignments, escalations and approvals · always on for urgent alerts', true)}
      {row('email', 'Email', 'Daily digest, visit reports and escalation summaries')}
      {row('whatsapp', 'WhatsApp', 'Assignment notices sent to your WhatsApp number')}
      <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Quiet hours</div>
          <div className="text-[12.5px] text-slate-500">Non-urgent notifications are held during these hours</div>
        </div>
        <label>
          <span className="hc-label">From</span>
          <input type="time" className="hc-input w-[132px]" value={p.quietHours.from} onChange={(e) => setP({ ...p, quietHours: { ...p.quietHours, from: e.target.value } })} onBlur={() => save(p)} />
        </label>
        <label>
          <span className="hc-label">To</span>
          <input type="time" className="hc-input w-[132px]" value={p.quietHours.to} onChange={(e) => setP({ ...p, quietHours: { ...p.quietHours, to: e.target.value } })} onBlur={() => save(p)} />
        </label>
      </div>
    </div>
  )
}
