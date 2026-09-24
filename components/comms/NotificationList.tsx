'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Bell, CalendarClock, Car, Check, CheckCheck, Clock, Mail, MessageSquare, Plus, ShieldCheck, X, Zap, Wallet, MapPin } from 'lucide-react'
import { api } from '@/components/client'
import { cx } from '@/lib/format'

export type NotificationItem = { _id: string; type?: string; title?: string; body?: string; priority?: string; readAt?: string | null; createdAt: string; data?: { url?: string; requestId?: string } }

const ICON: Record<string, { icon: typeof Bell; bg: string; fg: string }> = {
  ABNORMAL_VITALS: { icon: AlertTriangle, bg: '#FEE2E2', fg: '#DC2626' },
  ESCALATION: { icon: Zap, bg: '#EDE9FE', fg: '#7C3AED' },
  OVERDUE: { icon: Clock, bg: '#FEE2E2', fg: '#DC2626' },
  REQUEST_CREATED: { icon: Plus, bg: '#F1F5F9', fg: '#475569' },
  ASSIGNED: { icon: Zap, bg: '#EDE9FE', fg: '#7C3AED' },
  ACCEPTED: { icon: Check, bg: '#DCFCE7', fg: '#16A34A' },
  DECLINED: { icon: X, bg: '#FEE2E2', fg: '#DC2626' },
  COMPLETED: { icon: Check, bg: '#DCFCE7', fg: '#16A34A' },
  CHECK_IN: { icon: MapPin, bg: '#CFFAFE', fg: '#0891B2' },
  EN_ROUTE: { icon: Car, bg: '#CFFAFE', fg: '#0891B2' },
  RESCHEDULED: { icon: CalendarClock, bg: '#FFEDD5', fg: '#EA580C' },
  CANCELLED: { icon: X, bg: '#FEE2E2', fg: '#B91C1C' },
  REMINDER: { icon: Bell, bg: '#E8F5FB', fg: '#0090CA' },
  TRANSPORT: { icon: Car, bg: '#E0E7FF', fg: '#4F46E5' },
  CHAT: { icon: MessageSquare, bg: '#E8F5FB', fg: '#0090CA' },
  APPROVAL: { icon: Wallet, bg: '#FEF3C7', fg: '#B45309' },
  DIGEST: { icon: Mail, bg: '#F1F5F9', fg: '#475569' },
  SYSTEM: { icon: ShieldCheck, bg: '#F1F5F9', fg: '#475569' },
}

const fTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false })
const fDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' })
const fShort = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short' })

export function NotificationList({ items, today }: { items: NotificationItem[]; today: string }) {
  const router = useRouter()
  const [read, setRead] = useState<Record<string, boolean>>({})
  const yesterday = fDay.format(new Date(new Date(`${today}T12:00:00+06:00`).getTime() - 86400_000))
  const label = (iso: string) => {
    const k = fDay.format(new Date(iso))
    const t = fTime.format(new Date(iso))
    if (k === today) return t
    if (k === yesterday) return `Yesterday ${t}`
    return `${fShort.format(new Date(iso)).replace(',', '')} ${t}`
  }
  const groups = [
    { key: 'Today', rows: items.filter((n) => fDay.format(new Date(n.createdAt)) === today) },
    { key: 'Earlier', rows: items.filter((n) => fDay.format(new Date(n.createdAt)) !== today) },
  ].filter((g) => g.rows.length)

  async function open(n: NotificationItem) {
    if (!n.readAt && !read[n._id]) {
      setRead((r) => ({ ...r, [n._id]: true }))
      await api(`/notifications/${n._id}`, { method: 'PATCH', body: {} }).catch(() => {})
    }
    const url = n.data?.url ?? (n.data?.requestId ? `/requests/${n.data.requestId}` : null)
    if (url) router.push(url.startsWith('/m/visits/') ? `/requests/${url.split('/')[3]}` : url)
    else router.refresh()
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mb-2.5 mt-2 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">{g.key}</div>
          <div className="overflow-hidden rounded-card bg-white shadow-card">
            {g.rows.map((n) => {
              const unread = !n.readAt && !read[n._id]
              const ic = ICON[n.type ?? ''] ?? ICON.SYSTEM
              const Icon = ic.icon
              return (
                <div
                  key={n._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => open(n)}
                  onKeyDown={(e) => e.key === 'Enter' && open(n)}
                  className={cx('flex cursor-pointer items-start gap-3.5 border-t border-slate-100 px-[18px] py-4 first:border-t-0 hover:bg-slate-50', unread && 'bg-[#F8FAFC]')}
                >
                  <div className="flex size-10 flex-none items-center justify-center rounded-[10px]" style={{ background: ic.bg, color: ic.fg }}>
                    <Icon size={19} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cx('text-sm', unread ? 'font-bold' : 'font-semibold text-slate-800')}>
                      {n.title}
                      {n.priority === 'high' && <span className="ml-2 rounded-full bg-[#FEE2E2] px-1.5 py-px align-middle text-[10px] font-bold uppercase text-[#B91C1C]">High</span>}
                    </div>
                    {n.body && <div className="mt-0.5 text-[13px] text-slate-500">{n.body}</div>}
                  </div>
                  <div className="flex flex-none items-start gap-3">
                    <span className="mt-0.5 whitespace-nowrap text-[12px] text-slate-400">{label(n.createdAt)}</span>
                    {(n.data?.url || n.data?.requestId) && (
                      <span className="mt-[-2px] hidden h-8 items-center rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 sm:inline-flex">Open</span>
                    )}
                    <span className={cx('mt-2 size-2 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} aria-label={unread ? 'Unread' : undefined} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export function MarkAllRead({ disabled }: { disabled?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true)
        await api('/notifications', { body: {} }).catch(() => {})
        setBusy(false)
        router.refresh()
      }}
      className="inline-flex h-[38px] items-center gap-2 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      <CheckCheck size={16} /> Mark all read
    </button>
  )
}
