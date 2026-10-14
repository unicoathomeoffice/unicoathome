'use client'
// Settings → Notification rules: extra email addresses that receive a copy of patient messages per event.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

const EVENTS: { key: string; label: string }[] = [
  { key: 'REQUEST_CREATED', label: 'Request received (website / app)' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'ASSIGNED', label: 'Team assigned' },
  { key: 'RESCHEDULED', label: 'Rescheduled' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'COMPLETED', label: 'Completed + report' },
  { key: 'DAILY_DIGEST', label: 'Daily digest' },
]
const split = (s: string) => s.split(/[,\s;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
const bad = (s: string) => split(s).filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))

export function ExtraRecipients({ initial }: { initial: Record<string, string[]> }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(EVENTS.map((e) => [e.key, (initial[e.key] ?? []).join(', ')])))
  const [busy, setBusy] = useState(false)
  const dirty = EVENTS.some((e) => split(v[e.key]).join(',') !== (initial[e.key] ?? []).join(','))
  const invalid = EVENTS.flatMap((e) => bad(v[e.key]))

  async function save() {
    setBusy(true)
    try {
      await api('/settings', { method: 'PATCH', body: { key: 'emailCopies', value: Object.fromEntries(EVENTS.map((e) => [e.key, split(v[e.key])])) } })
      toast('Extra recipients saved', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <h2 className="text-[16px] font-bold">Extra email recipients</h2>
      <p className="mb-4 text-[13px] text-slate-500">Managers, the department desk or partner clinics get a copy of the patient’s email for these events. Comma-separated addresses.</p>
      <div className="flex flex-col gap-3">
        {EVENTS.map((e) => (
          <label key={e.key} className="grid gap-1 sm:grid-cols-[200px_1fr] sm:items-center">
            <span className="text-[13.5px] font-semibold">{e.label}</span>
            <input className={cx('hc-input', bad(v[e.key]).length > 0 && 'border-[#DC2626]')} value={v[e.key]} onChange={(ev) => setV({ ...v, [e.key]: ev.target.value })} placeholder="name@unicohospitals.com, other@…" />
          </label>
        ))}
      </div>
      {invalid.length > 0 && <div className="mt-2 text-[12.5px] text-[#B91C1C]">Not an email: {invalid.join(', ')}</div>}
      <button type="button" onClick={save} disabled={busy || !dirty || invalid.length > 0} className={btnClass('p', 'md', 'mt-4')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save recipients
      </button>
    </section>
  )
}
