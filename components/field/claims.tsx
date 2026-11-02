'use client'
// Field app → My claims: travel (rickshaw / Uber / Pathao…), food and other expenses for the hospital's Bill
// Submission form. Trips from my visits are suggested with the patient, UHID and route already filled; add the amount
// and a receipt photo any time (e.g. after getting back), then Submit → the filled form goes to the security supervisor.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Car, CheckCircle2, FileSpreadsheet, FileText, Loader2, Plus, Receipt, Send, Trash2, Utensils, X } from 'lucide-react'
import { api, compressImage, Sheet, useToast } from '@/components/client'
import { cx, taka } from '@/lib/format'
import { bigBtn } from './bar'

type Line = { _id: string; kind: 'CONVEYANCE' | 'FOOD' | 'OTHER'; requestId?: string; leg?: 'OUT' | 'BACK'; at?: string; uhid?: string; patientName?: string; invoiceNo?: string; from?: string; to?: string; mode?: string; amount: number; receiptIds?: string[]; note?: string }
type Claim = { _id: string; claimNo: string; status: string; lines: Line[]; total: number; submittedAt?: string; decisionNote?: string; pdfId?: string; xlsxId?: string }
type Suggest = Omit<Line, '_id' | 'amount'> & { requestNo: string; amount: number | null }

const MODES = ['Rickshaw', 'Uber', 'Pathao', 'CNG', 'Bus', 'Other']
const FOOD = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Other']
const STATUS: Record<string, string> = { SUBMITTED: 'bg-[#E0F2FE] text-[#0369A1]', APPROVED: 'bg-[#DCFCE7] text-[#15803D]', REJECTED: 'bg-[#FEE2E2] text-[#B91C1C]', PAID: 'bg-slate-900 text-white' }
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const local = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date()
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}

export function ClaimsScreen({ initialClaim, initialSuggestions, history, focusVisit }: { initialClaim: Claim; initialSuggestions: Suggest[]; history: Claim[]; focusVisit?: string }) {
  const router = useRouter()
  const toast = useToast()
  const [claim, setClaim] = useState(initialClaim)
  const [sugg, setSugg] = useState(initialSuggestions)
  const [edit, setEdit] = useState<null | { line?: Line; preset?: Partial<Line> }>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // opened from a visit ("Add expense"): start with that visit's first unclaimed trip
    if (!focusVisit) return
    const s = initialSuggestions.find((x) => x.requestId === focusVisit)
    setEdit({ preset: s ? { ...s, amount: s.amount ?? undefined } as any : { kind: 'CONVEYANCE', requestId: focusVisit } })
  }, [focusVisit, initialSuggestions])

  async function reload() {
    const r = await api<{ claim: Claim; suggestions: Suggest[] }>('/claims/current')
    setClaim(r.claim)
    setSugg(r.suggestions)
  }
  async function remove(l: Line) {
    try {
      const r = await api<{ claim: Claim }>(`/claims/current/lines/${l._id}`, { method: 'DELETE' })
      setClaim(r.claim)
      reload()
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }
  async function submit() {
    if (!confirm(`Submit ${claim.claimNo} for ${taka(claim.total)}? The filled form is sent to the security supervisor.`)) return
    setBusy(true)
    try {
      const r = await api<{ sent: number }>('/claims/current', { body: { submit: true } })
      toast(r.sent ? 'Submitted · form sent to the security supervisor' : 'Submitted · form made (WhatsApp not paired — download it below)', 'ok')
      router.refresh()
      await reload()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const icon = (k: string) => (k === 'FOOD' ? <Utensils size={18} /> : k === 'OTHER' ? <Receipt size={18} /> : <Car size={18} />)
  return (
    <div className="flex flex-col gap-3 pb-28">
      {/* current claim */}
      <section className="rounded-card bg-white p-4 shadow-card">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Open claim · {claim.claimNo}</div>
            <div className="text-[26px] font-bold">{taka(claim.total)}</div>
          </div>
          <span className="text-[13px] text-slate-500">{claim.lines.length} item{claim.lines.length === 1 ? '' : 's'}</span>
        </div>
        <div className="mt-3 flex flex-col divide-y divide-slate-100">
          {claim.lines.map((l) => (
            <div key={l._id} className="flex items-center gap-3 py-2.5">
              <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">{icon(l.kind)}</span>
              <button type="button" onClick={() => setEdit({ line: l })} className="min-w-0 flex-1 text-left">
                <div className="truncate text-[14.5px] font-semibold">{l.kind === 'CONVEYANCE' ? `${l.from ?? ''} → ${l.to ?? ''}` : l.kind === 'FOOD' ? `${l.mode ?? 'Food'}` : l.mode ?? 'Other'}</div>
                <div className="truncate text-[12.5px] text-slate-500">
                  {[l.mode && l.kind === 'CONVEYANCE' ? l.mode : null, when(l.at), l.patientName].filter(Boolean).join(' · ')}
                  {l.receiptIds?.length ? ' · 🧾' : ''}
                </div>
              </button>
              <span className="text-[15px] font-bold">{taka(l.amount)}</span>
              <button type="button" onClick={() => remove(l)} className="flex size-9 items-center justify-center rounded-lg text-slate-400 active:bg-slate-100" aria-label="Remove">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {!claim.lines.length && <div className="py-4 text-center text-[13.5px] text-slate-500">No expenses yet — add a trip below or tap + Add expense.</div>}
        </div>
      </section>

      {/* suggested trips */}
      {sugg.length > 0 && (
        <section className="rounded-card bg-white p-4 shadow-card">
          <div className="mb-1 text-[15px] font-bold">Trips from your visits</div>
          <div className="mb-2 text-[12.5px] text-slate-500">Patient, UHID and route are filled — add the fare and receipt.</div>
          <div className="flex flex-col divide-y divide-slate-100">
            {sugg.slice(0, 12).map((s) => (
              <button key={`${s.requestId}-${s.leg}`} type="button" onClick={() => setEdit({ preset: { ...s, amount: s.amount ?? undefined } as any })} className="flex items-center gap-3 py-2.5 text-left active:bg-slate-50">
                <span className={cx('rounded-md px-1.5 py-0.5 text-[10.5px] font-bold', s.leg === 'OUT' ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-600')}>{s.leg === 'OUT' ? 'TO PATIENT' : 'BACK'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{s.patientName}</span>
                  <span className="block truncate text-[12px] text-slate-500">
                    {s.requestNo} · {when(s.at)}
                    {s.mode ? ` · ${s.mode}` : ''}
                  </span>
                </span>
                <Plus size={18} className="text-primary-700" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* history */}
      {history.length > 0 && (
        <section className="rounded-card bg-white p-4 shadow-card">
          <div className="mb-2 text-[15px] font-bold">Submitted claims</div>
          <div className="flex flex-col divide-y divide-slate-100">
            {history.map((c) => (
              <div key={c._id} className="flex items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold">
                    {c.claimNo} · {taka(c.total)}
                  </span>
                  <span className="block truncate text-[12px] text-slate-500">
                    {when(c.submittedAt)}
                    {c.decisionNote ? ` · ${c.decisionNote}` : ''}
                  </span>
                </span>
                <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS[c.status] ?? 'bg-slate-100')}>{c.status.toLowerCase()}</span>
                {c.pdfId && (
                  <a href={`/api/v1/attachments/${c.pdfId}`} target="_blank" rel="noreferrer" className="flex size-9 items-center justify-center rounded-lg text-primary-700 active:bg-slate-100" aria-label="PDF">
                    <FileText size={17} />
                  </a>
                )}
                {c.xlsxId && (
                  <a href={`/api/v1/attachments/${c.xlsxId}`} className="flex size-9 items-center justify-center rounded-lg text-[#15803D] active:bg-slate-100" aria-label="Excel">
                    <FileSpreadsheet size={17} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[480px] gap-2.5 border-t border-slate-200 bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <button type="button" onClick={() => setEdit({ preset: { kind: 'CONVEYANCE' } })} className={bigBtn('o', 'flex-1')}>
          <Plus size={18} /> Add expense
        </button>
        <button type="button" disabled={busy || !claim.lines.length} onClick={submit} className={bigBtn(claim.lines.length ? 'p' : 'd', 'flex-[1.3]')}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Submit claim
        </button>
      </div>

      {edit && (
        <LineSheet
          line={edit.line}
          preset={edit.preset}
          onClose={() => setEdit(null)}
          onSaved={(c) => {
            setClaim(c)
            setEdit(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function LineSheet({ line, preset, onClose, onSaved }: { line?: Line; preset?: Partial<Line>; onClose: () => void; onSaved: (c: Claim) => void }) {
  const toast = useToast()
  const src: Partial<Line> = line ?? preset ?? { kind: 'CONVEYANCE' }
  const [v, setV] = useState({
    kind: src.kind ?? 'CONVEYANCE',
    at: local(src.at),
    from: src.from ?? '',
    to: src.to ?? '',
    mode: src.mode ?? '',
    amount: src.amount != null ? String(src.amount) : '',
    uhid: src.uhid ?? '',
    patientName: src.patientName ?? '',
    invoiceNo: src.invoiceNo ?? '',
    note: src.note ?? '',
  })
  const [receipts, setReceipts] = useState<string[]>(src.receiptIds ?? [])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })

  async function addReceipt(f?: File) {
    if (!f) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', f.type.startsWith('image/') ? await compressImage(f, false) : f)
      form.append('kind', 'RECEIPT')
      form.append('caption', 'Expense receipt')
      const r = await api<{ id: string }>('/attachments', { form })
      setReceipts((x) => [...x, r.id])
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setUploading(false)
    }
  }
  async function save() {
    if (!(Number(v.amount) > 0)) return toast('Enter the amount', 'err')
    setBusy(true)
    try {
      const body = {
        kind: v.kind,
        at: new Date(`${v.at}:00+06:00`).toISOString(),
        from: v.from || undefined,
        to: v.to || undefined,
        mode: v.mode || undefined,
        amount: Number(v.amount),
        uhid: v.uhid || undefined,
        patientName: v.patientName || undefined,
        invoiceNo: v.invoiceNo || undefined,
        note: v.note || undefined,
        receiptIds: receipts,
        ...(line ? {} : { requestId: preset?.requestId, leg: preset?.leg }),
      }
      const r = line ? await api<{ claim: Claim }>(`/claims/current/lines/${line._id}`, { method: 'PATCH', body }) : await api<{ claim: Claim }>('/claims/current', { body })
      onSaved(r.claim)
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  const choices = v.kind === 'FOOD' ? FOOD : v.kind === 'CONVEYANCE' ? MODES : []
  return (
    <Sheet open onClose={onClose} title={line ? 'Edit expense' : 'Add expense'} sub={v.patientName ? `${v.patientName}${v.uhid ? ` · UHID ${v.uhid}` : ''}` : 'Travel, food or other cost for a visit'}>
      <div className="flex flex-col gap-3 pb-3">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['CONVEYANCE', 'Travel'],
              ['FOOD', 'Food'],
              ['OTHER', 'Other'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setV({ ...v, kind: k, mode: '' })} className={cx('h-11 rounded-xl border-[1.5px] text-[14px] font-semibold', v.kind === k ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-700')}>
              {l}
            </button>
          ))}
        </div>
        {choices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {choices.map((m) => (
              <button key={m} type="button" onClick={() => setV({ ...v, mode: m })} className={cx('h-10 rounded-full border-[1.5px] px-3.5 text-[13.5px] font-semibold', v.mode === m ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600')}>
                {m}
              </button>
            ))}
          </div>
        )}
        {v.kind === 'OTHER' && (
          <label>
            <span className="hc-label">Expense head</span>
            <input className="hc-input hc-input-lg" value={v.mode} onChange={set('mode')} placeholder="e.g. Medicine bought for patient" />
          </label>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <label>
            <span className="hc-label">Amount (৳) *</span>
            <input className="hc-input hc-input-lg !text-[18px] font-bold" inputMode="decimal" value={v.amount} onChange={set('amount')} placeholder="0" autoFocus />
          </label>
          <label>
            <span className="hc-label">Date &amp; time</span>
            <input type="datetime-local" className="hc-input hc-input-lg" value={v.at} onChange={set('at')} />
          </label>
        </div>
        {v.kind !== 'OTHER' && (
          <div className="grid grid-cols-2 gap-2.5">
            <label>
              <span className="hc-label">From</span>
              <input className="hc-input hc-input-lg" value={v.from} onChange={set('from')} placeholder="Unico Hospitals" />
            </label>
            <label>
              <span className="hc-label">To</span>
              <input className="hc-input hc-input-lg" value={v.to} onChange={set('to')} placeholder="Patient address" />
            </label>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label>
            <span className="hc-label">UHID</span>
            <input className="hc-input" value={v.uhid} onChange={set('uhid')} />
          </label>
          <label className="col-span-2">
            <span className="hc-label">Patient</span>
            <input className="hc-input" value={v.patientName} onChange={set('patientName')} />
          </label>
        </div>
        <div>
          <span className="hc-label">Receipt / ride screenshot</span>
          <div className="flex flex-wrap items-center gap-2">
            {receipts.map((id) => (
              <span key={id} className="relative">
                <img src={`/api/v1/attachments/${id}`} alt="Receipt" className="size-16 rounded-lg object-cover ring-1 ring-slate-200" />
                <button type="button" onClick={() => setReceipts((x) => x.filter((y) => y !== id))} className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-slate-900 text-white" aria-label="Remove receipt">
                  <X size={13} />
                </button>
              </span>
            ))}
            {receipts.length < 5 && (
              <label className="flex size-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-[1.5px] border-dashed border-slate-300 text-[11px] text-slate-500">
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                Add
                <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => (addReceipt(e.target.files?.[0]), (e.target.value = ''))} />
              </label>
            )}
          </div>
        </div>
        <button type="button" disabled={busy || uploading} onClick={save} className={bigBtn('p', 'w-full')}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} {line ? 'Save' : 'Add to claim'}
        </button>
      </div>
    </Sheet>
  )
}
