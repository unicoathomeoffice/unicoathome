'use client'
import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { ApiClientError } from '@/components/client/api'
import { cx } from '@/lib/format'

/** Label + control + inline API validation error */
export function Field({ label, error, hint, children, className }: { label: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="hc-label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-slate-500">{hint}</span> : null}
    </label>
  )
}

/** Maps ApiClientError.fields (zod paths like "address.full") to a flat record, plus a general message. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  return {
    errors,
    message,
    clear: () => {
      setErrors({})
      setMessage(null)
    },
    fromError(e: unknown) {
      if (e instanceof ApiClientError) {
        setErrors(e.fields ?? {})
        setMessage(e.message)
      } else setMessage(e instanceof Error ? e.message : 'Something went wrong')
    },
  }
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return <div className="mb-4 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] font-semibold text-[#B91C1C]">{message}</div>
}

/** Checkbox pill, dark when checked (Platform access Web / App in the design) */
export function CheckPill({ on, onChange, children, disabled }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('inline-flex h-11 items-center gap-2.5 rounded-lg px-4 text-[15px] font-semibold transition disabled:opacity-50', on ? 'bg-slate-900 text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}
    >
      <span className={cx('flex size-[18px] items-center justify-center rounded-full', on ? 'bg-primary' : 'border-[1.5px] border-slate-300')}>{on && <Check size={12} strokeWidth={3} />}</span>
      {children}
    </button>
  )
}

/** Small tick checkbox (checklist table) */
export function Tick({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={() => onChange(!on)} className={cx('flex size-5 flex-none items-center justify-center rounded-[5px]', on ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white')}>
      {on && <Check size={13} strokeWidth={3} />}
    </button>
  )
}

/** Comma / newline separated list <-> array */
export const splitList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((c) => (c == null ? '' : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n')
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
