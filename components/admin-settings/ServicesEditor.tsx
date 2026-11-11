'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ChevronRight, Copy, Loader2, Plus, Save, X, Lock } from 'lucide-react'
import { api, ChipPicker, Toggle, useToast } from '@/components/client'
import { btnClass, Tag } from '@/components/ui'
import { Field, FormError, Tick, useFieldErrors } from '@/components/people/form'
import { ROLES, ROLE_LABEL, SKILLS, VITALS } from '@/lib/constants'
import { cx, taka } from '@/lib/format'
import { ItemPicture } from './EquipmentEditor'

export type ServiceDoc = {
  _id: string
  code: string
  name: string
  category?: string
  requiredSkills?: string[]
  defaultDurationMin?: number
  fee?: number
  requiresPrescription?: boolean
  checklist?: { key: string; label: string; mandatory?: boolean; sortOrder?: number }[]
  /** after return to the hospital (lab handover…); the page fills the defaults when never saved */
  afterChecklist?: { key: string; label: string; mandatory?: boolean; sortOrder?: number; withNote?: boolean; notePrompt?: string }[]
  /** afterChecklist above is the built-in default (the admin never saved one) */
  afterIsDefault?: boolean
  /** the bag: catalog items with recommended / must-take / usual use */
  kit?: { itemId: string; recommendedQty?: number; minQty?: number; usualUse?: number }[]
  vitalsRequired?: string[]
  staffMix?: { role: string; count: number }[]
  isActive?: boolean
  sortOrder?: number
  inUse?: number
}

type Item = { uid: number; key?: string; label: string; mandatory: boolean; withNote?: boolean; notePrompt?: string }
type KitRow = { uid: number; itemId: string; recommendedQty: number; minQty: number; usualUse: number | '' }
export type CatalogItem = { _id: string; name: string; type: 'EQUIPMENT' | 'CONSUMABLE'; unit: string; imageId?: string | null; isActive: boolean }
type Form = {
  id?: string
  code: string
  name: string
  category: string
  duration: string
  fee: string
  skills: string[]
  vitals: string[]
  mix: { role: string; count: string }[]
  items: Item[]
  /** after return to the hospital */
  after: Item[]
  afterDefault: boolean
  kit: KitRow[]
  isActive: boolean
  requiresPrescription: boolean
}

const CATEGORIES = ['Doctor', 'Nursing', 'Lab', 'Physio', 'Diagnostics', 'Other']
const MIX_ROLES = ROLES.filter((r) => ['DOCTOR', 'NURSE', 'ALLIED', 'DRIVER'].includes(r))
let uidSeq = 1

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'item'

function toForm(s?: ServiceDoc): Form {
  return {
    id: s?._id,
    code: s?.code ?? '',
    name: s?.name ?? '',
    category: s?.category ?? 'Nursing',
    duration: String(s?.defaultDurationMin ?? 45),
    fee: String(s?.fee ?? 0),
    skills: s?.requiredSkills ?? [],
    vitals: s?.vitalsRequired ?? [],
    mix: (s?.staffMix ?? [{ role: 'NURSE', count: 1 }]).map((m) => ({ role: m.role, count: String(m.count) })),
    items: [...(s?.checklist ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((c) => ({ uid: uidSeq++, key: c.key, label: c.label, mandatory: c.mandatory !== false })),
    after: [...(s?.afterChecklist ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((c) => ({ uid: uidSeq++, key: c.key, label: c.label, mandatory: c.mandatory !== false, withNote: !!c.withNote, notePrompt: c.notePrompt ?? '' })),
    afterDefault: !!s?.afterIsDefault,
    kit: (s?.kit ?? []).map((k) => ({ uid: uidSeq++, itemId: String(k.itemId), recommendedQty: k.recommendedQty ?? 1, minQty: k.minQty ?? 0, usualUse: k.usualUse ?? '' })),
    isActive: s?.isActive !== false,
    requiresPrescription: s?.requiresPrescription === true,
  }
}

/** W11 / A3: service list on the left, full editor on the right (SUPER_ADMIN edits; others view). */
export function ServicesEditor({ services, canEdit, catalog = [] }: { services: ServiceDoc[]; canEdit: boolean; catalog?: CatalogItem[] }) {
  const router = useRouter()
  const toast = useToast()
  const fe = useFieldErrors()
  const [selected, setSelected] = useState<string | 'new'>(services[0]?._id ?? 'new')
  const [f, setF] = useState<Form>(() => toForm(services[0]))
  const [base, setBase] = useState(() => JSON.stringify(toForm(services[0])))
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const strip = (x: Form) => ({ ...x, items: x.items.map(({ uid, ...r }) => r), after: x.after.map(({ uid, ...r }) => r), kit: x.kit.map(({ uid, ...r }) => r) })
  const dirty = useMemo(() => JSON.stringify(strip(f)) !== JSON.stringify(strip(JSON.parse(base))), [f, base])
  const current = services.find((s) => s._id === selected)

  function load(form: Form, id: string | 'new') {
    fe.clear()
    setSelected(id)
    setF(form)
    setBase(JSON.stringify(form))
  }
  function pick(id: string | 'new', form: Form) {
    if (dirty && canEdit && !window.confirm('Discard unsaved changes?')) return
    load(form, id)
  }
  const upd = (patch: Partial<Form>) => setF((s) => ({ ...s, ...patch }))
  const setItem = (uid: number, patch: Partial<Item>) => upd({ items: f.items.map((i) => (i.uid === uid ? { ...i, ...patch } : i)) })
  function moveItem(i: number, d: -1 | 1) {
    const j = i + d
    if (j < 0 || j >= f.items.length) return
    const next = [...f.items]
    ;[next[i], next[j]] = [next[j], next[i]]
    upd({ items: next })
  }
  const setAfter = (uid: number, patch: Partial<Item>) => upd({ after: f.after.map((i) => (i.uid === uid ? { ...i, ...patch } : i)), afterDefault: false })
  function moveAfter(i: number, d: -1 | 1) {
    const j = i + d
    if (j < 0 || j >= f.after.length) return
    const next = [...f.after]
    ;[next[i], next[j]] = [next[j], next[i]]
    upd({ after: next, afterDefault: false })
  }
  /** unique keys (kept when an item already had one), in display order */
  function keyed(list: Item[]) {
    const seen = new Set<string>()
    return list
      .filter((i) => i.label.trim())
      .map((i, k) => {
        let key = i.key || slug(i.label)
        let n = 2
        while (seen.has(key)) key = `${slug(i.label)}_${n++}`
        seen.add(key)
        return { key, label: i.label.trim(), mandatory: i.mandatory, sortOrder: k, withNote: !!i.withNote, notePrompt: i.withNote ? i.notePrompt?.trim() || undefined : undefined }
      })
  }

  async function save() {
    fe.clear()
    const items = f.items.filter((i) => i.label.trim())
    const seen = new Set<string>()
    const checklist = items.map((i, k) => {
      let key = i.key || slug(i.label)
      let n = 2
      while (seen.has(key)) key = `${slug(i.label)}_${n++}`
      seen.add(key)
      return { key, label: i.label.trim(), mandatory: i.mandatory, sortOrder: k }
    })
    const body = {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      category: f.category,
      defaultDurationMin: Number(f.duration),
      fee: Number(f.fee || 0),
      requiredSkills: f.skills,
      vitalsRequired: f.vitals,
      staffMix: f.mix.filter((m) => m.role).map((m) => ({ role: m.role, count: Number(m.count || 1) })),
      checklist,
      afterChecklist: keyed(f.after),
      kit: f.kit.map((k) => ({ itemId: k.itemId, recommendedQty: k.recommendedQty, minQty: Math.min(k.minQty, k.recommendedQty), usualUse: k.usualUse === '' ? undefined : Number(k.usualUse) })),
      isActive: f.isActive,
      requiresPrescription: f.requiresPrescription,
      ...(f.id ? {} : { sortOrder: services.length }),
    }
    setBusy(true)
    try {
      if (f.id) {
        await api(`/master/service-types/${f.id}`, { method: 'PATCH', body })
        toast('Service saved')
        const saved = { ...f, code: body.code, items: checklist.map((c) => ({ uid: uidSeq++, key: c.key, label: c.label, mandatory: c.mandatory })), after: body.afterChecklist.map((c) => ({ uid: uidSeq++, key: c.key, label: c.label, mandatory: c.mandatory, withNote: c.withNote, notePrompt: c.notePrompt ?? '' })), afterDefault: false }
        load(saved, f.id)
      } else {
        const r = await api<{ id: string }>('/master/service-types', { body })
        toast('Service created')
        const saved = { ...f, id: r.id, code: body.code, items: checklist.map((c) => ({ uid: uidSeq++, key: c.key, label: c.label, mandatory: c.mandatory })), after: body.afterChecklist.map((c) => ({ uid: uidSeq++, key: c.key, label: c.label, mandatory: c.mandatory, withNote: c.withNote, notePrompt: c.notePrompt ?? '' })), afterDefault: false }
        load(saved, r.id)
      }
      router.refresh()
    } catch (e) {
      fe.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  const list = services.filter((s) => !q || `${s.name} ${s.code}`.toLowerCase().includes(q.toLowerCase()))
  const mandatoryCount = f.items.filter((i) => i.mandatory).length

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* list */}
      <div className="rounded-card bg-white p-4 shadow-card lg:sticky lg:top-0">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1 pl-1 text-[15px] font-bold">Service types · {services.length}</div>
          {canEdit && (
            <button type="button" className={btnClass('p', 'sm')} onClick={() => pick('new', toForm())}>
              <Plus size={15} /> Add
            </button>
          )}
        </div>
        {services.length > 8 && <input className="hc-input mb-2 h-9" placeholder="Filter services" value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="flex max-h-[calc(100dvh-240px)] flex-col gap-1 overflow-y-auto">
          {selected === 'new' && (
            <div className="flex items-center gap-2 rounded-[10px] bg-primary-50 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-primary-700">{f.name || 'New service'}</div>
                <div className="text-[12px] text-slate-500">not saved yet</div>
              </div>
              <Tag tone="blue">NEW</Tag>
            </div>
          )}
          {list.map((s) => (
            <button key={s._id} type="button" onClick={() => pick(s._id, toForm(s))} className={cx('flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-left', selected === s._id ? 'bg-primary-50' : 'hover:bg-slate-50')}>
              <div className="min-w-0 flex-1">
                <div className={cx('truncate text-[14px] font-semibold', s.isActive === false && 'text-slate-400')}>{s.name}</div>
                <div className="text-[12px] text-slate-500">
                  {s.defaultDurationMin ?? 45} min · {taka(s.fee ?? 0)} · {(s.checklist ?? []).length} items
                </div>
              </div>
              {s.isActive === false && <Tag>Off</Tag>}
              <ChevronRight size={16} className="text-slate-400" />
            </button>
          ))}
          {services.length === 0 && selected !== 'new' && <div className="px-2 py-8 text-center text-[13px] text-slate-400">No service types yet</div>}
        </div>
      </div>

      {/* editor */}
      <div className="rounded-card bg-white p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[19px] font-bold">{f.name || (f.id ? current?.name : 'New service')}</div>
            <div className="text-[13px] text-slate-500">
              {f.code ? `Code ${f.code}` : 'Code not set'} · {f.category || 'no category'} · {f.isActive ? 'active' : 'inactive'}
              {current?.inUse ? ` · used by ${current.inUse} request${current.inUse === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          {canEdit ? (
            <>
              {f.id && (
                <button type="button" className={btnClass('o')} onClick={() => pick('new', { ...f, id: undefined, code: `${f.code}_COPY`.slice(0, 40), name: `${f.name} (copy)`, items: f.items.map((i) => ({ ...i, uid: uidSeq++ })) })}>
                  <Copy size={16} /> Duplicate
                </button>
              )}
              <button type="button" className={btnClass('p')} onClick={save} disabled={busy || (!dirty && !!f.id)}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {f.id ? 'Save changes' : 'Create service'}
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-600">
              <Lock size={13} /> View only · super admin edits
            </span>
          )}
        </div>
        <FormError message={fe.message} />

        <fieldset disabled={!canEdit} className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Service name" error={fe.errors.name} className="sm:col-span-2">
              <input className="hc-input" value={f.name} onChange={(e) => upd({ name: e.target.value })} placeholder="ECG at home" />
            </Field>
            <Field label="Code" error={fe.errors.code} hint={f.id ? undefined : 'CAPITALS, digits and _'}>
              <input className="hc-input font-mono text-[13px] uppercase" value={f.code} onChange={(e) => upd({ code: e.target.value.toUpperCase().replace(/\s+/g, '_') })} placeholder="ECG_HOME" />
            </Field>
            <Field label="Category" error={fe.errors.category}>
              <select className="hc-input" value={f.category} onChange={(e) => upd({ category: e.target.value })}>
                {[...new Set([...CATEGORIES, ...(f.category ? [f.category] : [])])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Default duration (min)" error={fe.errors.defaultDurationMin}>
              <input className="hc-input" inputMode="numeric" value={f.duration} onChange={(e) => upd({ duration: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="Fee (৳)" error={fe.errors.fee}>
              <input className="hc-input" inputMode="numeric" value={f.fee} onChange={(e) => upd({ fee: e.target.value.replace(/[^\d.]/g, '') })} />
            </Field>
            <div className="sm:col-span-2">
              <span className="hc-label">Active</span>
              <div className="flex h-10 items-center gap-3 text-[13px] text-slate-500">
                <Toggle on={f.isActive} onChange={(isActive) => upd({ isActive })} disabled={!canEdit} label="Service active" />
                {f.isActive ? 'Shown in request forms' : 'Hidden from new requests'}
              </div>
            </div>
            <div className="sm:col-span-2">
              <span className="hc-label">Prescription required (online booking)</span>
              <div className="flex h-10 items-center gap-3 text-[13px] text-slate-500">
                <Toggle on={f.requiresPrescription} onChange={(requiresPrescription) => upd({ requiresPrescription })} disabled={!canEdit} label="Prescription required" />
                {f.requiresPrescription ? 'Patients must upload a prescription photo/PDF to book this online' : 'No upload needed to book this online'}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <span className="hc-label">Required skills</span>
              <ChipPicker options={[...new Set([...SKILLS, ...f.skills])]} value={f.skills} onChange={(skills) => upd({ skills })} />
            </div>
            <div>
              <span className="hc-label">Vitals required</span>
              <ChipPicker options={VITALS.map((v) => ({ value: v.key, label: v.label }))} value={f.vitals} onChange={(vitals) => upd({ vitals })} />
            </div>
          </div>

          <div className="mt-4">
            <span className="hc-label">Staff mix</span>
            <div className="flex flex-wrap items-center gap-2">
              {f.mix.map((m, i) => (
                <div key={i} className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white pl-1">
                  <input className="h-9 w-10 rounded bg-transparent text-center text-sm font-semibold outline-none" inputMode="numeric" value={m.count} aria-label="Count" onChange={(e) => upd({ mix: f.mix.map((x, j) => (j === i ? { ...x, count: e.target.value.replace(/\D/g, '') } : x)) })} />
                  <span className="text-slate-400">×</span>
                  <select className="h-9 bg-transparent pr-1 text-sm outline-none" value={m.role} aria-label="Role" onChange={(e) => upd({ mix: f.mix.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })}>
                    {MIX_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  {canEdit && (
                    <button type="button" className="flex size-8 items-center justify-center text-slate-400 hover:text-[#B91C1C]" onClick={() => upd({ mix: f.mix.filter((_, j) => j !== i) })} aria-label="Remove">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button type="button" className={btnClass('ghost', 'sm')} onClick={() => upd({ mix: [...f.mix, { role: 'NURSE', count: '1' }] })}>
                  <Plus size={14} /> Add role
                </button>
              )}
              {f.mix.length === 0 && <span className="text-[13px] text-slate-400">Any available staff</span>}
            </div>
            {fe.errors.staffMix && <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{fe.errors.staffMix}</span>}
          </div>

          <div className="mb-2 mt-6 flex items-baseline gap-3">
            <div className="flex-1 text-[15px] font-bold">
              Checklist template · {f.items.length} item{f.items.length === 1 ? '' : 's'}
            </div>
            <div className="text-[12px] text-slate-500">{mandatoryCount} mandatory · mandatory items block check-out</div>
          </div>
          <div className="overflow-hidden rounded-card border border-slate-200">
            <div className="grid h-10 items-center border-b border-slate-200 bg-slate-50 px-3 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500" style={{ gridTemplateColumns: '28px minmax(0,1fr) 96px 40px' }}>
              <span />
              <span>Item</span>
              <span>Mandatory</span>
              <span />
            </div>
            {f.items.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-slate-400">No checklist items — staff can still add ad-hoc items during the visit.</div>}
            {f.items.map((it, i) => (
              <div key={it.uid} className="grid min-h-12 items-center border-t border-slate-100 px-3 first:border-t-0" style={{ gridTemplateColumns: '28px minmax(0,1fr) 96px 40px' }}>
                <span className="flex flex-col items-center">
                  <button type="button" disabled={i === 0} onClick={() => moveItem(i, -1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" disabled={i === f.items.length - 1} onClick={() => moveItem(i, 1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label="Move down">
                    <ArrowDown size={13} />
                  </button>
                </span>
                <span className="min-w-0 pr-3">
                  <input className="h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-slate-200 focus:border-primary focus:bg-white disabled:hover:border-transparent" value={it.label} placeholder="Checklist item" onChange={(e) => setItem(it.uid, { label: e.target.value })} />
                  <span className="block truncate px-2 font-mono text-[10.5px] text-slate-400">{it.key || slug(it.label)}</span>
                </span>
                <span className="flex items-center gap-2 text-[12px] text-slate-500">
                  <Tick on={it.mandatory} onChange={(m) => canEdit && setItem(it.uid, { mandatory: m })} label="Mandatory" />
                  {it.mandatory ? 'yes' : 'no'}
                </span>
                <span>
                  {canEdit && (
                    <button type="button" onClick={() => upd({ items: f.items.filter((x) => x.uid !== it.uid) })} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:text-[#B91C1C]" aria-label="Remove item">
                      <X size={14} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {fe.errors.checklist && <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{fe.errors.checklist}</span>}
          {canEdit && (
            <button type="button" className="mt-2 inline-flex h-9 items-center gap-1.5 px-1 text-sm font-semibold text-primary-700" onClick={() => upd({ items: [...f.items, { uid: uidSeq++, label: '', mandatory: true }] })}>
              <Plus size={15} /> Add checklist item
            </button>
          )}
          {f.id && current?.inUse ? <p className="mt-3 text-[12px] text-slate-500">Changes apply to new requests. Visits already created keep the checklist they were created with.</p> : null}

          <div className="mb-2 mt-7 flex flex-wrap items-baseline gap-3">
            <div className="flex-1 text-[15px] font-bold">
              After return to hospital · {f.after.length} item{f.after.length === 1 ? '' : 's'}
              {f.afterDefault && <span className="ml-2 rounded-full bg-[#FEF3C7] px-2 py-0.5 align-middle text-[11px] font-bold text-[#B45309]">DEFAULTS — save to keep or change</span>}
            </div>
            <div className="text-[12px] text-slate-500">{f.after.filter((i) => i.mandatory).length} required · required items must be ticked before the visit is closed</div>
          </div>
          <div className="overflow-hidden rounded-card border border-slate-200">
            <div className="grid h-10 items-center border-b border-slate-200 bg-slate-50 px-3 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500" style={{ gridTemplateColumns: '28px minmax(0,1fr) 96px 150px 40px' }}>
              <span />
              <span>Item (e.g. Samples handed over to lab)</span>
              <span>Required</span>
              <span>Asks for a note</span>
              <span />
            </div>
            {f.after.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-slate-400">Nothing to do after returning for this service.</div>}
            {f.after.map((it, i) => (
              <div key={it.uid} className="grid min-h-12 items-center border-t border-slate-100 px-3 first:border-t-0" style={{ gridTemplateColumns: '28px minmax(0,1fr) 96px 150px 40px' }}>
                <span className="flex flex-col items-center">
                  <button type="button" disabled={i === 0} onClick={() => moveAfter(i, -1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" disabled={i === f.after.length - 1} onClick={() => moveAfter(i, 1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label="Move down">
                    <ArrowDown size={13} />
                  </button>
                </span>
                <span className="min-w-0 pr-3">
                  <input className="h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-slate-200 focus:border-primary focus:bg-white disabled:hover:border-transparent" value={it.label} placeholder="After-return item" onChange={(e) => setAfter(it.uid, { label: e.target.value })} />
                  <span className="block truncate px-2 font-mono text-[10.5px] text-slate-400">{it.key || slug(it.label)}</span>
                </span>
                <span className="flex items-center gap-2 text-[12px] text-slate-500">
                  <Tick on={it.mandatory} onChange={(m) => canEdit && setAfter(it.uid, { mandatory: m })} label="Required" />
                  {it.mandatory ? 'yes' : 'no'}
                </span>
                <span className="flex items-center gap-2 pr-2 text-[12px] text-slate-500">
                  <Tick on={!!it.withNote} onChange={(m) => canEdit && setAfter(it.uid, { withNote: m })} label="Asks for a note" />
                  {it.withNote ? <input className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-[12px]" placeholder="e.g. Receipt no." value={it.notePrompt ?? ''} onChange={(e) => setAfter(it.uid, { notePrompt: e.target.value })} /> : 'no'}
                </span>
                <span>
                  {canEdit && (
                    <button type="button" onClick={() => upd({ after: f.after.filter((x) => x.uid !== it.uid), afterDefault: false })} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:text-[#B91C1C]" aria-label="Remove item">
                      <X size={14} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {canEdit && (
            <button type="button" className="mt-2 inline-flex h-9 items-center gap-1.5 px-1 text-sm font-semibold text-primary-700" onClick={() => upd({ after: [...f.after, { uid: uidSeq++, label: '', mandatory: true, withNote: false, notePrompt: '' }], afterDefault: false })}>
              <Plus size={15} /> Add after-return item
            </button>
          )}

          <KitSection kit={f.kit} setKit={(kit) => upd({ kit })} catalog={catalog} canEdit={canEdit} />
        </fieldset>
      </div>
    </div>
  )
}

/** "Bag & consumables": catalog items this service takes — recommended, the minimum that must be packed before the
 *  journey (0 = optional), and the usual use per visit (pre-fills "Consumables used" on the app). */
function KitSection({ kit, setKit, catalog, canEdit }: { kit: KitRow[]; setKit: (k: KitRow[]) => void; catalog: CatalogItem[]; canEdit: boolean }) {
  const [q, setQ] = useState('')
  const byId = (id: string) => catalog.find((c) => c._id === id)
  const hits = q.trim() ? catalog.filter((c) => c.isActive && !kit.some((k) => k.itemId === c._id) && c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []
  const set = (uid: number, patch: Partial<KitRow>) => setKit(kit.map((k) => (k.uid === uid ? { ...k, ...patch } : k)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= kit.length) return
    const next = [...kit]
    ;[next[i], next[j]] = [next[j], next[i]]
    setKit(next)
  }
  const num = (v: string, max = 99) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)))
  const COLS = '28px 44px minmax(0,1fr) 92px 92px 92px 40px'
  return (
    <>
      <div className="mb-2 mt-7 flex flex-wrap items-baseline gap-3">
        <div className="flex-1 text-[15px] font-bold">
          Bag &amp; consumables · {kit.length} item{kit.length === 1 ? '' : 's'}
        </div>
        <div className="text-[12px] text-slate-500">
          Staff pack these before the journey · <b>Must take</b> blocks Start journey until packed ·{' '}
          <a href="/store" className="font-semibold text-primary-700 hover:underline">
            Manage items
          </a>
        </div>
      </div>
      <div className="overflow-hidden rounded-card border border-slate-200">
        <div className="grid h-10 items-center border-b border-slate-200 bg-slate-50 px-3 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500" style={{ gridTemplateColumns: COLS }}>
          <span />
          <span />
          <span>Item</span>
          <span>Recommend</span>
          <span>Must take</span>
          <span>Usual use</span>
          <span />
        </div>
        {kit.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-slate-400">Nothing to pack for this service yet.</div>}
        {kit.map((k, i) => {
          const c = byId(k.itemId)
          const equip = c?.type === 'EQUIPMENT'
          return (
            <div key={k.uid} className="grid min-h-14 items-center gap-1 border-t border-slate-100 px-3 first:border-t-0" style={{ gridTemplateColumns: COLS }}>
              <span className="flex flex-col items-center">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label="Move up">
                  <ArrowUp size={13} />
                </button>
                <button type="button" disabled={i === kit.length - 1} onClick={() => move(i, 1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label="Move down">
                  <ArrowDown size={13} />
                </button>
              </span>
              <ItemPicture item={{ _id: k.itemId, imageId: c?.imageId, name: c?.name ?? '' }} size={38} />
              <span className="min-w-0 pl-1">
                <span className="block truncate text-[13.5px] font-semibold">{c?.name ?? 'Removed item'}</span>
                <span className="text-[11.5px] text-slate-500">
                  {c ? `${equip ? 'Equipment' : 'Consumable'} · per ${c.unit}` : ''}
                  {c && !c.isActive ? ' · hidden' : ''}
                </span>
              </span>
              <input type="number" min={0} max={99} className="hc-input h-9 w-[80px]" value={k.recommendedQty} onChange={(e) => set(k.uid, { recommendedQty: num(e.target.value) })} aria-label="Recommended" />
              <input type="number" min={0} max={99} className={cx('hc-input h-9 w-[80px]', k.minQty > k.recommendedQty && 'border-[#DC2626]')} value={k.minQty} onChange={(e) => set(k.uid, { minQty: num(e.target.value) })} aria-label="Must take" title="0 = optional" />
              <input type="number" min={0} max={999} disabled={equip} className="hc-input h-9 w-[80px] disabled:opacity-40" value={equip ? '' : k.usualUse} placeholder={equip ? '—' : '0'} onChange={(e) => set(k.uid, { usualUse: e.target.value === '' ? '' : num(e.target.value, 999) })} aria-label="Usual use per visit" />
              <span>
                {canEdit && (
                  <button type="button" onClick={() => setKit(kit.filter((x) => x.uid !== k.uid))} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:text-[#B91C1C]" aria-label="Remove item">
                    <X size={14} />
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
      {canEdit && (
        <div className="relative mt-2 max-w-md">
          <input className="hc-input" placeholder={catalog.length ? '+ Add an item — type to search the catalog' : 'No items yet — add them in Equipment & consumables'} value={q} onChange={(e) => setQ(e.target.value)} disabled={!catalog.length} />
          {!!hits.length && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {hits.map((c) => (
                <li key={c._id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] hover:bg-slate-50"
                    onClick={() => {
                      setKit([...kit, { uid: uidSeq++, itemId: c._id, recommendedQty: 1, minQty: c.type === 'EQUIPMENT' ? 1 : 0, usualUse: c.type === 'EQUIPMENT' ? '' : 1 }])
                      setQ('')
                    }}
                  >
                    <ItemPicture item={c} size={32} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                    <span className="text-[11.5px] text-slate-500">{c.type === 'EQUIPMENT' ? 'Equipment' : 'Consumable'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
