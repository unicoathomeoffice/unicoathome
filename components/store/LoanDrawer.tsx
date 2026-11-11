'use client'
// Take a loan (borrow — stock goes up, we owe it back) or give a loan (lend — stock goes down, they owe us). The
// partner is typed by hand: a department / store, a staff member, or someone outside the hospital.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDownLeft, ArrowUpRight, Loader2 } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { ItemPicker, type Line, type PickItem } from './ItemPicker'

type Partner = { name: string; kind: string; phone: string | null }
const KINDS = [
  ['DEPARTMENT', 'Department / store'],
  ['STAFF', 'Staff member'],
  ['OUTSIDE', 'Outside'],
] as const
const inDays = (n: number) => new Date(Date.now() + 6 * 3600_000 + n * 86400_000).toISOString().slice(0, 10)

export function LoanDrawer({ direction: initialDir, items, preset = [], onClose }: { direction: 'TAKEN' | 'GIVEN'; items: PickItem[]; preset?: string[]; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [direction, setDirection] = useState(initialDir)
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('DEPARTMENT')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [lines, setLines] = useState<Line[]>(preset.map((itemId) => ({ itemId, qty: 1 })))
  const [due, setDue] = useState(inDays(7))
  const [requestNo, setRequestNo] = useState('')
  const [note, setNote] = useState('')
  const [partners, setPartners] = useState<Partner[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<{ partners: Partner[] }>('/store/loans?status=open')
      .then((r) => setPartners(r.partners))
      .catch(() => {})
  }, [])
  const taken = direction === 'TAKEN'
  const suggestions = partners.filter((p) => p.kind === kind)

  async function save() {
    if (name.trim().length < 2) return toast(taken ? 'Who did we borrow from?' : 'Who are we lending to?', 'err')
    if (!lines.length) return toast('Add at least one item', 'err')
    setBusy(true)
    try {
      const r = await api<{ no: string; short: string[] }>('/store/loans', {
        body: { direction, partner: { kind, name: name.trim(), phone: phone.trim() || undefined }, items: lines, dueAt: due || undefined, note: note.trim() || undefined, requestNo: requestNo.trim() || undefined },
      })
      toast(`${r.no} saved · ${taken ? 'added to' : 'taken out of'} the store${r.short.length ? ` · more than in stock: ${r.short.join(', ')}` : ''}`, r.short.length ? 'err' : 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={taken ? 'Take a loan (borrow)' : 'Give a loan (lend)'}
      sub={taken ? 'Items we borrow come into the store — we owe them back' : 'Items we lend go out of the store — they owe them back'}
      width={540}
      footer={
        <>
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !lines.length} className={btnClass('p')} onClick={save}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : taken ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />} {taken ? 'Borrow' : 'Lend'} {lines.reduce((a, l) => a + l.qty, 0) || ''}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-1.5">
          {(['TAKEN', 'GIVEN'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDirection(d)} className={cx('flex h-11 items-center justify-center gap-1.5 rounded-lg border text-[13.5px] font-semibold', direction === d ? (d === 'TAKEN' ? 'border-[#4338CA] bg-[#EEF2FF] text-[#4338CA]' : 'border-[#B45309] bg-[#FFFBEB] text-[#B45309]') : 'border-slate-300 bg-white text-slate-600')}>
              {d === 'TAKEN' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />} {d === 'TAKEN' ? 'Take loan · borrow' : 'Give loan · lend'}
            </button>
          ))}
        </div>
        <div>
          <span className="hc-label">{taken ? 'Borrowed from' : 'Lent to'} *</span>
          <div className="mb-1.5 flex gap-1">
            {KINDS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={cx('h-8 rounded-full px-3 text-[12.5px] font-semibold', kind === k ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-600')}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_150px] gap-2">
            <input className="hc-input" list="loan-partners" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'DEPARTMENT' ? 'e.g. Emergency, MICU L-7, OT' : kind === 'STAFF' ? 'Staff name' : 'Hospital / supplier name'} autoFocus />
            <input className="hc-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" />
          </div>
          <datalist id="loan-partners">
            {suggestions.map((p) => (
              <option key={p.name} value={p.name} />
            ))}
          </datalist>
        </div>
        <ItemPicker items={items} lines={lines} setLines={setLines} mode={taken ? 'in' : 'out'} />
        <div className="grid grid-cols-2 gap-2.5">
          <label>
            <span className="hc-label">Return by</span>
            <input type="date" className="hc-input" value={due} min={inDays(0)} onChange={(e) => setDue(e.target.value)} />
            <span className="mt-1 flex gap-2 text-[12px]">
              {[1, 3, 7, 14].map((n) => (
                <button key={n} type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => setDue(inDays(n))}>
                  +{n}d
                </button>
              ))}
              <button type="button" className="text-slate-500 hover:underline" onClick={() => setDue('')}>
                no date
              </button>
            </span>
          </label>
          <label>
            <span className="hc-label">Visit (optional)</span>
            <input className="hc-input" value={requestNo} onChange={(e) => setRequestNo(e.target.value)} placeholder="HC-261111-0001" />
          </label>
        </div>
        <label>
          <span className="hc-label">Note</span>
          <input className="hc-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. urgent for a home visit, given by Sister Rina" />
        </label>
      </div>
    </Drawer>
  )
}
