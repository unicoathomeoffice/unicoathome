'use client'
import { useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { api } from '@/components/client/api'
import { btnClass } from '@/components/ui'
import { ROLE_LABEL, SIGNUP_ROLES } from '@/lib/constants'
import { cx } from '@/lib/format'

const input = 'hc-input hc-input-lg !text-[16px]'

export function JoinForm({ name, departments }: { name: string; departments: { id: string; name: string }[] }) {
  const [v, setV] = useState({ name, phone: '', employeeId: '', role: '', departmentId: '', note: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV((x) => ({ ...x, [k]: e.target.value }))
    setErrors(({ [k]: _, ...r }) => r)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await api('/auth/register', { body: { ...v, note: v.note || undefined } })
      window.location.href = '/join?status=sent'
    } catch (e: any) {
      if (e.fields) setErrors(e.fields)
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3.5">
      <Field label="Full name" error={errors.name}>
        <input className={input} value={v.name} onChange={set('name')} autoComplete="name" required />
      </Field>
      <Field label="Mobile number" error={errors.phone}>
        <input className={input} value={v.phone} onChange={set('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" required />
      </Field>
      <Field label="Employee ID" error={errors.employeeId}>
        <input className={input} value={v.employeeId} onChange={set('employeeId')} placeholder="As on your hospital ID card" autoCapitalize="characters" required />
      </Field>
      <Field label="Your role" error={errors.role}>
        <select className={input} value={v.role} onChange={set('role')} required>
          <option value="">Choose…</option>
          {SIGNUP_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      {departments.length > 0 && (
        <Field label="Department (optional)">
          <select className={input} value={v.departmentId} onChange={set('departmentId')}>
            <option value="">Choose…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Note for the administrator (optional)">
        <textarea className="hc-input !text-[16px]" rows={2} maxLength={300} value={v.note} onChange={set('note')} placeholder="e.g. joined Family Medicine on 1 Oct, reports to Dr. Rashid" />
      </Field>
      {err && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-[#FEE2E2] px-3.5 py-3 text-[14px] text-[#B91C1C]">
          <AlertTriangle size={18} className="mt-px flex-none" /> {err}
        </div>
      )}
      <button type="submit" disabled={busy} className={btnClass('p', 'xl', 'mt-1 w-full')}>
        {busy && <Loader2 size={18} className="animate-spin" />} Send for approval
      </button>
    </form>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className={cx('block', error && '[&_.hc-input]:border-[#DC2626]')}>
      <span className="hc-label !text-[13.5px]">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[13px] font-medium text-[#B91C1C]">{error}</span>}
    </label>
  )
}
