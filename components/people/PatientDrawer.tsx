'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { api, Drawer, Toggle, useToast } from '@/components/client'
import { btnClass, type BtnKind } from '@/components/ui'
import { Field, FormError, splitList, useFieldErrors } from './form'

export type PatientFormValue = {
  _id?: string
  name?: string
  phone?: string
  altPhone?: string
  email?: string
  uhid?: string
  gender?: string
  ageYears?: number
  dob?: string
  bloodGroup?: string
  address?: { area?: string; thana?: string; full?: string; landmark?: string }
  guardian?: { name?: string; relation?: string; phone?: string }
  allergies?: string[]
  conditions?: string[]
  consent?: { whatsapp?: boolean; email?: boolean }
  notes?: string
  tags?: string[]
}

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

function initial(p?: PatientFormValue) {
  return {
    name: p?.name ?? '',
    phone: p?.phone ?? '',
    altPhone: p?.altPhone ?? '',
    email: p?.email ?? '',
    uhid: p?.uhid ?? '',
    gender: p?.gender ?? '',
    ageYears: p?.ageYears != null ? String(p.ageYears) : '',
    dob: p?.dob ? String(p.dob).slice(0, 10) : '',
    bloodGroup: p?.bloodGroup ?? '',
    area: p?.address?.area ?? '',
    thana: p?.address?.thana ?? '',
    full: p?.address?.full ?? '',
    landmark: p?.address?.landmark ?? '',
    gName: p?.guardian?.name ?? '',
    gRelation: p?.guardian?.relation ?? '',
    gPhone: p?.guardian?.phone ?? '',
    allergies: (p?.allergies ?? []).join(', '),
    conditions: (p?.conditions ?? []).join(', '),
    waConsent: p?.consent?.whatsapp ?? true,
    emailConsent: p?.consent?.email ?? true,
    notes: p?.notes ?? '',
    tags: (p?.tags ?? []).join(', '),
  }
}

/** "+ New patient" (POST /patients) or "Edit" (PATCH /patients/:id) with the same drawer */
export function PatientDrawerButton({ patient, zones, kind = 'p', label, redirectOnCreate = true }: { patient?: PatientFormValue; zones: string[]; kind?: BtnKind; label?: string; redirectOnCreate?: boolean }) {
  const [open, setOpen] = useState(false)
  const editing = !!patient?._id
  return (
    <>
      <button type="button" className={btnClass(kind)} onClick={() => setOpen(true)}>
        {editing ? <Pencil size={16} /> : <Plus size={16} />}
        {label ?? (editing ? 'Edit' : 'New patient')}
      </button>
      {open && <PatientDrawer patient={patient} zones={zones} onClose={() => setOpen(false)} redirectOnCreate={redirectOnCreate} />}
    </>
  )
}

function PatientDrawer({ patient, zones, onClose, redirectOnCreate }: { patient?: PatientFormValue; zones: string[]; onClose: () => void; redirectOnCreate: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const editing = !!patient?._id
  const [v, setV] = useState(() => initial(patient))
  const [busy, setBusy] = useState(false)
  const fe = useFieldErrors()
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))
  const err = (k: string) => fe.errors[k]

  async function save() {
    fe.clear()
    setBusy(true)
    const body = {
      name: v.name.trim(),
      phone: v.phone.trim(),
      altPhone: v.altPhone.trim() || undefined,
      email: v.email.trim(),
      uhid: v.uhid.trim() || undefined,
      gender: v.gender || undefined,
      ageYears: v.ageYears ? Number(v.ageYears) : undefined,
      dob: v.dob || undefined,
      bloodGroup: v.bloodGroup || undefined,
      address: { area: v.area || undefined, thana: v.thana.trim() || undefined, full: v.full.trim(), landmark: v.landmark.trim() || undefined },
      guardian: { name: v.gName.trim() || undefined, relation: v.gRelation.trim() || undefined, phone: v.gPhone.trim() || undefined },
      allergies: splitList(v.allergies),
      conditions: splitList(v.conditions),
      consent: { whatsapp: v.waConsent, email: v.emailConsent },
      notes: v.notes.trim() || undefined,
      tags: splitList(v.tags),
    }
    try {
      if (editing) {
        await api(`/patients/${patient!._id}`, { method: 'PATCH', body })
        toast('Patient updated')
        onClose()
        router.refresh()
      } else {
        const r = await api<{ id: string }>('/patients', { body })
        toast('Patient registered')
        onClose()
        if (redirectOnCreate) router.push(`/patients/${r.id}`)
        else router.refresh()
      }
    } catch (e) {
      fe.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width={600}
      title={editing ? `Edit ${patient?.name}` : 'New patient'}
      sub={editing ? 'Changing the address keeps the old one in address history' : 'Search by phone first — the phone number is how we find patients fastest'}
      footer={
        <>
          <div className="flex-1" />
          <button className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button className={btnClass('p')} onClick={save} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {editing ? 'Save changes' : 'Register patient'}
          </button>
        </>
      }
    >
      <FormError message={fe.message} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Field label="Full name" error={err('name')} className="col-span-2">
          <input className="hc-input" value={v.name} onChange={set('name')} placeholder="Abdul Karim" autoFocus />
        </Field>
        <Field label="Phone (= WhatsApp)" error={err('phone')}>
          <input className="hc-input" value={v.phone} onChange={set('phone')} placeholder="01711-234567" inputMode="tel" />
        </Field>
        <Field label="Alt phone" error={err('altPhone')}>
          <input className="hc-input" value={v.altPhone} onChange={set('altPhone')} inputMode="tel" />
        </Field>
        <Field label="UHID / MRN" error={err('uhid')}>
          <input className="hc-input" value={v.uhid} onChange={set('uhid')} placeholder="104582" />
        </Field>
        <Field label="Email" error={err('email')}>
          <input className="hc-input" value={v.email} onChange={set('email')} type="email" />
        </Field>
        <div className="col-span-2 grid grid-cols-4 gap-3">
          <Field label="Gender" error={err('gender')}>
            <select className="hc-input" value={v.gender} onChange={set('gender')}>
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </select>
          </Field>
          <Field label="Age" error={err('ageYears')}>
            <input className="hc-input" value={v.ageYears} onChange={set('ageYears')} inputMode="numeric" />
          </Field>
          <Field label="Date of birth" error={err('dob')}>
            <input className="hc-input" type="date" value={v.dob} onChange={set('dob')} />
          </Field>
          <Field label="Blood group" error={err('bloodGroup')}>
            <select className="hc-input" value={v.bloodGroup} onChange={set('bloodGroup')}>
              <option value="">—</option>
              {BLOOD.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="col-span-2 mt-2 text-[13px] font-bold text-slate-900">Address</div>
        <Field label="Zone / area" error={err('address.area')}>
          <select className="hc-input" value={v.area} onChange={set('area')}>
            <option value="">—</option>
            {[...new Set([...zones, ...(v.area ? [v.area] : [])])].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <Field label="Thana" error={err('address.thana')}>
          <input className="hc-input" value={v.thana} onChange={set('thana')} />
        </Field>
        <Field label="Full address" error={err('address.full') ?? err('address')} className="col-span-2">
          <input className="hc-input" value={v.full} onChange={set('full')} placeholder="House 21, Road 7/A, Dhanmondi" />
        </Field>
        <Field label="Landmark" error={err('address.landmark')} className="col-span-2">
          <input className="hc-input" value={v.landmark} onChange={set('landmark')} placeholder="Opposite Dhanmondi Lake gate 3" />
        </Field>

        <div className="col-span-2 mt-2 text-[13px] font-bold text-slate-900">Guardian</div>
        <Field label="Name" error={err('guardian.name')}>
          <input className="hc-input" value={v.gName} onChange={set('gName')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Relation" error={err('guardian.relation')}>
            <input className="hc-input" value={v.gRelation} onChange={set('gRelation')} placeholder="son" />
          </Field>
          <Field label="Phone" error={err('guardian.phone')}>
            <input className="hc-input" value={v.gPhone} onChange={set('gPhone')} inputMode="tel" />
          </Field>
        </div>

        <div className="col-span-2 mt-2 text-[13px] font-bold text-slate-900">Clinical</div>
        <Field label="Allergies" hint="Comma separated" error={err('allergies')}>
          <input className="hc-input" value={v.allergies} onChange={set('allergies')} placeholder="Penicillin" />
        </Field>
        <Field label="Conditions" hint="Comma separated" error={err('conditions')}>
          <input className="hc-input" value={v.conditions} onChange={set('conditions')} placeholder="Type 2 diabetes, Hypertension" />
        </Field>
        <Field label="Notes" error={err('notes')} className="col-span-2">
          <textarea className="hc-input" rows={3} value={v.notes} onChange={set('notes')} placeholder="Family prefers afternoon slots…" />
        </Field>
        <Field label="Tags" hint="Comma separated" error={err('tags')} className="col-span-2">
          <input className="hc-input" value={v.tags} onChange={set('tags')} placeholder="VIP, Care plan" />
        </Field>

        <div className="col-span-2 mt-2 rounded-card bg-slate-50 p-4">
          <div className="text-[13px] font-bold">Consent</div>
          <div className="mb-3 text-[12px] text-slate-500">Recorded with your name and the time</div>
          <div className="flex items-center justify-between py-1.5 text-sm">
            <span>WhatsApp messages</span>
            <Toggle on={v.waConsent} onChange={(x) => setV((s) => ({ ...s, waConsent: x }))} label="WhatsApp consent" />
          </div>
          <div className="flex items-center justify-between py-1.5 text-sm">
            <span>Email messages</span>
            <Toggle on={v.emailConsent} onChange={(x) => setV((s) => ({ ...s, emailConsent: x }))} label="Email consent" />
          </div>
        </div>
      </div>
    </Drawer>
  )
}
