// Request page → Notified: who heard about each step (WhatsApp, email, in-app) and who did not, as a timeline.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Bell, BellOff, Check, Mail, MessageCircle, X } from 'lucide-react'
import { Empty, Tag, type Tone } from '@/components/ui'
import { ROLE_LABEL, type Role } from '@/lib/constants'
import { cx, dayNum, time } from '@/lib/format'
import type { NotifyRow, NotifyStep } from '@/lib/services/notify-log'

const card = 'min-w-0 rounded-card bg-white shadow-card'
const CH: Record<NotifyRow['channel'], { label: string; icon: ReactNode }> = {
  WHATSAPP: { label: 'WhatsApp', icon: <MessageCircle size={14} className="text-[#16A34A]" /> },
  EMAIL: { label: 'Email', icon: <Mail size={14} className="text-primary-700" /> },
  INAPP: { label: 'In-app', icon: <Bell size={14} className="text-slate-500" /> },
}
const STATUS: Record<string, { label: string; tone: Tone }> = {
  PREPARED: { label: 'Opened on phone', tone: 'slate' },
  QUEUED: { label: 'Sending', tone: 'blue' },
  SENT: { label: 'Sent', tone: 'green' },
  SENT_CONFIRMED: { label: 'Sent', tone: 'green' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
  OPENED: { label: 'Opened', tone: 'green' },
  SEEN: { label: 'Seen', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' },
  SKIPPED: { label: 'Not sent', tone: 'amber' },
  UNTICKED: { label: 'Unticked', tone: 'amber' },
}
const FILTERS = [
  { key: '', label: 'All' },
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'EMAIL', label: 'Email' },
  { key: 'INAPP', label: 'In-app' },
] as const

function Row({ x, missed }: { x: NotifyRow; missed?: boolean }) {
  const s = STATUS[x.status] ?? { label: x.status, tone: 'slate' as Tone }
  const role = x.role ? (ROLE_LABEL[x.role as Role] ?? x.role) : ''
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-[13px]">
      <span className="mt-0.5 flex-none">{CH[x.channel].icon}</span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-slate-800">{x.name}</span>
        {role && <span className="text-slate-500"> · {role}</span>}
        <span className="text-slate-400"> · {CH[x.channel].label}</span>
        {missed && x.reason && <span className="block text-[12px] text-[#B45309]">{x.reason}</span>}
        {x.seenAt && <span className="block text-[12px] text-slate-500">Seen {time(x.seenAt)}</span>}
      </span>
      <span className="flex flex-none items-center gap-2">
        <span className="text-[12px] text-slate-500">{time(x.at)}</span>
        <Tag tone={s.tone}>{s.label}</Tag>
      </span>
    </li>
  )
}

export function NotifiedTab({ steps, ch, base }: { steps: NotifyStep[]; ch: string; base: string }) {
  const keep = (x: NotifyRow) => !ch || x.channel === ch
  const shown = steps.map((s) => ({ ...s, notified: s.notified.filter(keep), notNotified: s.notNotified.filter(keep) })).filter((s) => s.notified.length || s.notNotified.length)
  const yes = shown.reduce((a, s) => a + s.notified.length, 0)
  const no = shown.reduce((a, s) => a + s.notNotified.length, 0)
  return (
    <section className={cx(card, 'p-5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold">Notified</div>
          <div className="mt-0.5 text-[13px] text-slate-500">
            Who heard about each step and who did not · <b className="text-[#15803D]">{yes} notified</b> · <b className="text-[#B45309]">{no} not notified</b>
          </div>
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`${base}?tab=notified${f.key ? `&ch=${f.key}` : ''}`} scroll={false} className={cx('inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold', ch === f.key ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              {f.label}
            </Link>
          ))}
        </div>
      </div>
      {!shown.length ? (
        <Empty icon={<BellOff size={24} />} title="No one has been notified yet" sub="WhatsApp, email and in-app notices about this request appear here, step by step." />
      ) : (
        <ol className="mt-5">
          {shown.map((s, i) => (
            <li key={`${s.step}-${s.at}`} className="flex gap-3">
              <div className="w-[96px] flex-none pt-px text-right text-[12.5px] text-slate-500">
                <div className="font-semibold text-slate-700">{time(s.at)}</div>
                <div className="text-[11.5px]">{dayNum(s.at)}</div>
              </div>
              <div className="flex flex-none flex-col items-center">
                <div className={cx('mt-1 size-2.5 rounded-full', s.notNotified.length ? 'bg-[#F59E0B]' : 'bg-[#16A34A]')} />
                {i < shown.length - 1 && <div className="w-0.5 flex-1 bg-slate-200" />}
              </div>
              <div className="min-w-0 flex-1 pb-5">
                <div className="text-[14px] font-bold">{s.label}</div>
                <div className="text-[12px] text-slate-500">{s.picked ? `Recipients chosen${s.by ? ` by ${s.by}` : ''} in “Notify on WhatsApp”` : s.by ? `Sent by ${s.by}` : 'Sent automatically · recipients from Settings → Notification rules'}</div>
                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg bg-[#F0FDF4] px-3 py-2 ring-1 ring-[#BBF7D0]">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[.05em] text-[#15803D]">
                      <Check size={13} strokeWidth={3} /> Notified · {s.notified.length}
                    </div>
                    {s.notified.length ? (
                      <ul className="divide-y divide-[#DCFCE7]">
                        {s.notified.map((x, j) => (
                          <Row key={j} x={x} />
                        ))}
                      </ul>
                    ) : (
                      <div className="py-1.5 text-[12.5px] text-slate-500">Nobody</div>
                    )}
                  </div>
                  <div className="rounded-lg bg-[#FFFBEB] px-3 py-2 ring-1 ring-[#FDE68A]">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[.05em] text-[#B45309]">
                      <X size={13} strokeWidth={3} /> Not notified · {s.notNotified.length}
                    </div>
                    {s.notNotified.length ? (
                      <ul className="divide-y divide-[#FEF3C7]">
                        {s.notNotified.map((x, j) => (
                          <Row key={j} x={x} missed />
                        ))}
                      </ul>
                    ) : (
                      <div className="py-1.5 text-[12.5px] text-slate-500">{s.picked ? 'Everyone offered was notified' : 'No one left out'}</div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
