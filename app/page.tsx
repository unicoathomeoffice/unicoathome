import type { Metadata } from 'next'
import { Noto_Sans_Bengali } from 'next/font/google'
import { getUser } from '@/lib/auth'
import { getPatient } from '@/lib/patient-auth'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { availability } from '@/lib/booking'
import { memo } from '@/lib/memo'
import { ServiceType, Zone } from '@/lib/models'
import { PublicHome } from '@/components/public/PublicHome'
import type { BookingPrefill } from '@/components/public/BookingForm'

// Bangla glyphs for the public page's বাংলা mode only (the staff app stays English)
const bn = Noto_Sans_Bengali({ subsets: ['bengali'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-bn' })

export const metadata: Metadata = {
  title: 'Book a home care visit',
  description: 'Doctors, nurses, physiotherapy and lab tests at home in Dhaka — Unico Hospitals Family Medicine.',
}

/** Public home page: anyone can request a home-care visit (no sign-in). Signed-in patients get the form pre-filled. */
export default async function Home() {
  await db()
  // Public, slow-changing data is memoised for 30 s per server instance so the landing page answers in one
  // round trip instead of four; the booking grid is re-checked by the browser every 2 min and the server still
  // rejects a slot that was taken meanwhile (SLOT_TAKEN).
  const [user, patient, s, services, zones] = await Promise.all([
    getUser().catch(() => null),
    getPatient().catch(() => null),
    memo('home:settings', 30_000, () => getSettings()),
    memo('home:services', 30_000, () => ServiceType.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('code name category requiresPrescription').lean<any[]>()),
    memo('home:zones', 30_000, () => Zone.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>()),
  ])
  const g = s.general
  const days = s.booking.enabled ? await memo('home:availability', 30_000, () => availability(s.booking)) : []
  const b = s.booking.enabled ? s.booking : null
  const a = patient?.address
  const prefill: BookingPrefill | undefined = patient
    ? {
        name: patient.name,
        phone: patient.phone,
        email: patient.email ?? '',
        ageYears: patient.ageYears != null ? String(patient.ageYears) : '',
        gender: (patient.gender as any) ?? '',
        house: a?.house ?? '',
        flat: a?.flat ?? '',
        road: a?.house || a?.flat ? (a?.full ?? '').replace(/^House [^,]*, Flat [^,]*, /, '') : (a?.full ?? ''),
        area: a?.area ?? '',
        landmark: a?.landmark ?? '',
        lat: a?.lat ?? null,
        lng: a?.lng ?? null,
      }
    : undefined

  return (
    <PublicHome
      hospital={{ name: g.hospitalName, department: g.department, phone: g.hospitalPhone, address: g.address, hours: b ? `${b.from}–${b.to}` : `${g.workingHours?.from ?? '09:00'}–${g.workingHours?.to ?? '17:00'}` }}
      staff={{ href: user ? (user.platformAccess.includes('web') && user.client === 'web' ? '/dashboard' : '/m') : '/login', signedIn: !!user }}
      patient={patient ? { name: patient.name } : null}
      prefill={prefill}
      services={services.map((t) => ({ code: t.code, name: t.name, category: t.category ?? '', requiresPrescription: !!t.requiresPrescription }))}
      zones={zones.map((z) => z.name)}
      booking={{ enabled: !!b, days }}
      legacySlots={g.slots}
      bnFont={bn.variable}
    />
  )
}
