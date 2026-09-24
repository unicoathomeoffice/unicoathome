'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Save, X, Lock } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass, Card } from '@/components/ui'
import { FormError, useFieldErrors } from '@/components/people/form'
import { cx } from '@/lib/format'

export type RulesValue = {
  general: { workingHours: { from: string; to: string }; slots: string[]; workingDays?: number[] }
  sla: { confirmRoutineMin: number; confirmUrgentMin: number; assignMin: number; acceptTimeoutMin: number; lateAfterMin: number; overtimePct: number; reminderBeforeMin: number[] }
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const slotName = (from: number) => (from < 11 ? 'Morning' : from < 13 ? 'Late morning' : from < 17 ? 'Afternoon' : from < 19 ? 'Evening' : 'Night')
const parseSlot = (s: string) => {
  const m = s.match(/(\d{1,2})\D+(\d{1,2})/)
  return m ? { from: m[1].padStart(2, '0'), to: m[2].padStart(2, '0') } : { from: '09', to: '11' }
}

const SLA_FIELDS: { key: keyof RulesValue['sla']; label: string; unit: string; hint: string }[] = [
  { key: 'confirmRoutineMin', label: 'Confirm · Routine', unit: 'min', hint: 'NEW → CONFIRMED' },
  { key: 'confirmUrgentMin', label: 'Confirm · Urgent', unit: 'min', hint: 'URGENT requests' },
  { key: 'assignMin', label: 'Assign after confirm', unit: 'min', hint: 'CONFIRMED → ASSIGNED' },
  { key: 'acceptTimeoutMin', label: 'Staff acceptance window', unit: 'min', hint: 'then escalates / reassigns' },
  { key: 'lateAfterMin', label: 'Late check-in flag', unit: 'min', hint: 'after the scheduled time' },
  { key: 'overtimePct', label: 'Overtime prompt', unit: '%', hint: 'over the expected duration' },
]

/** A5 right side: visit slots, working hours and SLA thresholds (PATCH /settings general + sla). */
export function RulesEditor({ value, canEdit }: { value: RulesValue; canEdit: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const fe = useFieldErrors()
  const initial = useMemo(
    () => ({
      slots: value.general.slots.map(parseSlot),
      from: value.general.workingHours.from,
      to: value.general.workingHours.to,
      days: value.general.workingDays ?? [0, 1, 2, 3, 4, 5, 6],
      sla: Object.fromEntries(SLA_FIELDS.map((f) => [f.key, String(value.sla[f.key])])) as Record<string, string>,
      reminders: (value.sla.reminderBeforeMin ?? []).join(', '),
    }),
    [value],
  )
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)

  function validate(): string | null {
    for (const s of v.slots) if (Number(s.to) <= Number(s.from)) return `Slot ${s.from}–${s.to}: the end must be after the start`
    if (v.to <= v.from) return 'Working hours: close must be after open'
    for (const f of SLA_FIELDS) {
      const n = Number(v.sla[f.key])
      if (!Number.isFinite(n) || n < 0 || v.sla[f.key].trim() === '') return `${f.label}: enter a number`
    }
    return null
  }

  async function save() {
    fe.clear()
    const problem = validate()
    if (problem) return fe.fromError(new Error(problem))
    setBusy(true)
    try {
      const slots = [...v.slots].sort((a, b) => Number(a.from) - Number(b.from)).map((s) => `${s.from}–${s.to}`)
      await api('/settings', { method: 'PATCH', body: { key: 'general', value: { slots, workingHours: { from: v.from, to: v.to }, workingDays: [...v.days].sort() } } })
      await api('/settings', {
        method: 'PATCH',
        body: {
          key: 'sla',
          value: {
            ...Object.fromEntries(SLA_FIELDS.map((f) => [f.key, Number(v.sla[f.key])])),
            reminderBeforeMin: v.reminders
              .split(/[,\s]+/)
              .map(Number)
              .filter((n) => Number.isFinite(n) && n > 0),
          },
        },
      })
      toast('Slots, hours and SLA saved')
      router.refresh()
    } catch (e) {
      fe.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  const setSlot = (i: number, patch: Partial<{ from: string; to: string }>) => setV((s) => ({ ...s, slots: s.slots.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))

  return (
    <>
      <Card className="self-start">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1 text-[15px] font-bold">Visit slots · {v.slots.length}</div>
          {canEdit && (
            <button type="button" className={btnClass('o', 'sm')} onClick={() => setV((s) => ({ ...s, slots: [...s.slots, { from: '19', to: '21' }] }))}>
              <Plus size={14} /> Add slot
            </button>
          )}
        </div>
        <fieldset disabled={!canEdit} className="flex flex-col gap-2">
          {v.slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-[10px] border border-slate-200 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{slotName(Number(s.from))}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-slate-500">
                  <select aria-label="Slot start" className="h-8 rounded-md border border-slate-300 bg-white px-1.5" value={s.from} onChange={(e) => setSlot(i, { from: e.target.value })}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                  –
                  <select aria-label="Slot end" className="h-8 rounded-md border border-slate-300 bg-white px-1.5" value={s.to} onChange={(e) => setSlot(i, { to: e.target.value })}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {canEdit && (
                <button type="button" onClick={() => setV((x) => ({ ...x, slots: x.slots.filter((_, j) => j !== i) }))} className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-[#FEF2F2] hover:text-[#B91C1C]" aria-label="Remove slot">
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          {v.slots.length === 0 && <div className="py-4 text-center text-[13px] text-slate-400">No slots — requests will only use exact times.</div>}
        </fieldset>

        <div className="mb-2 mt-6 text-[15px] font-bold">Working hours</div>
        <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-3">
          <label>
            <span className="hc-label">Open</span>
            <input type="time" className="hc-input px-2" value={v.from} onChange={(e) => setV((s) => ({ ...s, from: e.target.value }))} />
          </label>
          <label>
            <span className="hc-label">Close</span>
            <input type="time" className="hc-input px-2" value={v.to} onChange={(e) => setV((s) => ({ ...s, to: e.target.value }))} />
          </label>
          <div className="col-span-2 flex gap-1.5">
            {DAYS.map((d, i) => {
              const on = v.days.includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  title={DAY_NAMES[i]}
                  aria-pressed={on}
                  onClick={() => setV((s) => ({ ...s, days: on ? s.days.filter((x) => x !== i) : [...s.days, i] }))}
                  className={cx('flex size-9 items-center justify-center rounded-lg text-[13px] font-bold', on ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-400')}
                >
                  {d}
                </button>
              )
            })}
          </div>
        </fieldset>
      </Card>

      <Card className="self-start">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1 text-[15px] font-bold">SLA thresholds</div>
          {canEdit ? (
            <button type="button" className={btnClass('p', 'sm')} onClick={save} disabled={busy || !dirty}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">
              <Lock size={12} /> View only
            </span>
          )}
        </div>
        <FormError message={fe.message} />
        <fieldset disabled={!canEdit} className="flex flex-col">
          {SLA_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-3 border-t border-slate-100 py-2.5 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px]">{f.label}</span>
                <span className="block text-[11.5px] text-slate-400">{f.hint}</span>
              </span>
              <span className="flex h-9 w-[110px] items-center rounded-lg border border-slate-300 bg-white pr-2.5 focus-within:border-primary">
                <input
                  className="w-full min-w-0 bg-transparent px-2.5 text-sm font-semibold outline-none"
                  inputMode="numeric"
                  value={v.sla[f.key]}
                  onChange={(e) => setV((s) => ({ ...s, sla: { ...s.sla, [f.key]: e.target.value.replace(/[^\d.]/g, '') } }))}
                  aria-label={f.label}
                />
                <span className="text-[12px] text-slate-500">{f.unit}</span>
              </span>
            </label>
          ))}
          <label className="flex items-center gap-3 border-t border-slate-100 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px]">Reminders before visit</span>
              <span className="block text-[11.5px] text-slate-400">minutes, comma separated</span>
            </span>
            <input className="h-9 w-[110px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-semibold outline-none focus:border-primary" value={v.reminders} onChange={(e) => setV((s) => ({ ...s, reminders: e.target.value }))} aria-label="Reminders before visit" />
          </label>
        </fieldset>
        <p className="mt-3 text-[12px] text-slate-500">Slots, working hours and SLA are saved together. SLA colours on boards and the escalation job use these values.</p>
        {canEdit && dirty && <p className="mt-2 text-[12px] font-semibold text-[#B45309]">Unsaved changes</p>}
      </Card>
    </>
  )
}
