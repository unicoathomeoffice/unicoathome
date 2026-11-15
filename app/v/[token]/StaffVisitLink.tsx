'use client'
// The no-login staff link: first the employee ID (once per phone), then the visit — bag to pack (− / +) and the checklist.
import { useCallback, useEffect, useState } from 'react'
import { Check, CheckCircle2, ClipboardList, KeyRound, Loader2, Lock, Minus, Package, Plus, ShieldCheck, Stethoscope } from 'lucide-react'

type Kit = { itemId: string; name: string; type: string; unit: string; image: string | null; recommendedQty: number; minQty: number; packedQty: number; packedByName: string | null }
type Data =
  | { ok: false; reason: string; message?: string }
  | { ok: true; verified: false; first: string }
  | {
      ok: true
      verified: true
      me: string
      visit: { when: string | null; services: string[]; tests: string[]; patient: string; area: string | null; status: string; team: string[]; pickup: string | null }
      canPack: boolean
      kit: Kit[]
      checklist: { key: string; label: string; mandatory: boolean; done: boolean }[]
    }

const api = (token: string, init?: RequestInit) => fetch(`/api/v1/public/visit-link/${token}`, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })

export function StaffVisitLink({ token }: { token: string }) {
  const [d, setD] = useState<Data | null>(null)
  const [id, setId] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await api(token).catch(() => null)
    setD(res ? await res.json().catch(() => ({ ok: false, reason: 'invalid' })) : { ok: false, reason: 'offline', message: 'No connection — try again.' })
  }, [token])
  useEffect(() => {
    void load()
  }, [load])

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!id.trim()) return
    setBusy('verify')
    setErr(null)
    try {
      const res = await api(token, { method: 'POST', body: JSON.stringify({ employeeId: id }) })
      const j = await res.json()
      if (!j.ok) setErr(j.message ?? 'Not accepted')
      else await load()
    } finally {
      setBusy(null)
    }
  }
  async function pack(k: Kit, qty: number) {
    if (!d || !('kit' in d)) return
    setBusy(k.itemId)
    setErr(null)
    // instant on screen, then saved
    setD({ ...d, kit: d.kit.map((x) => (x.itemId === k.itemId ? { ...x, packedQty: qty } : x)) })
    try {
      const res = await api(token, { method: 'PATCH', body: JSON.stringify({ itemId: k.itemId, packedQty: qty }) })
      const j = await res.json()
      if (!j.ok) {
        setErr(j.error?.message ?? j.message ?? 'Could not save')
        await load()
      }
    } finally {
      setBusy(null)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh bg-[#F1F5F9]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col bg-white shadow-sm">
        <header className="flex items-center gap-2.5 bg-[#1F3864] px-4 py-3.5 text-white">
          <img src="/logo.svg" alt="Unico Hospitals" className="h-8 brightness-0 invert" />
          <span className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold">
            <ShieldCheck size={12} /> Staff only
          </span>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </div>
    </div>
  )

  if (!d)
    return shell(
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={26} className="animate-spin text-slate-400" />
      </div>,
    )
  if (!d.ok)
    return shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Lock size={26} />
        </span>
        <div className="text-[16px] font-bold text-slate-800">{d.message ?? 'This link is not valid any more.'}</div>
        <div className="max-w-[300px] text-[13px] text-slate-500">Links work only for the assigned staff member, until the visit is over. Ask the Home Care coordinator for a new one.</div>
      </div>,
    )
  if (!d.verified)
    return shell(
      <form onSubmit={verify} className="flex flex-1 flex-col justify-center gap-4">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#E0F2FE] text-[#0369A1]">
            <KeyRound size={26} />
          </span>
          <div className="mt-3 text-[18px] font-bold text-slate-900">Hello{d.first ? ` ${d.first}` : ''}</div>
          <div className="mt-1 text-[13.5px] text-slate-500">Enter your employee ID once to open your visit on this phone.</div>
        </div>
        <input value={id} onChange={(e) => setId(e.target.value)} inputMode="text" autoComplete="off" autoFocus placeholder="Employee ID — e.g. 11432" className="h-12 rounded-xl border-[1.5px] border-slate-300 px-4 text-center text-[17px] font-semibold tracking-wide outline-none focus:border-[#0090CA]" />
        {err && <div className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-center text-[13px] font-semibold text-[#B91C1C]">{err}</div>}
        <button type="submit" disabled={!!busy || !id.trim()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0090CA] text-[15px] font-bold text-white disabled:opacity-50">
          {busy && <Loader2 size={18} className="animate-spin" />} Open my visit
        </button>
        <div className="text-center text-[11.5px] text-slate-400">Only for Unico Home Care staff. Every open is recorded.</div>
      </form>,
    )

  const v = d.visit
  const must = d.kit.filter((k) => k.minQty > 0)
  const packedOk = must.filter((k) => k.packedQty >= k.minQty).length
  return shell(
    <>
      <section className="rounded-2xl bg-gradient-to-br from-[#E0F2FE] to-white p-4 ring-1 ring-[#BAE6FD]">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-[#0369A1]">Your visit · {d.me}</div>
        <div className="mt-1 text-[18px] font-bold text-slate-900">{v.services.join(', ') || 'Home visit'}</div>
        <div className="mt-0.5 text-[14px] text-slate-700">
          {v.when ?? 'Time to be confirmed'}
          {v.area ? ` · ${v.area}` : ''}
        </div>
        <div className="mt-1 text-[13px] text-slate-500">
          Patient: {v.patient}
          {v.team.length ? ` · Team: ${v.team.join(', ')}` : ''}
        </div>
        {v.pickup && <div className="mt-1 text-[13px] font-semibold text-[#92400E]">Unico car pick-up at hospital: {v.pickup}</div>}
        {v.tests.length > 0 && <div className="mt-1.5 text-[12.5px] text-slate-600">Tests: {v.tests.join(', ')}</div>}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Package size={18} className="text-[#0090CA]" />
          <span className="text-[15px] font-bold">Bag — what to take</span>
          {must.length > 0 && (
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[12px] font-bold ${packedOk === must.length ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEF3C7] text-[#B45309]'}`}>
              {packedOk}/{must.length} must-take packed
            </span>
          )}
        </div>
        {!d.canPack && <div className="mb-2 rounded-lg bg-slate-100 px-3 py-2 text-[12.5px] text-slate-600">The journey has started — the bag is already packed.</div>}
        {err && <div className="mb-2 rounded-lg bg-[#FEF2F2] px-3 py-2 text-[12.5px] font-semibold text-[#B91C1C]">{err}</div>}
        {!d.kit.length ? (
          <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-[13px] text-slate-500">No bag list for this service.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.kit.map((k) => {
              const ok = k.packedQty >= Math.max(1, k.minQty)
              return (
                <li key={k.itemId} className={`flex items-center gap-3 rounded-xl p-2.5 ring-1 ${ok ? 'bg-[#F0FDF4] ring-[#BBF7D0]' : 'bg-white ring-slate-200'}`}>
                  <span className="flex size-14 flex-none items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                    {k.image ? <img src={k.image} alt="" className="size-full object-contain p-1" /> : <Package size={22} className="text-slate-300" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold leading-snug text-slate-900">{k.name}</span>
                    <span className="block text-[12px] text-slate-500">
                      {k.minQty > 0 ? <b className="text-[#B45309]">must take {k.minQty}</b> : 'optional'} · usual {k.recommendedQty} {k.unit}
                    </span>
                    {k.packedByName && k.packedQty > 0 && <span className="block text-[11px] text-[#15803D]">packed by {k.packedByName}</span>}
                  </span>
                  <span className="flex flex-none items-center gap-1">
                    <button type="button" disabled={!d.canPack || busy === k.itemId || k.packedQty <= 0} onClick={() => pack(k, k.packedQty - 1)} className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-700 disabled:opacity-40" aria-label="One less">
                      <Minus size={17} />
                    </button>
                    <span className="w-7 text-center text-[16px] font-bold tabular-nums">{k.packedQty}</span>
                    <button type="button" disabled={!d.canPack || busy === k.itemId || k.packedQty >= 99} onClick={() => pack(k, k.packedQty + 1)} className="flex size-10 items-center justify-center rounded-full bg-[#0090CA] text-white disabled:opacity-40" aria-label="One more">
                      <Plus size={17} />
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList size={18} className="text-[#0090CA]" />
          <span className="text-[15px] font-bold">Visit checklist</span>
          <span className="ml-auto text-[12px] text-slate-500">ticked in the app during the visit</span>
        </div>
        {!d.checklist.length ? (
          <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-[13px] text-slate-500">No checklist for this service.</div>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {d.checklist.map((c) => (
              <li key={c.key} className="flex items-center gap-2.5 px-3 py-2.5 text-[14px]">
                {c.done ? <CheckCircle2 size={18} className="flex-none text-[#16A34A]" /> : <span className="size-[18px] flex-none rounded-full border-2 border-slate-300" />}
                <span className={c.done ? 'text-slate-500 line-through' : 'text-slate-800'}>{c.label}</span>
                {c.mandatory && !c.done && <span className="ml-auto flex-none rounded bg-[#FEF3C7] px-1.5 text-[10.5px] font-bold uppercase text-[#B45309]">required</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-center gap-1.5 pb-2 text-[11.5px] text-slate-400">
        <Stethoscope size={12} /> Unico Hospitals · Home Care · <Check size={12} /> Staff link
      </div>
    </>,
  )
}
