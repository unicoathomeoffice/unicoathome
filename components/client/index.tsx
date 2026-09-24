'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, MessageCircle } from 'lucide-react'
import { api, useAction } from './api'
import { btnClass, type BtnKind } from '@/components/ui'
import { cx, mmss } from '@/lib/format'

export { api, useAction, stamp } from './api'
export { useToast } from './toast'

// ---------------------------------------------------------------- ActionButton
/** Button that POSTs to the API, toasts and refreshes. `confirm` shows a browser confirm first. */
export function ActionButton({
  path,
  body,
  method,
  children,
  kind = 'p',
  size = 'md',
  success,
  confirm,
  className,
  redirect,
  disabled,
  onDone,
}: {
  path: string
  body?: unknown
  method?: string
  children: ReactNode
  kind?: BtnKind
  size?: 'sm' | 'md' | 'lg' | 'xl'
  success?: string
  confirm?: string
  className?: string
  redirect?: string
  disabled?: boolean
  onDone?: (r: any) => void
}) {
  const { run, busy } = useAction()
  return (
    <button
      type="button"
      disabled={busy || disabled}
      className={btnClass(disabled ? 'd' : kind, size, className)}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return
        const r = await run(() => api(path, { method: method ?? 'POST', body: body ?? {} }), success, { redirect })
        if (r !== undefined) onDone?.(r)
      }}
    >
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Drawer (web) & Sheet (mobile)
export function Drawer({ open, onClose, title, sub, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/35" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-drawer" style={{ maxWidth: width }}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold">{title}</div>
            {sub && <div className="mt-0.5 text-[13px] text-slate-500">{sub}</div>}
          </div>
          <button onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center gap-3 border-t border-slate-200 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function Sheet({ open, onClose, title, sub, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[92dvh] w-full max-w-[480px] flex-col rounded-t-2xl bg-white shadow-sheet">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300" />
        {(title || sub) && (
          <div className="px-5 pb-2 pt-3">
            {title && <div className="text-[19px] font-bold">{title}</div>}
            {sub && <div className="mt-0.5 text-[13px] text-slate-500">{sub}</div>}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer && <div className="flex gap-2.5 border-t border-slate-200 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Toggle
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('relative h-8 w-[52px] flex-none rounded-full transition disabled:opacity-50', on ? 'bg-primary' : 'bg-slate-300')}
    >
      <span className={cx('absolute top-[3px] size-[26px] rounded-full bg-white shadow transition-all', on ? 'left-[23px]' : 'left-[3px]')} />
    </button>
  )
}

/** Segmented control (design `seg`) */
export function Segmented<T extends string>({ items, value, onChange, h = 36 }: { items: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; h?: number }) {
  return (
    <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
      {items.map((i) => (
        <button
          key={i.value}
          type="button"
          onClick={() => onChange(i.value)}
          className={cx('flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-2 text-sm font-semibold', i.value === value ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}
          style={{ height: h }}
        >
          {i.label}
        </button>
      ))}
    </div>
  )
}

/** Multi-select chip picker */
export function ChipPicker({ options, value, onChange, max }: { options: { value: string; label: string }[] | string[]; value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map((o) => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : max === 1 ? [o.value] : [...value, o.value])}
            className={cx('inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-semibold transition', on ? 'bg-primary text-white' : 'border border-slate-300 bg-white text-slate-700 hover:border-primary')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- WhatsApp (deep link tier 1)
/**
 * Prepares a templated WhatsApp message on the server (logged), opens wa.me, then asks the
 * user to confirm they tapped Send (records SENT_CONFIRMED).
 */
export function WhatsAppButton({
  requestId,
  patientId,
  templateKey,
  to = 'patient',
  staffId,
  phone,
  text,
  children,
  kind = 'o',
  size = 'md',
  className,
}: {
  requestId?: string
  patientId?: string
  templateKey?: string
  to?: 'patient' | 'staff' | 'custom'
  staffId?: string
  phone?: string
  text?: string
  children?: ReactNode
  kind?: BtnKind
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const { run, busy, toast } = useAction()
  const [pending, setPending] = useState<{ logId: string } | null>(null)
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={btnClass(kind, size, className)}
        onClick={async () => {
          const r = await run(() => api<{ url: string; logId: string }>('/messages/whatsapp', { body: { requestId, patientId, templateKey, to, staffId, phone, text } }), undefined, { refresh: false })
          if (!r) return
          window.open(r.url, '_blank')
          setPending({ logId: r.logId })
        }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
        {children ?? 'WhatsApp'}
      </button>
      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-[17px] font-bold">Did you send it?</div>
            <div className="mt-1 text-sm text-slate-500">WhatsApp opened with the message filled in. Confirm once you tapped Send, so it is logged on the record.</div>
            <div className="mt-4 flex gap-2">
              <button className={btnClass('o', 'md', 'flex-1')} onClick={() => setPending(null)}>
                Not sent
              </button>
              <button
                className={btnClass('g', 'md', 'flex-1')}
                onClick={async () => {
                  await api(`/messages/${pending.logId}`, { method: 'PATCH', body: { status: 'SENT_CONFIRMED' } }).catch(() => {})
                  setPending(null)
                  toast('WhatsApp message logged')
                }}
              >
                I sent it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- timers
/** Ticking clock that is null during SSR/hydration, so server and client markup always match. */
function useNow() {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Live mm:ss elapsed since `from` (TimerWidget core) */
export function Elapsed({ from, className }: { from: string | Date; className?: string }) {
  const now = useNow()
  if (now == null) return <span className={className} suppressHydrationWarning>--:--</span>
  const sec = Math.max(0, (now - new Date(from).getTime()) / 1000)
  const h = Math.floor(sec / 3600)
  return <span className={className}>{h ? `${h}:${mmss(sec % 3600)}` : mmss(sec)}</span>
}

/** Live countdown to `to`; shows "Overdue mm:ss" after. */
export function Countdown({ to, className, overdueClassName }: { to: string | Date; className?: string; overdueClassName?: string }) {
  const now = useNow()
  if (now == null) return <span className={className} suppressHydrationWarning>--:--</span>
  const sec = (new Date(to).getTime() - now) / 1000
  if (sec < 0) return <span className={overdueClassName ?? className}>-{mmss(-sec)}</span>
  const h = Math.floor(sec / 3600)
  return <span className={className}>{h ? `${h}h ${Math.floor((sec % 3600) / 60)}m` : mmss(sec)}</span>
}

/** Re-fetches server components every `seconds` (boards poll 15–30 s per the plan). */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, seconds * 1000)
    return () => clearInterval(t)
  }, [router, seconds])
  return null
}

/** Unread notifications badge that polls /api/v1/notifications?unread=1 */
export function UnreadBadge({ initial, className }: { initial: number; className?: string }) {
  const [n, setN] = useState(initial)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await api<{ unread: number }>('/notifications?unread=1&limit=1')
        setN(r.unread)
      } catch {}
    }, 30_000)
    return () => clearInterval(t)
  }, [])
  if (!n) return null
  return <span className={cx('flex h-4 min-w-4 items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white', className)}>{n > 99 ? '99+' : n}</span>
}

// ---------------------------------------------------------------- uploads
/** Compress an image in the browser (max 1600px, JPEG 0.8) and stamp the time on it. */
export async function compressImage(file: File, watermark = true): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  if (watermark) {
    const text = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const fs = Math.max(16, Math.round(canvas.width / 40))
    ctx.font = `bold ${fs}px sans-serif`
    const w = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(15,23,42,.6)'
    ctx.fillRect(canvas.width - w - fs * 1.4, canvas.height - fs * 2.2, w + fs, fs * 1.6)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, canvas.width - w - fs * 0.9, canvas.height - fs * 0.95)
  }
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.8))
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export async function uploadFile(file: File, fields: { kind: string; requestId?: string; patientId?: string; caption?: string }) {
  const form = new FormData()
  form.append('file', await compressImage(file))
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v)
  return api<{ id: string; url: string }>('/attachments', { form })
}
