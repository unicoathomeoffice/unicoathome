'use client'
// M14 Notifications list: type icons, unread dots, deep links (mark read on open), mark all read.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarDays, Car, Check, Clock, FlaskConical, Mail, MessageCircle, ShieldCheck, Star, X, Zap, BellOff } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { cx } from '@/lib/format'

export type NItem = { _id: string; type: string; title: string; body?: string; priority?: string; readAt?: string | null; href: string | null; when: string; today: boolean }

const ICON: Record<string, [any, string]> = {
  ASSIGNED: [Zap, 'bg-[#EDE9FE] text-[#6D28D9]'],
  REQUEST_CREATED: [Zap, 'bg-[#EDE9FE] text-[#6D28D9]'],
  REMINDER: [Clock, 'bg-[#FEF3C7] text-[#B45309]'],
  OVERDUE: [Clock, 'bg-[#FEF3C7] text-[#B45309]'],
  ACCEPTED: [Check, 'bg-[#DCFCE7] text-[#15803D]'],
  CHECK_IN: [Check, 'bg-[#DCFCE7] text-[#15803D]'],
  COMPLETED: [Check, 'bg-[#DCFCE7] text-[#15803D]'],
  CLOSED: [Check, 'bg-[#DCFCE7] text-[#15803D]'],
  CONFIRMED: [Check, 'bg-[#DCFCE7] text-[#15803D]'],
  EN_ROUTE: [Car, 'bg-primary-50 text-primary-700'],
  TRANSPORT: [Car, 'bg-primary-50 text-primary-700'],
  RESCHEDULED: [CalendarDays, 'bg-[#FFEDD5] text-[#C2410C]'],
  CANCELLED: [X, 'bg-[#FEE2E2] text-[#B91C1C]'],
  DECLINED: [X, 'bg-[#FEE2E2] text-[#B91C1C]'],
  ABNORMAL_VITALS: [AlertTriangle, 'bg-[#FEE2E2] text-[#B91C1C]'],
  ESCALATION: [AlertTriangle, 'bg-[#FEE2E2] text-[#B91C1C]'],
  CHAT: [MessageCircle, 'bg-primary-50 text-primary-700'],
  APPROVAL: [ShieldCheck, 'bg-[#E0E7FF] text-[#4338CA]'],
  LAB_RESULT: [FlaskConical, 'bg-[#CCFBF1] text-[#0F766E]'],
  FEEDBACK: [Star, 'bg-primary-50 text-primary-700'],
}

export function NotificationList({ items: initial }: { items: NItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const sig = JSON.stringify(initial)
  useEffect(() => {
    setItems(JSON.parse(sig))
  }, [sig])

  async function open(n: NItem) {
    if (!n.readAt) {
      setItems((xs) => xs.map((x) => (x._id === n._id ? { ...x, readAt: new Date().toISOString() } : x)))
      api(`/notifications/${n._id}`, { method: 'PATCH' }).catch(() => {})
    }
    if (n.href) router.push(n.href)
    else router.refresh()
  }
  const groups = [
    { label: 'Today', rows: items.filter((i) => i.today) },
    { label: 'Earlier', rows: items.filter((i) => !i.today) },
  ].filter((g) => g.rows.length)

  return (
    <>
      {!items.length && (
        <div className="flex flex-col items-center gap-2 rounded-card bg-white px-6 py-12 text-center shadow-card">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary">
            <BellOff size={26} />
          </span>
          <div className="text-[15px] font-bold">No notifications yet</div>
          <div className="text-[13px] text-slate-500">New assignments, reminders and messages appear here.</div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label} className="grid gap-2">
          <div className="mt-1 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">{g.label}</div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
            {g.rows.map((n) => {
              const [Icon, tone] = ICON[n.type] ?? [Mail, 'bg-slate-100 text-slate-600']
              return (
                <button key={n._id} type="button" onClick={() => open(n)} className={cx('flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-slate-50', !n.readAt && 'bg-[#F5FBFE]')}>
                  <span className={cx('flex size-10 flex-none items-center justify-center rounded-[10px]', tone)}>
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className={cx('flex-1 text-[15px] leading-5', n.readAt ? 'font-semibold' : 'font-bold', n.priority === 'high' && !n.readAt && 'text-slate-900')}>{n.title}</span>
                      <span className="flex-none pt-0.5 text-[12px] text-slate-400">{n.when}</span>
                      {!n.readAt && <span className="mt-1.5 size-2 flex-none rounded-full bg-primary" />}
                    </span>
                    {n.body && <span className="mt-0.5 block text-[13px] leading-[18px] text-slate-500">{n.body}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

/** Header action: mark every notification read */
export function MarkAllRead() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await api('/notifications', { body: {} })
          toast('All caught up', 'ok')
          router.refresh()
        } catch (e: any) {
          toast(e.message, 'err')
        } finally {
          setBusy(false)
        }
      }}
      className="h-10 flex-none px-2 text-[14px] font-semibold text-primary-700 disabled:opacity-50"
    >
      Mark all read
    </button>
  )
}
