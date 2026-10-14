'use client'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Loader2, MapPin, Save } from 'lucide-react'
import { api } from '@/components/client/api'
import { AddressSearchInput, PinPicker } from '@/components/client/maps'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { useLang } from '@/components/public/i18n'

const input = 'hc-input hc-input-lg !text-[16px]'
type Errors = Record<string, string>
export type ProfileData = { name: string; phone: string; whatsapp: string; email: string; ageYears: string; gender: '' | 'M' | 'F' | 'O'; road: string; house: string; flat: string; area: string; landmark: string; lat: number | null; lng: number | null }

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className={cx(error && '[&_.hc-input]:border-[#DC2626]')}>
      <span className="hc-label !text-[13.5px]">{label}</span>
      {children}
      {error ? <div className="mt-1 text-[13px] font-medium text-[#B91C1C]">{error}</div> : hint && <div className="mt-1 text-[12.5px] text-slate-500">{hint}</div>}
    </div>
  )
}
const Msg = ({ ok, children }: { ok?: boolean; children: ReactNode }) => (
  <div role="alert" className={cx('flex items-start gap-2 rounded-lg px-3.5 py-3 text-[14px]', ok ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEE2E2] text-[#B91C1C]')}>
    {ok ? <Check size={18} className="mt-px flex-none" /> : <AlertTriangle size={18} className="mt-px flex-none" />} {children}
  </div>
)

export function ProfileForm({ initial, zones }: { initial: ProfileData; zones: string[] }) {
  const { t } = useLang()
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ProfileData>(k: K, val: ProfileData[K]) => {
    setV((x) => ({ ...x, [k]: val }))
    setErrors(({ [k]: _, ...r }) => r)
  }
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      await api('/patient/me', {
        method: 'PATCH',
        body: {
          name: v.name,
          phone: v.phone,
          whatsapp: v.whatsapp,
          email: v.email,
          ageYears: v.ageYears === '' ? undefined : Number(v.ageYears),
          gender: v.gender || undefined,
          address: { road: v.road, house: v.house, flat: v.flat, area: v.area, landmark: v.landmark, lat: v.lat, lng: v.lng },
        },
      })
      setMsg({ ok: true, text: t.saved })
      router.refresh()
    } catch (e: any) {
      if (e.fields) setErrors(Object.fromEntries(Object.entries(e.fields as Errors).map(([k, val]) => [k.split('.').pop()!, val])))
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <section className="rounded-2xl p-4 hc-soft sm:p-5">
        <h2 className="mb-3 text-[16px] font-bold">{t.contact}</h2>
        <div className="flex flex-col gap-3.5">
          <Field label={t.name} error={errors.name}>
            <input className={input} value={v.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t.phone} error={errors.phone}>
              <input className={input} value={v.phone} onChange={(e) => set('phone', e.target.value)} type="tel" inputMode="tel" required />
            </Field>
            <Field label={t.whatsapp} hint={t.whatsappHint} error={errors.whatsapp}>
              <input className={input} value={v.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} type="tel" inputMode="tel" required />
            </Field>
          </div>
          <Field label={t.email} error={errors.email}>
            <input className={input} value={v.email} onChange={(e) => set('email', e.target.value)} type="email" inputMode="email" />
          </Field>
          <div className="grid grid-cols-[104px_1fr] gap-3.5">
            <Field label={t.age} error={errors.ageYears}>
              <input className={input} value={v.ageYears} onChange={(e) => set('ageYears', e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" />
            </Field>
            <Field label={t.gender}>
              <div className="grid h-12 grid-cols-3 gap-1 rounded-lg bg-slate-200 p-1">
                {(
                  [
                    ['M', t.male],
                    ['F', t.female],
                    ['O', t.other],
                  ] as const
                ).map(([g, l]) => (
                  <button key={g} type="button" onClick={() => set('gender', g)} className={cx('rounded-md text-[14px] font-semibold', v.gender === g ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}>
                    {l}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <p className="text-[12.5px] text-slate-500">{t.mandatoryNote}</p>
        </div>
      </section>

      <section className="rounded-2xl p-4 hc-soft sm:p-5">
        <h2 className="mb-3 text-[16px] font-bold">{t.addressSection}</h2>
        <div className="flex flex-col gap-3.5">
          <Field label={t.road} hint={t.roadHint} error={errors.road}>
            <AddressSearchInput className={input} value={v.road} onChange={(road) => set('road', road)} onPlace={(p) => setV((x) => ({ ...x, road: p.full, lat: p.lat, lng: p.lng }))} placeholder={t.roadPh} />
          </Field>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label={t.house} error={errors.house}>
              <input className={input} value={v.house} onChange={(e) => set('house', e.target.value)} placeholder={t.housePh} />
            </Field>
            <Field label={t.flat} error={errors.flat}>
              <input className={input} value={v.flat} onChange={(e) => set('flat', e.target.value)} placeholder={t.flatPh} />
            </Field>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t.area}>
              <input className={input} value={v.area} onChange={(e) => set('area', e.target.value)} list="hc-zones-p" placeholder={t.areaPh} autoComplete="off" />
              <datalist id="hc-zones-p">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
            <Field label={t.landmark}>
              <input className={input} value={v.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder={t.landmarkPh} />
            </Field>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-700">
              <MapPin size={15} /> {t.onMap}
            </div>
            <PinPicker height={240} lat={v.lat} lng={v.lng} onChange={(p) => setV((x) => ({ ...x, lat: p?.lat ?? null, lng: p?.lng ?? null }))} labels={{ tap: t.pinTap, none: t.pinNone, set: t.pinSet, myLocation: t.myLocation, clear: t.clearPin }} />
          </div>
        </div>
      </section>

      {msg && <Msg ok={msg.ok}>{msg.text}</Msg>}
      <button type="submit" disabled={busy || !dirty} className={btnClass('p', 'xl', 'w-full')}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} {t.saveChanges}
      </button>
    </form>
  )
}

export function PasswordForm() {
  const { t } = useLang()
  const [v, setV] = useState({ currentPassword: '', newPassword: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      await api('/patient/me', { method: 'PATCH', body: v })
      setV({ currentPassword: '', newPassword: '' })
      setMsg({ ok: true, text: t.passwordChanged })
    } catch (e: any) {
      if (e.fields) setErrors(e.fields)
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="rounded-2xl p-4 hc-soft sm:p-5">
      <h2 className="mb-3 text-[16px] font-bold">{t.changePassword}</h2>
      <div className="flex flex-col gap-3.5">
        <Field label={t.currentPassword} error={errors.currentPassword}>
          <input className={input} type="password" value={v.currentPassword} onChange={(e) => (setV({ ...v, currentPassword: e.target.value }), setErrors({}))} autoComplete="current-password" required />
        </Field>
        <Field label={t.newPassword} error={errors.newPassword}>
          <input className={input} type="password" value={v.newPassword} onChange={(e) => (setV({ ...v, newPassword: e.target.value }), setErrors({}))} autoComplete="new-password" minLength={6} required />
        </Field>
        {msg && <Msg ok={msg.ok}>{msg.text}</Msg>}
        <button type="submit" disabled={busy || !v.currentPassword || v.newPassword.length < 6} className={btnClass('o', 'xl', 'w-full')}>
          {busy && <Loader2 size={18} className="animate-spin" />} {t.changePassword}
        </button>
      </div>
    </form>
  )
}
