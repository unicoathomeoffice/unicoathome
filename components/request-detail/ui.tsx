// Server-safe presentational pieces of the request detail (W04).
import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { Tick } from './widgets'
import { cx, time } from '@/lib/format'
import type { Metric, Step, VitalRow } from './lib'

/** Uppercase 11px field label + 13px value (design "kv" grid cell) */
export function Field({ k, children, className }: { k: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-slate-500">{k}</div>
      <div className="mt-0.5 break-words text-[13px] leading-[18px] text-slate-900">{children ?? '—'}</div>
    </div>
  )
}

export function Panel({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-card bg-white p-5 shadow-card', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-bold">{title}</div>
        {right}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  )
}

/** Horizontal TimelineStepper with stamped times */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <div className="overflow-x-auto rounded-card bg-white p-5 shadow-card">
      <div className="flex min-w-[980px]">
        {steps.map((s, i) => {
          const last = i === steps.length - 1
          const green = s.state === 'done' || s.state === 'skipped'
          const lineGreen = green && steps[i + 1] && (steps[i + 1].state === 'done' || steps[i + 1].state === 'skipped')
          return (
            <div key={s.key + i} className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center">
                {s.state === 'done' ? (
                  <div className="flex size-5 flex-none items-center justify-center rounded-full bg-[#16A34A] text-white">
                    <Check size={12} strokeWidth={3} />
                  </div>
                ) : s.state === 'skipped' ? (
                  <div className="flex size-5 flex-none items-center justify-center rounded-full bg-[#BBF7D0] text-[#15803D]">
                    <Check size={12} strokeWidth={3} />
                  </div>
                ) : s.state === 'cancelled' ? (
                  <div className="flex size-5 flex-none items-center justify-center rounded-full bg-[#DC2626] text-white">
                    <X size={12} strokeWidth={3} />
                  </div>
                ) : s.state === 'current' ? (
                  <div className="size-5 flex-none rounded-full border-[3px] border-[#F59E0B] bg-white" />
                ) : (
                  <div className="size-5 flex-none rounded-full border-2 border-slate-300 bg-white" />
                )}
                {!last && <div className={cx('h-0.5 flex-1', lineGreen || (green && steps[i + 1]?.state !== 'todo') ? 'bg-[#16A34A]' : 'bg-slate-200')} />}
              </div>
              <div className="pr-2">
                <div className={cx('whitespace-nowrap text-[12.5px]', s.state === 'current' || s.state === 'cancelled' ? 'font-bold text-slate-900' : s.state === 'todo' ? 'font-semibold text-slate-400' : 'font-semibold text-slate-900')}>
                  {s.label}
                </div>
                <div className={cx('text-[12px]', s.state === 'current' ? 'font-bold text-[#B45309]' : s.state === 'cancelled' ? 'font-bold text-[#B91C1C]' : 'text-slate-500')}>
                  {s.live ? (
                    <>
                      now · <Tick from={s.live} />
                    </>
                  ) : (
                    s.sub ?? (s.at ? time(s.at) : '—')
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Timing metrics table (Metric · Value · Target) */
export function MetricsTable({ rows, className }: { rows: Metric[]; className?: string }) {
  return (
    <div className={cx('overflow-hidden rounded-card border border-slate-200 bg-white', className)}>
      <div className="grid h-11 grid-cols-[1fr_80px_90px] items-center border-b border-slate-200 bg-slate-50 px-5 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500">
        <div className="pr-3">Metric</div>
        <div className="pr-3">Value</div>
        <div className="pr-3">Target</div>
      </div>
      {rows.map((m) => (
        <div key={m.key} className="grid h-9 grid-cols-[1fr_80px_90px] items-center border-b border-slate-100 px-5 text-[13px] last:border-b-0">
          <div className="truncate pr-3">{m.label}</div>
          <div className={cx('truncate pr-3', m.ok === false && 'font-semibold text-[#B91C1C]')}>
            {m.liveFrom ? (
              <span className="font-semibold text-[#B45309]">
                <Tick from={m.liveFrom} /> →
              </span>
            ) : (
              m.text
            )}
          </div>
          <div className="truncate pr-3">
            {m.target} {m.ok === true && <span className="text-[#15803D]">✓</span>}
            {m.ok === false && <span className="font-bold text-[#B91C1C]">✕</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Vitals tiles, abnormal values outlined amber (E2 / visit data) */
export function VitalTiles({ rows, cols = 3 }: { rows: VitalRow[]; cols?: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {rows.map((v) => (
        <div key={v.key} className={cx('rounded-lg border px-2.5 py-1.5', v.abnormal ? 'border-[#F59E0B] bg-[#FFFBEB]' : 'border-slate-200')}>
          <div className="text-[11px] text-slate-500">{v.label}</div>
          <div className={cx('text-[15px] font-bold', v.abnormal ? 'text-[#B45309]' : 'text-slate-900')}>
            {v.value} <span className="text-[11px] font-medium text-slate-500">{v.unit}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function SubTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[13px] font-bold text-slate-900', className)}>{children}</div>
}
