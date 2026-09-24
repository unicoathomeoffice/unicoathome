'use client'
// L1 (6f) Prescription & lab results. Doctors on the team write / sign the e-Rx; everyone else reads.
// Lab results: pending with ETA, the care team can enter a value / flag.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api, useToast, Segmented, Sheet } from '@/components/client'
import { Avatar, Tag, btnClass } from '@/components/ui'
import { cx, dateTime, day, time, dayNum } from '@/lib/format'
import { BottomBar, CHeader, Body, bigBtn } from './bar'

type Item = { drug: string; dose?: string; duration?: string; note?: string }
type Rx = { _id?: string; dx?: string; items?: Item[]; advice?: string; status?: string; signedAt?: string; updatedAt?: string; createdAt?: string } | null
type Lab = { _id: string | null; test: string; value?: string; unit?: string; refRange?: string; flag?: string; summary?: string; status: string; eta?: string; resultedAt?: string }

const FLAG_TONE: Record<string, string> = { NORMAL: 'text-[#15803D]', HIGH: 'text-[#B45309]', LOW: 'text-[#B45309]', ABNORMAL: 'text-[#B91C1C]' }

export function RxScreen({
  id,
  title,
  sub,
  tab: tab0,
  rx: rx0,
  doctor,
  me,
  canEdit,
  labs,
  canEnter,
  sampleAt,
}: {
  id: string
  title: string
  sub: string
  tab: 'rx' | 'labs'
  rx: Rx
  doctor: { name: string; employeeId: string; designation: string } | null
  me: { name: string; employeeId: string; designation?: string }
  canEdit: boolean
  labs: Lab[]
  canEnter: boolean
  sampleAt?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<'rx' | 'labs'>(tab0)
  const [dx, setDx] = useState(rx0?.dx ?? '')
  const [items, setItems] = useState<Item[]>(rx0?.items?.length ? rx0.items : canEdit ? [{ drug: '', dose: '', duration: '' }] : [])
  const [advice, setAdvice] = useState(rx0?.advice ?? '')
  const [status, setStatus] = useState(rx0?.status ?? 'DRAFT')
  const [busy, setBusy] = useState<'' | 'save' | 'sign'>('')
  const [sent, setSent] = useState<{ logId: string } | null>(null)
  const [edit, setEdit] = useState<Lab | null>(null)
  const [lab, setLab] = useState({ value: '', unit: '', refRange: '', flag: 'NORMAL', summary: '', eta: '' })
  const editable = canEdit && status !== 'SIGNED'
  const doc = doctor ?? (canEdit ? { name: me.name, employeeId: me.employeeId, designation: me.designation ?? 'Doctor' } : null)
  const payload = () => ({ dx, advice, items: items.filter((i) => i.drug.trim()).map((i) => ({ drug: i.drug.trim(), dose: i.dose || undefined, duration: i.duration || undefined })) })
  const setItem = (i: number, p: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)))

  async function saveDraft() {
    setBusy('save')
    try {
      await api(`/requests/${id}/prescription`, { method: 'PUT', body: payload() })
      toast(`Draft saved · ${time(new Date())}`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy('')
    }
  }
  async function sign() {
    if (!window.confirm('Sign this prescription? It cannot be edited afterwards.')) return
    setBusy('sign')
    try {
      const r = await api<{ whatsapp: { url: string; logId: string } | null; consent: boolean }>(`/requests/${id}/prescription`, { body: payload() })
      setStatus('SIGNED')
      if (r.whatsapp) {
        window.open(r.whatsapp.url, '_blank')
        setSent({ logId: r.whatsapp.logId })
      } else toast(r.consent ? 'Signed · patient has no phone on file' : 'Signed · patient has not consented to WhatsApp', 'info')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy('')
    }
  }
  async function saveLab() {
    if (!edit) return
    setBusy('save')
    try {
      await api(`/requests/${id}/labs`, {
        body: {
          id: edit._id ?? undefined,
          test: edit.test,
          value: lab.value || undefined,
          unit: lab.unit || undefined,
          refRange: lab.refRange || undefined,
          flag: lab.value || lab.summary ? lab.flag : undefined,
          summary: lab.summary || undefined,
          eta: lab.eta ? new Date(lab.eta).toISOString() : undefined,
          pending: !lab.value && !lab.summary,
        },
      })
      toast(lab.value || lab.summary ? `Result saved · ${edit.test}` : `Marked pending · ${edit.test}`, 'ok')
      setEdit(null)
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy('')
    }
  }

  const rxCard = (
    <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
      {doc ? (
        <div className="flex items-center gap-3">
          <Avatar name={doc.name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold">{doc.name}</div>
            <div className="text-[12px] text-slate-500">
              {doc.designation} · {doc.employeeId}
              {rx0?.updatedAt ? ` · ${dayNum(rx0.updatedAt)} ${time(rx0.updatedAt)}` : ''}
            </div>
          </div>
          <Tag tone={status === 'SIGNED' ? 'green' : 'amber'}>{status === 'SIGNED' ? 'SIGNED' : 'DRAFT'}</Tag>
        </div>
      ) : null}
      {!rx0 && !canEdit ? (
        <div className="py-6 text-center text-[13px] text-slate-500">No prescription written for this visit yet.</div>
      ) : (
        <>
          <div className="mt-3 text-[12px] font-semibold text-slate-500">Dx</div>
          {editable ? (
            <textarea value={dx} onChange={(e) => setDx(e.target.value)} placeholder="Diagnosis" className="hc-input mt-1 min-h-[60px] text-[15px]" />
          ) : (
            <div className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[22px]">{dx || '—'}</div>
          )}
          <div className="mt-3 text-[12px] font-semibold text-slate-500">Rx</div>
          <div className="mt-1.5 grid gap-2">
            {items.map((it, i) =>
              editable ? (
                <div key={i} className="grid gap-1.5 rounded-[10px] bg-slate-50 p-2.5">
                  <div className="flex gap-2">
                    <input value={it.drug} onChange={(e) => setItem(i, { drug: e.target.value })} placeholder="Medicine & strength" className="hc-input h-11 flex-1 text-[15px] font-semibold" />
                    <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="flex size-11 flex-none items-center justify-center rounded-lg text-slate-400" aria-label="Remove medicine">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-[1fr_100px] gap-2">
                    <input value={it.dose ?? ''} onChange={(e) => setItem(i, { dose: e.target.value })} placeholder="Dose · when" className="hc-input h-10 text-[14px]" />
                    <input value={it.duration ?? ''} onChange={(e) => setItem(i, { duration: e.target.value })} placeholder="Duration" className="hc-input h-10 text-[14px]" />
                  </div>
                </div>
              ) : (
                <div key={i} className="flex items-start justify-between gap-3 rounded-[10px] bg-slate-50 px-3 py-2.5">
                  <div>
                    <div className="text-[15px] font-bold">{it.drug}</div>
                    {it.dose && <div className="text-[12px] text-slate-500">{it.dose}</div>}
                  </div>
                  {it.duration && <div className="flex-none text-[12px] text-slate-500">{it.duration}</div>}
                </div>
              ),
            )}
            {!items.length && !editable && <div className="text-[13px] text-slate-400">No medicines</div>}
          </div>
          {editable && (
            <button type="button" onClick={() => setItems((xs) => [...xs, { drug: '', dose: '', duration: '' }])} className="mt-2 flex h-10 items-center gap-1.5 text-[14px] font-semibold text-primary-700">
              <Plus size={16} /> Add medicine
            </button>
          )}
          <div className="mt-3 text-[12px] font-semibold text-slate-500">Advice &amp; follow-up</div>
          {editable ? (
            <textarea value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="Advice, tests, follow-up" className="hc-input mt-1 min-h-[70px] text-[15px]" />
          ) : (
            <div className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[22px]">{advice || '—'}</div>
          )}
          {status === 'SIGNED' && rx0?.signedAt && (
            <div className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#15803D]">
              <ShieldCheck size={14} /> Signed {dateTime(rx0.signedAt)}
            </div>
          )}
        </>
      )}
    </div>
  )

  const labList = (
    <>
      <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">
        Lab results · {labs.length} test{labs.length === 1 ? '' : 's'}
        {sampleAt ? ` · sample ${dayNum(sampleAt)}` : ''}
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
        {labs.length ? (
          labs.map((l) => {
            const val = l.status === 'RESULTED' ? l.summary || [l.value, l.unit].filter(Boolean).join(' ') : null
            return (
              <button
                key={l._id ?? l.test}
                type="button"
                disabled={!canEnter}
                onClick={() => {
                  setLab({ value: l.value ?? '', unit: l.unit ?? '', refRange: l.refRange ?? '', flag: l.flag ?? 'NORMAL', summary: l.summary ?? '', eta: l.eta ? new Date(new Date(l.eta).getTime() + 6 * 3600_000).toISOString().slice(0, 16) : '' })
                  setEdit(l)
                }}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">{l.test}</div>
                  <div className="text-[12px] text-slate-500">
                    {l.status === 'RESULTED' ? `Ref ${l.refRange || '—'}${l.resultedAt ? ` · ${dayNum(l.resultedAt)} ${time(l.resultedAt)}` : ''}` : l.eta ? `ETA ${day(l.eta)} ${time(l.eta)}` : l.status === 'NOT_SENT' ? 'Listed on the visit · no result yet' : 'Sample sent'}
                  </div>
                </div>
                {val ? (
                  <span className={cx('text-right text-[15px] font-bold', FLAG_TONE[l.flag ?? 'NORMAL'])}>{val}</span>
                ) : (
                  <Tag tone={l.status === 'NOT_SENT' ? 'slate' : 'amber'}>{l.status === 'NOT_SENT' ? 'No result' : 'Pending'}</Tag>
                )}
                <FileText size={16} className="flex-none text-slate-400" />
              </button>
            )
          })
        ) : (
          <div className="px-4 py-6 text-center text-[13px] text-slate-500">No tests on this visit.</div>
        )}
      </div>
    </>
  )

  return (
    <div className="min-w-0">
      <CHeader back={`/m/visits/${id}`} title={title} sub={sub} />
      <Body>
        <Segmented
          value={tab}
          onChange={setTab}
          items={[
            { value: 'rx', label: 'Prescription' },
            { value: 'labs', label: 'Lab results' },
          ]}
        />
        {tab === 'rx' ? (
          <>
            {rxCard}
            {labs.length > 0 && labList}
          </>
        ) : (
          labList
        )}
        <div className="text-center text-[12px] leading-[18px] text-slate-500">Prescription and results are shared as a PDF link, never as values inside a WhatsApp message.</div>
      </Body>
      {tab === 'rx' && editable && (
        <BottomBar>
          <button type="button" disabled={!!busy} onClick={saveDraft} className={bigBtn('o')}>
            {busy === 'save' && <Loader2 size={18} className="animate-spin" />}
            Save draft
          </button>
          <button type="button" disabled={!!busy} onClick={sign} className={bigBtn('p', 'flex-[1.4]')}>
            {busy === 'sign' && <Loader2 size={18} className="animate-spin" />}
            Sign &amp; send to patient
          </button>
        </BottomBar>
      )}

      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.test ?? ''}
        sub={edit?.status === 'RESULTED' ? 'Update the result' : 'Enter the result, or save an ETA while it is pending'}
        footer={
          <button type="button" disabled={!!busy} onClick={saveLab} className={bigBtn('p')}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            {lab.value || lab.summary ? 'Save result' : 'Save as pending'}
          </button>
        }
      >
        <div className="grid gap-3 pb-2">
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <label>
              <span className="hc-label text-[13px]">Value</span>
              <input className="hc-input hc-input-lg" value={lab.value} onChange={(e) => setLab({ ...lab, value: e.target.value })} placeholder="e.g. 8.1" />
            </label>
            <label>
              <span className="hc-label text-[13px]">Unit</span>
              <input className="hc-input hc-input-lg" value={lab.unit} onChange={(e) => setLab({ ...lab, unit: e.target.value })} placeholder="%" />
            </label>
          </div>
          <label>
            <span className="hc-label text-[13px]">Reference range</span>
            <input className="hc-input hc-input-lg" value={lab.refRange} onChange={(e) => setLab({ ...lab, refRange: e.target.value })} placeholder="e.g. < 6.5" />
          </label>
          <div>
            <span className="hc-label text-[13px]">Flag</span>
            <div className="flex flex-wrap gap-2">
              {['NORMAL', 'HIGH', 'LOW', 'ABNORMAL'].map((f) => (
                <button key={f} type="button" onClick={() => setLab({ ...lab, flag: f })} className={cx('h-9 rounded-full px-3.5 text-[13px] font-semibold', lab.flag === f ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
                  {f[0] + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className="hc-label text-[13px]">Summary (optional)</span>
            <input className="hc-input hc-input-lg" value={lab.summary} onChange={(e) => setLab({ ...lab, summary: e.target.value })} placeholder="e.g. Normal · ESR 18" />
          </label>
          <label>
            <span className="hc-label text-[13px]">Result ETA (if pending)</span>
            <input type="datetime-local" className="hc-input hc-input-lg" value={lab.eta} onChange={(e) => setLab({ ...lab, eta: e.target.value })} />
          </label>
        </div>
      </Sheet>

      {sent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-[17px] font-bold">Did you send it?</div>
            <div className="mt-1 text-sm text-slate-500">WhatsApp opened with the prescription link for the patient. Confirm once you tapped Send, so it is logged on the record.</div>
            <div className="mt-4 flex gap-2">
              <button className={btnClass('o', 'md', 'flex-1')} onClick={() => setSent(null)}>
                Not sent
              </button>
              <button
                className={btnClass('g', 'md', 'flex-1')}
                onClick={async () => {
                  await api(`/messages/${sent.logId}`, { method: 'PATCH', body: { status: 'SENT_CONFIRMED' } }).catch(() => {})
                  setSent(null)
                  toast('WhatsApp message logged', 'ok')
                }}
              >
                I sent it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
