import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { Zone } from '@/lib/models'
import { PortalShell } from '@/components/patient/PortalShell'
import { SectionTitle } from '@/components/patient/RequestCards'
import { PasswordForm, ProfileForm, type ProfileData } from '@/components/patient/ProfileForm'

export const metadata: Metadata = { title: 'My profile' }

/** Patient profile: contact numbers (required), email, age/gender, home address with map pin, password. */
export default async function MyProfile() {
  const p = await requirePatient('/my/profile')
  const [s, zones] = await Promise.all([getSettings(), Zone.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>()])
  const a = p.address ?? {}
  // the stored "full" address is "House X, Flat Y, road…" — show just the road part when the parts are known
  const road = a.house || a.flat ? (a.full ?? '').replace(/^House [^,]*, Flat [^,]*, /, '') : (a.full ?? '')
  const initial: ProfileData = {
    name: p.name,
    phone: p.phone,
    whatsapp: p.whatsapp,
    email: p.email ?? '',
    ageYears: p.ageYears != null ? String(p.ageYears) : '',
    gender: (p.gender as any) ?? '',
    road,
    house: a.house ?? '',
    flat: a.flat ?? '',
    area: a.area ?? '',
    landmark: a.landmark ?? '',
    lat: a.lat ?? null,
    lng: a.lng ?? null,
  }
  return (
    <PortalShell patient={{ name: p.name, initials: p.initials }} hotline={s.general.hospitalPhone}>
      <SectionTitle k="myProfile" />
      <div className="grid gap-4 md:grid-cols-[1fr_340px] md:items-start">
        <ProfileForm initial={initial} zones={zones.map((z) => z.name)} />
        <PasswordForm hasPassword={p.hasPassword} />
      </div>
    </PortalShell>
  )
}
