'use client'
// Household visit: other patients at the same address on one trip (same time, team and car), each with their own
// services and tests. Lists the household and adds a patient — someone already registered (the family's phone is
// searched first) or a quick new one who takes this patient's phone and address.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Home, Loader2, Plus, Search, UserPlus } from 'lucide-react'
import { api, useAction, ChipPicker, Drawer } from '@/components/client'
import { H360TestPicker } from '@/components/client/H360TestPicker'
import { StatusChip, btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import type { TestItem } from '@/lib/schemas'

export type HouseholdMember = { id: string; requestNo: string; name: string; services: string; status: string; lead: boolean; self: boolean }
type Found = { _id: string; name: string; phone?: string; uhid?: string; ageYears?: number; gender?: string }

const STARTED = ['EN_ROUTE', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED']

export function HouseholdDialog({
  r,
  onClose,
}: {
  r: { id: string; requestNo: string; status: string; patientName: string; patientId: string; patientPhone: string; patientCategory?: string; serviceOptions: { code: string; name: string }[]; household: HouseholdMember[] | null }
  onClose: () => void
}) {
  const router = useRouter()
  const { run, busy } = useAction()
  const members = r.household ?? []
  const canAdd = !STARTED.includes(r.status) && members.length < 4
  const [adding, setAdding] = useState(!members.length && canAdd)
  const [mode, setMode] = useState<'find' | 'new'>('find')
  const [q, setQ] = useState(r.patientPhone)
  const [found, setFound] = useState<Found[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<Found | null>(null)
  const [np, setNp] = useState({ name: '', ageYears: '', gender: '' as '' | 'M' | 'F' | 'O', phone: '' })
  const [codes, setCodes] = useState<string[]>([])
  const [other, setOther] = useState('')
  const [testItems, setTestItems] = useState<TestItem[]>([])
  const [tests, setTests] = useState<string[]>([])

  useEffect(() => {
    if (!adding || mode !== 'find') return
    const term = q.trim()
    if (term.length < 2) return setFound([])
    let live = true
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api<{ items: Found[] }>(`/patients?q=${encodeURIComponent(term)}&limit=8`)
        const inHouse = new Set([r.patientId])
        if (live) setFound(res.items.filter((p) => !inHouse.has(String(p._id))))
      } catch {
        if (live) setFound([])
      } finally {
        if (live) setSearching(false)
      }
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, mode, adding, r.patientId])

  const who = mode === 'find' ? !!picked : np.name.trim().length >= 2
  const what = codes.length > 0 || other.trim().length > 0
  async function save() {
    const res = await run(
      () =>
        api<{ id: string; requestNo: string }>(`/requests/${r.id}/household`, {
          body: {
            ...(mode === 'find' ? { patientId: picked!._id } : { patient: { name: np.name.trim(), ageYears: np.ageYears ? Number(np.ageYears) : undefined, gender: np.gender || undefined, phone: np.phone.trim() || undefined } }),
            serviceCodes: codes,
            otherService: other.trim() || undefined,
            tests,
            testItems,
          },
        }),
      'Patient added to this visit',
    )
    if (res) {
      onClose()
      router.refresh()
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Household visit"
      sub={`Same address, one trip — the same time, team and car for everyone`}
      footer={
        adding ? (
          <>
            <button type="button" className={btnClass('o', 'md', 'ml-auto')} onClick={() => (members.length ? setAdding(false) : onClose())}>
              Cancel
            </button>
            <button type="button" className={btnClass('p')} disabled={busy || !who || !what} onClick={save}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} Add to this visit
            </button>
          </>
        ) : (
          <button type="button" className={btnClass('o', 'md', 'ml-auto')} onClick={onClose}>
            Close
          </button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {members.length > 0 && (
          <section className="rounded-xl ring-1 ring-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-[13px] font-semibold text-slate-700">
              <Home size={15} className="text-primary" /> {members.length} patients at this address
            </div>
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.id} className={cx('flex items-center gap-3 px-3 py-2.5 text-[13.5px]', m.self && 'bg-primary-50/60')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">
                      {m.name}
                      {m.lead && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500">CAR</span>}
                    </div>
                    <div className="truncate text-[12px] text-slate-500">{m.services || '—'}</div>
                  </div>
                  {m.self ? (
                    <span className="text-[12px] text-slate-400">this one</span>
                  ) : (
                    <a href={`/requests/${m.id}`} className="text-[12.5px] font-medium text-primary-700 hover:underline">
                      {m.requestNo}
                    </a>
                  )}
                  <StatusChip status={m.status as any} sm />
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-100 px-3 py-2 text-[12px] text-slate-500">
              Confirm, assign, accept and reschedule on any one apply to all. The car requisition is made once (marked CAR) and names everyone. Cancel stays per patient.
            </div>
          </section>
        )}

        {!adding ? (
          canAdd ? (
            <button type="button" className={btnClass('o', 'md', 'self-start')} onClick={() => setAdding(true)}>
              <Plus size={16} /> Add another patient at this address
            </button>
          ) : (
            <div className="text-[12.5px] text-slate-500">{members.length >= 4 ? 'A household visit has at most 4 patients.' : 'Patients can be added only before the visit starts.'}</div>
          )
        ) : (
          <>
            <div className="text-[13px] text-slate-600">
              A new request for the other patient, with their own services and tests, at <b>{r.patientName}</b>&apos;s address and visit time.
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-[13px] font-semibold">
              {(['find', 'new'] as const).map((k) => (
                <button key={k} type="button" className={cx('flex-1 rounded-md py-1.5', mode === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')} onClick={() => setMode(k)}>
                  {k === 'find' ? 'Registered patient' : 'New patient'}
                </button>
              ))}
            </div>

            {mode === 'find' ? (
              <div className="flex flex-col gap-2">
                <label className="relative block">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="hc-input pl-9" value={q} onChange={(e) => (setQ(e.target.value), setPicked(null))} placeholder="Phone, UHID or name" />
                </label>
                <div className="text-[11.5px] text-slate-400">Family members registered with the same phone show first.</div>
                {searching && <div className="text-[12.5px] text-slate-400">Searching…</div>}
                {!searching && q.trim().length >= 2 && !found.length && (
                  <div className="text-[12.5px] text-slate-500">
                    Nobody found.{' '}
                    <button type="button" className="font-semibold text-primary-700" onClick={() => setMode('new')}>
                      Add as a new patient
                    </button>
                  </div>
                )}
                <ul className="flex flex-col gap-1.5">
                  {found.map((p) => (
                    <li key={p._id}>
                      <button
                        type="button"
                        onClick={() => setPicked(p)}
                        className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] ring-1', picked?._id === p._id ? 'bg-primary-50 ring-primary' : 'ring-slate-200 hover:bg-slate-50')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{p.name}</span>
                          <span className="block truncate text-[12px] text-slate-500">{[p.ageYears != null && `${p.ageYears}y`, p.gender, p.phone, p.uhid && `UHID ${p.uhid}`].filter(Boolean).join(' · ')}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="grid grid-cols-6 gap-3">
                <label className="col-span-6 block">
                  <span className="hc-label">
                    Name <span className="text-[#DC2626]">*</span>
                  </span>
                  <input className="hc-input" value={np.name} onChange={(e) => setNp((s) => ({ ...s, name: e.target.value }))} placeholder="Patient's full name" />
                </label>
                <label className="col-span-2 block">
                  <span className="hc-label">Age</span>
                  <input className="hc-input" inputMode="numeric" value={np.ageYears} onChange={(e) => setNp((s) => ({ ...s, ageYears: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
                </label>
                <label className="col-span-4 block">
                  <span className="hc-label">Gender</span>
                  <select className="hc-input" value={np.gender} onChange={(e) => setNp((s) => ({ ...s, gender: e.target.value as any }))}>
                    <option value="">—</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </select>
                </label>
                <label className="col-span-6 block">
                  <span className="hc-label">Phone</span>
                  <input className="hc-input" inputMode="tel" value={np.phone} onChange={(e) => setNp((s) => ({ ...s, phone: e.target.value }))} placeholder={`Leave empty to use ${r.patientPhone || 'the same phone'}`} />
                </label>
              </div>
            )}

            <div>
              <span className="hc-label">
                Services for this patient <span className="text-[#DC2626]">*</span>
              </span>
              <ChipPicker options={r.serviceOptions.map((s) => ({ value: s.code, label: s.name }))} value={codes} onChange={setCodes} />
              <input className="hc-input mt-2" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other service (optional)" />
            </div>
            <div>
              <span className="hc-label">Tests</span>
              <H360TestPicker compact value={testItems} onChange={setTestItems} plain={tests} onPlainChange={setTests} patientType={r.patientCategory} corporate={/corporate/i.test(r.patientCategory ?? '')} />
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
