'use client'
// S5 "Tests & procedures" card: list with lab status, team can add from the Google-form list.
import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { api, useAction, Sheet, ChipPicker } from '@/components/client'
import { btnClass } from '@/components/ui'
import { TESTS_PROCEDURES } from '@/lib/constants'
import { cx } from '@/lib/format'
import { bigBtn } from './bar'

type Lab = { status: string; flag?: string; value?: string; unit?: string; summary?: string }

export function TestsCard({ id, tests, labs, canEdit }: { id: string; tests: string[]; labs: Record<string, Lab>; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<string[]>(tests)
  const { run, busy } = useAction()
  return (
    <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Tests &amp; procedures · {tests.length}</div>
        {canEdit && (
          <button type="button" onClick={() => (setSel(tests), setOpen(true))} className="flex h-9 items-center gap-1 px-1 text-[14px] font-semibold text-primary-700">
            <Plus size={16} /> Add
          </button>
        )}
      </div>
      {tests.length ? (
        <div className="mt-2 divide-y divide-slate-100">
          {tests.map((t) => {
            const l = labs[t]
            const tone = !l ? 'text-slate-400' : l.status === 'PENDING' ? 'text-[#B45309]' : l.flag && l.flag !== 'NORMAL' ? 'text-[#B91C1C]' : 'text-[#15803D]'
            return (
              <div key={t} className="flex min-h-10 items-center gap-2 py-1.5 text-[14px]">
                <span className="size-1.5 flex-none rounded-full bg-primary" />
                <span className="min-w-0 flex-1">{t}</span>
                {l && (
                  <span className={cx('text-[12px] font-bold', tone)}>
                    {l.status === 'PENDING' ? 'Pending' : l.summary || [l.value, l.unit].filter(Boolean).join(' ') || 'Resulted'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-1.5 text-[13px] text-slate-500">No tests or procedures listed.</div>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Tests & procedures"
        sub="Tick what was ordered or done at the visit"
        footer={
          <button
            type="button"
            disabled={busy}
            className={bigBtn('p')}
            onClick={async () => {
              const ok = await run(() => api(`/requests/${id}`, { method: 'PATCH', body: { tests: sel } }), 'Tests updated')
              if (ok) setOpen(false)
            }}
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            Save · {sel.length} selected
          </button>
        }
      >
        <div className="pb-2">
          <ChipPicker options={[...new Set([...TESTS_PROCEDURES, ...tests])]} value={sel} onChange={setSel} />
        </div>
      </Sheet>
    </div>
  )
}
