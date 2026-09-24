'use client'
// M10 Notes & medications: nursing / clinical notes with autosave + dictation, medication rows, consumables, remarks.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, MicOff, Minus, Plus, Loader2, Trash2 } from 'lucide-react'
import { useToast, Segmented, Sheet } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx, time } from '@/lib/format'
import { sendOrQueue } from './live'
import { BottomBar, CHeader, Body, bigBtn } from './bar'

type Med = { _id?: string; drug: string; dose?: string; route?: string; time?: string; by?: string; byName?: string; at?: string }
type Cons = { item: string; qty: number }
const ROUTES = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhaled', 'Other']

function useDictation(onText: (t: string) => void) {
  const [on, setOn] = useState(false)
  const [supported, setSupported] = useState(false)
  const rec = useRef<any>(null)
  const cb = useRef(onText)
  cb.current = onText
  useEffect(() => {
    const SR = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition
    if (!SR) return
    setSupported(true)
    const r = new SR()
    r.lang = 'en-GB'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e: any) => {
      let t = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript
      if (t.trim()) cb.current(t.trim())
    }
    r.onend = () => setOn(false)
    r.onerror = () => setOn(false)
    rec.current = r
    return () => r.abort?.()
  }, [])
  const toggle = () => {
    if (!rec.current) return
    if (on) rec.current.stop()
    else {
      try {
        rec.current.start()
        setOn(true)
      } catch {}
    }
  }
  return { on, supported, toggle }
}

export function NotesEditor({
  id,
  editable,
  initial,
  meds,
  defaultTab,
  title,
  sub,
}: {
  id: string
  editable: boolean
  initial: { nursing: string; clinical: string; remarks: string; consumables: Cons[]; updatedAt?: string }
  meds: Med[]
  defaultTab: 'nursing' | 'clinical'
  title: string
  sub: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<'nursing' | 'clinical'>(defaultTab)
  const [f, setF] = useState({ nursing: initial.nursing, clinical: initial.clinical, remarks: initial.remarks, consumables: initial.consumables })
  const saved = useRef(JSON.stringify(f))
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'queued' | 'error'; at?: string }>({ kind: initial.updatedAt ? 'saved' : 'idle', at: initial.updatedAt })
  const [medOpen, setMedOpen] = useState(false)
  const [med, setMed] = useState<Med>({ drug: '', dose: '', route: 'Oral', time: '' })
  const [consOpen, setConsOpen] = useState(false)
  const [consName, setConsName] = useState('')
  const [busy, setBusy] = useState(false)

  const dict = useDictation((t) => setF((o) => ({ ...o, [tab]: (o[tab] ? o[tab].replace(/\s*$/, ' ') : '') + t.charAt(0).toUpperCase() + t.slice(1) + '. ' })))

  async function flush() {
    const now = JSON.stringify(f)
    if (now === saved.current || !editable) return true
    setState({ kind: 'saving' })
    try {
      const r = await sendOrQueue(`/requests/${id}/notes`, { nursing: f.nursing, clinical: f.clinical, remarks: f.remarks, consumables: f.consumables }, { label: 'Notes' })
      saved.current = now
      setState({ kind: r.queued ? 'queued' : 'saved', at: new Date().toISOString() })
      return true
    } catch (e: any) {
      setState({ kind: 'error' })
      toast(e.message, 'err')
      return false
    }
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    if (JSON.stringify(f) === saved.current) return
    const t = setTimeout(() => flushRef.current(), 1200)
    return () => clearTimeout(t)
  }, [f])

  const setQty = (i: number, d: number) => setF((o) => ({ ...o, consumables: o.consumables.map((c, j) => (j === i ? { ...c, qty: Math.max(0, (c.qty ?? 0) + d) } : c)).filter((c) => c.qty > 0 || d > 0) }))

  return (
    <div className="min-w-0">
      <CHeader back={`/m/visits/${id}`} title={title} sub={sub} />
      <Body>
        <Segmented
          value={tab}
          onChange={setTab}
          items={[
            { value: 'nursing', label: 'Nursing notes' },
            { value: 'clinical', label: 'Clinical notes' },
          ]}
        />
        <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
          <textarea
            value={f[tab]}
            disabled={!editable}
            onChange={(e) => setF((o) => ({ ...o, [tab]: e.target.value }))}
            onBlur={() => flush()}
            placeholder={tab === 'nursing' ? 'Patient condition, care given, advice to family…' : 'History, examination, assessment, plan…'}
            className="min-h-[150px] w-full resize-none bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
          />
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2.5">
            <span className={cx('text-[11px]', state.kind === 'error' ? 'text-[#B91C1C]' : 'text-slate-400')}>
              {state.kind === 'saving' ? 'Saving…' : state.kind === 'queued' ? `Saved offline ${time(state.at)} · will sync` : state.kind === 'saved' ? `Autosaved ${time(state.at)}` : state.kind === 'error' ? 'Not saved · retry' : 'Autosaves as you type'}
            </span>
            {editable && dict.supported && (
              <button type="button" onClick={dict.toggle} className={cx('flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold', dict.on ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'text-primary-700')}>
                {dict.on ? <MicOff size={16} /> : <Mic size={16} />}
                {dict.on ? 'Stop' : 'Dictate'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-1 flex items-center justify-between">
          <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Medications administered</div>
          {editable && (
            <button type="button" onClick={() => (setMed({ drug: '', dose: '', route: 'Oral', time: time(new Date()) }), setMedOpen(true))} className="flex h-9 items-center gap-1 text-[13px] font-semibold text-primary-700">
              <Plus size={16} /> Add
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
          {meds.length ? (
            meds.map((m, i) => (
              <div key={m._id ?? i} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold">
                    {m.drug}
                    {m.dose ? ` · ${m.dose}` : ''}
                  </div>
                  <div className="text-[12px] text-slate-500">{m.route || '—'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-bold">{m.time || time(m.at)}</div>
                  <div className="text-[11px] text-slate-400">{m.byName}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-3.5 text-[13px] text-slate-400">None recorded</div>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between">
          <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Consumables used</div>
          {editable && (
            <button type="button" onClick={() => (setConsName(''), setConsOpen(true))} className="flex h-9 items-center gap-1 text-[13px] font-semibold text-primary-700">
              <Plus size={16} /> Add
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
          {f.consumables.length ? (
            f.consumables.map((c, i) => (
              <div key={c.item + i} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1 text-[15px]">{c.item}</div>
                {editable ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setQty(i, -1)} className="flex size-9 items-center justify-center rounded-lg border-[1.5px] border-slate-300 text-slate-700" aria-label={`Less ${c.item}`}>
                      {c.qty <= 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                    </button>
                    <span className="w-7 text-center text-[16px] font-bold">{c.qty}</span>
                    <button type="button" onClick={() => setQty(i, 1)} className="flex size-9 items-center justify-center rounded-lg border-[1.5px] border-slate-300 text-slate-700" aria-label={`More ${c.item}`}>
                      <Plus size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="text-[15px] font-bold">× {c.qty}</span>
                )}
              </div>
            ))
          ) : (
            <div className="px-4 py-3.5 text-[13px] text-slate-400">None recorded · used for billing</div>
          )}
        </div>

        <div className="mt-1 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Remarks</div>
        <div className="rounded-card bg-white px-4 py-3 shadow-card">
          <textarea
            value={f.remarks}
            disabled={!editable}
            onChange={(e) => setF((o) => ({ ...o, remarks: e.target.value }))}
            onBlur={() => flush()}
            placeholder="Anything the coordinator should know (not shared with the patient)"
            className="min-h-[64px] w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-slate-400"
          />
        </div>
      </Body>
      <BottomBar>
        <button
          type="button"
          disabled={busy}
          className={bigBtn('p')}
          onClick={async () => {
            setBusy(true)
            const ok = await flush()
            if (ok) {
              router.push(`/m/visits/${id}/checklist`)
              router.refresh()
            } else setBusy(false)
          }}
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          {editable ? 'Save & back to checklist' : 'Back to checklist'}
        </button>
      </BottomBar>

      <Sheet
        open={medOpen}
        onClose={() => setMedOpen(false)}
        title="Medication given"
        sub="Drug, dose, route and time are stored on the visit record"
        footer={
          <button
            type="button"
            disabled={busy || !med.drug.trim()}
            className={bigBtn('p')}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await sendOrQueue(`/requests/${id}/medication`, { drug: med.drug.trim(), dose: med.dose || undefined, route: med.route || undefined, time: med.time || undefined }, { label: `Medication · ${med.drug}` })
                toast(r.queued ? 'Medication saved offline' : 'Medication recorded', 'ok')
                setMedOpen(false)
                router.refresh()
              } catch (e: any) {
                toast(e.message, 'err')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            Add medication
          </button>
        }
      >
        <div className="grid gap-3 pb-2">
          <label>
            <span className="hc-label text-[13px]">Drug</span>
            <input autoFocus className="hc-input hc-input-lg" value={med.drug} onChange={(e) => setMed({ ...med, drug: e.target.value })} placeholder="e.g. Mixtard 30" />
          </label>
          <div className="grid grid-cols-[1fr_96px] gap-2.5">
            <label>
              <span className="hc-label text-[13px]">Dose</span>
              <input className="hc-input hc-input-lg" value={med.dose} onChange={(e) => setMed({ ...med, dose: e.target.value })} placeholder="e.g. 18 U" />
            </label>
            <label>
              <span className="hc-label text-[13px]">Time</span>
              <input type="time" className="hc-input hc-input-lg" value={med.time} onChange={(e) => setMed({ ...med, time: e.target.value })} />
            </label>
          </div>
          <div>
            <span className="hc-label text-[13px]">Route</span>
            <div className="flex flex-wrap gap-2">
              {ROUTES.map((x) => (
                <button key={x} type="button" onClick={() => setMed({ ...med, route: x })} className={cx('h-9 rounded-full px-3.5 text-[13px] font-semibold', med.route === x ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
                  {x}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={consOpen}
        onClose={() => setConsOpen(false)}
        title="Add consumable"
        footer={
          <button
            type="button"
            disabled={!consName.trim()}
            className={bigBtn('p')}
            onClick={() => {
              setF((o) => ({ ...o, consumables: [...o.consumables, { item: consName.trim(), qty: 1 }] }))
              setConsOpen(false)
            }}
          >
            Add
          </button>
        }
      >
        <input autoFocus className="hc-input hc-input-lg" value={consName} onChange={(e) => setConsName(e.target.value)} placeholder="e.g. Alcohol swab" />
        <div className="mt-3 flex flex-wrap gap-2 pb-2">
          {['Gloves (pair)', 'Alcohol swab', 'Insulin syringe 1 mL', 'Dressing pack', 'Gauze', 'Cannula', 'IV set', 'Vacutainer'].map((x) => (
            <button key={x} type="button" onClick={() => setConsName(x)} className="h-9 rounded-full border border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700">
              {x}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

