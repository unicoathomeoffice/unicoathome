import type { Metadata } from 'next'
import { Noto_Sans_Bengali } from 'next/font/google'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { availability } from '@/lib/booking'
import { activeServices, activeZones } from '@/lib/cached'
import { PublicHome } from '@/components/public/PublicHome'

// Bangla glyphs for the public page's বাংলা mode only (the staff app stays English)
const bn = Noto_Sans_Bengali({ subsets: ['bengali'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-bn' })

export const metadata: Metadata = {
  title: 'Book a home care visit',
  description: 'Doctors, nurses, physiotherapy and lab tests at home in Dhaka — Unico Hospitals Family Medicine.',
}

// The landing page is the same for everyone, so it is served from the CDN and rebuilt at most every 30 s.
// Who is signed in (staff link, patient name, form prefill) is fetched by the browser after first paint
// (/api/v1/public/session); the booking grid is refreshed client-side and re-checked on submit (SLOT_TAKEN).
export const revalidate = 30

export default async function Home() {
  await db()
  const [s, services, zones] = await Promise.all([getSettings(), activeServices(), activeZones()])
  const g = s.general
  const days = s.booking.enabled ? await availability(s.booking) : []
  const b = s.booking.enabled ? s.booking : null

  return (
    <PublicHome
      hospital={{ name: g.hospitalName, department: g.department, phone: g.hospitalPhone, address: g.address, hours: b ? `${b.from}–${b.to}` : `${g.workingHours?.from ?? '09:00'}–${g.workingHours?.to ?? '17:00'}` }}
      services={services.map((t) => ({ code: t.code, name: t.name, category: t.category ?? '', requiresPrescription: !!t.requiresPrescription }))}
      zones={zones}
      booking={{ enabled: !!b, days }}
      legacySlots={g.slots}
      bnFont={bn.variable}
    />
  )
}
