// Server-safe pieces shared by the Messages log (W12 / E3) and other comms screens.
import { Bell, Mail, MessageCircle, Smartphone } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx, isoDay, time, dayNum } from '@/lib/format'

export const MSG_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  PREPARED: { label: 'Prepared', bg: '#F1F5F9', fg: '#475569' },
  QUEUED: { label: 'Queued', bg: '#FEF3C7', fg: '#B45309' },
  SENT: { label: 'Sent', bg: '#E8F5FB', fg: '#0072A3' },
  SENT_CONFIRMED: { label: 'Sent confirmed', bg: '#DCFCE7', fg: '#15803D' },
  DELIVERED: { label: 'Delivered', bg: '#DCFCE7', fg: '#15803D' },
  OPENED: { label: 'Opened', bg: '#D1FAE5', fg: '#065F46' },
  FAILED: { label: 'Failed', bg: '#FEE2E2', fg: '#B91C1C' },
  SKIPPED: { label: 'Skipped', bg: '#FFEDD5', fg: '#C2410C' },
}

export function MsgStatus({ status, className }: { status: string; className?: string }) {
  const s = MSG_STATUS[status] ?? { label: status, bg: '#F1F5F9', fg: '#475569' }
  return (
    <span className={cx('inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-[10.5px] font-bold uppercase tracking-[.02em]', className)} style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  )
}

export const CHANNEL_LABEL: Record<string, string> = { EMAIL: 'Email', WHATSAPP: 'WhatsApp', PUSH: 'Push', SMS: 'SMS' }

export function ChannelIcon({ channel, size = 16 }: { channel: string; size?: number }) {
  if (channel === 'EMAIL') return <Mail size={size} />
  if (channel === 'WHATSAPP') return <MessageCircle size={size} />
  if (channel === 'SMS') return <Smartphone size={size} />
  return <Bell size={size} />
}

/** "11:43", "Yesterday 20:00", "21 Sep 09:02" */
export function when(v: string | Date | null | undefined) {
  if (!v) return '—'
  const k = isoDay(v)
  if (k === isoDay()) return time(v)
  if (k === isoDay(Date.now() - 86400_000)) return `Yesterday ${time(v)}`
  return `${dayNum(v)} ${time(v)}`
}

/** WhatsApp chat bubble */
export function WaBubble({ text, at, ticks = true }: { text: string; at?: ReactNode; ticks?: boolean }) {
  return (
    <div className="rounded-xl bg-[#ECFDF3] p-3.5">
      <div className="whitespace-pre-wrap rounded-lg rounded-tl-none bg-[#DCFCE7] px-3.5 py-2.5 text-[13.5px] leading-[22px] text-slate-800 shadow-[0_1px_1px_rgba(15,23,42,.08)]">
        {text}
        {at && (
          <div className="mt-1 text-right text-[11px] text-slate-500">
            {at} {ticks && <span className="text-[#0090CA]">✓✓</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Push / in-app notification preview */
export function PushCard({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl bg-slate-100 p-3.5">
      <div className="flex gap-3 rounded-xl bg-white p-3 shadow-card">
        <div className="flex size-9 flex-none items-center justify-center rounded-lg bg-primary text-white">
          <Bell size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-slate-400">Unico HomeCare · now</div>
          <div className="text-[13.5px] font-bold">{title}</div>
          {body && <div className="whitespace-pre-wrap text-[13px] text-slate-600">{body}</div>}
        </div>
      </div>
    </div>
  )
}

/** Rendered email in a sandboxed iframe (no scripts, no same-origin). */
export function EmailFrame({ html, height = 440, className }: { html: string; height?: number; className?: string }) {
  return <iframe title="Email preview" sandbox="" srcDoc={html} className={cx('w-full rounded-xl border border-slate-200 bg-[#F1F5F9]', className)} style={{ height }} />
}
