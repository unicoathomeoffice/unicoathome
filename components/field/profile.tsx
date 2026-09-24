'use client'
// M15 Profile & settings islands: notification preferences, devices / sessions, change password, sign out.
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, ChevronRight, KeyRound, Loader2, LogOut, Smartphone, Monitor } from 'lucide-react'
import { api, useAction, useToast, Sheet, Toggle } from '@/components/client'
import { btnClass, Tag } from '@/components/ui'
import { cx, ago } from '@/lib/format'
import { bigBtn } from './bar'

function Row({ icon: I, label, value, onClick }: { icon: any; label: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
      <I size={20} className="flex-none text-slate-600" />
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      {value && <span className="text-[13px] text-slate-500">{value}</span>}
      <ChevronRight size={18} className="flex-none text-slate-400" />
    </button>
  )
}

type Prefs = { push: boolean; email: boolean; whatsapp: boolean; quietHours?: { from: string; to: string } }

export function PrefsRow({ initial }: { initial: Prefs }) {
  const [open, setOpen] = useState(false)
  const [p, setP] = useState<Prefs>({ ...initial, push: true, quietHours: initial.quietHours ?? { from: '22:00', to: '07:00' } })
  const { run } = useAction()
  const save = async (next: Prefs) => {
    const prev = p
    setP(next)
    const ok = await run(() => api('/users/me', { method: 'PATCH', body: { notificationPrefs: next } }), 'Preferences saved')
    if (!ok) setP(prev)
  }
  const summary = ['Push', p.whatsapp && 'WhatsApp', p.email && 'Email'].filter(Boolean).join(' · ')
  return (
    <>
      <Row icon={Bell} label="Notification preferences" value={summary} onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Notification preferences" sub="Assignment alerts always come through in the app">
        <div className="divide-y divide-slate-100 pb-3">
          {(
            [
              ['push', 'In-app & push', 'New assignments, reminders, chat · always on', true],
              ['whatsapp', 'WhatsApp', 'Assignment summary to your WhatsApp', false],
              ['email', 'Email', 'Daily summaries and reports', false],
            ] as const
          ).map(([k, label, sub, locked]) => (
            <div key={k} className="flex min-h-16 items-center gap-3 py-2">
              <div className="flex-1">
                <div className="text-[15px] font-semibold">{label}</div>
                <div className="text-[12px] text-slate-500">{sub}</div>
              </div>
              <Toggle on={!!p[k]} disabled={locked} onChange={(v) => save({ ...p, [k]: v })} label={label} />
            </div>
          ))}
          <div className="py-3">
            <div className="text-[15px] font-semibold">Quiet hours</div>
            <div className="text-[12px] text-slate-500">Non-urgent alerts wait until the morning</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="time" className="hc-input hc-input-lg" value={p.quietHours?.from} onChange={(e) => setP({ ...p, quietHours: { ...p.quietHours!, from: e.target.value } })} onBlur={() => save(p)} aria-label="Quiet from" />
              <input type="time" className="hc-input hc-input-lg" value={p.quietHours?.to} onChange={(e) => setP({ ...p, quietHours: { ...p.quietHours!, to: e.target.value } })} onBlur={() => save(p)} aria-label="Quiet to" />
            </div>
          </div>
        </div>
      </Sheet>
    </>
  )
}

type Sess = { _id: string; client?: string; userAgent?: string; ip?: string; lastSeenAt?: string; createdAt?: string; current?: boolean }
const device = (ua = '') => {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : ua.startsWith('node') ? 'Script' : 'Browser'
  return `${os} · ${br}`
}

export function DevicesRow({ sessions }: { sessions: Sess[] }) {
  const [open, setOpen] = useState(false)
  const { run, busy } = useAction()
  return (
    <>
      <Row icon={Smartphone} label="Devices" value={`${sessions.length} active`} onClick={() => setOpen(true)} />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Signed-in devices"
        sub="Sign out a phone you no longer use"
        footer={
          sessions.length > 1 ? (
            <button type="button" disabled={busy} className={bigBtn('r')} onClick={() => run(() => api('/users/me', { method: 'PATCH', body: { signOutOthers: true } }), 'Signed out of other devices')}>
              Sign out all other devices
            </button>
          ) : undefined
        }
      >
        <div className="divide-y divide-slate-100 pb-2">
          {sessions.map((s) => (
            <div key={s._id} className="flex min-h-16 items-center gap-3 py-2.5">
              <span className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-slate-100 text-slate-600">{s.client === 'web' ? <Monitor size={18} /> : <Smartphone size={18} />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[15px] font-semibold">
                  {device(s.userAgent)} {s.current && <Tag tone="green">This device</Tag>}
                </div>
                <div className="text-[12px] text-slate-500">
                  {s.client === 'web' ? 'Web admin' : 'Field app'} · active {ago(s.lastSeenAt ?? s.createdAt)}
                  {s.ip ? ` · ${s.ip}` : ''}
                </div>
              </div>
              {!s.current && (
                <button type="button" disabled={busy} onClick={() => run(() => api('/users/me', { method: 'PATCH', body: { signOutSessionId: s._id } }), 'Device signed out')} className="h-9 px-1 text-[13px] font-semibold text-[#B91C1C]">
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      </Sheet>
    </>
  )
}

export function PasswordRow() {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const { run, busy } = useAction()
  const err = next && next.length < 8 ? 'At least 8 characters' : again && again !== next ? 'Passwords do not match' : ''
  return (
    <>
      <Row icon={KeyRound} label="Change password" onClick={() => setOpen(true)} />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Change password"
        footer={
          <button
            type="button"
            disabled={busy || !cur || !next || next !== again || next.length < 8}
            className={bigBtn('p')}
            onClick={async () => {
              const ok = await run(() => api('/users/me', { method: 'PATCH', body: { currentPassword: cur, newPassword: next } }), 'Password changed', { refresh: false })
              if (ok) {
                setOpen(false)
                setCur('')
                setNext('')
                setAgain('')
              }
            }}
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            Save password
          </button>
        }
      >
        <div className="grid gap-3 pb-2">
          <label>
            <span className="hc-label text-[13px]">Current password</span>
            <input type="password" autoComplete="current-password" className="hc-input hc-input-lg" value={cur} onChange={(e) => setCur(e.target.value)} />
          </label>
          <label>
            <span className="hc-label text-[13px]">New password</span>
            <input type="password" autoComplete="new-password" className="hc-input hc-input-lg" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label>
            <span className="hc-label text-[13px]">Repeat new password</span>
            <input type="password" autoComplete="new-password" className="hc-input hc-input-lg" value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
          {err && <div className="text-[13px] font-semibold text-[#B91C1C]">{err}</div>}
        </div>
      </Sheet>
    </>
  )
}

export function SignOutButton() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        let pending = 0
        try {
          pending = JSON.parse(localStorage.getItem('hc_outbox') ?? '[]').length
        } catch {}
        if (pending && !window.confirm(`${pending} offline action${pending === 1 ? ' is' : 's are'} not synced yet. Signing out discards ${pending === 1 ? 'it' : 'them'}. Sign out anyway?`)) return
        setBusy(true)
        try {
          const r = await api<{ redirect: string }>('/auth/logout', { body: {} })
          try {
            localStorage.removeItem('hc_outbox')
          } catch {}
          router.replace(r.redirect ?? '/m/login')
          router.refresh()
        } catch (e: any) {
          toast(e.message, 'err')
          setBusy(false)
        }
      }}
      className={cx(bigBtn('r', 'w-full'))}
    >
      {busy ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
      Sign out
    </button>
  )
}
