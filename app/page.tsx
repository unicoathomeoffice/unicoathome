import type { Metadata } from 'next'
import { Noto_Sans_Bengali } from 'next/font/google'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { availability } from '@/lib/booking'
import { activeServices, activeZones } from '@/lib/cached'
import { PublicHome } from '@/components/public/PublicHome'

// Bangla glyphs for the public page's বাংলা mode only (the staff app stays English)
const bn = Noto_Sans_Bengali({ subsets: ['bengali'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-bn' })

const DESCRIPTION =
  'Book a doctor, nurse, physiotherapist or lab sample collection at home in Dhaka. Unico Hospitals Family Medicine home care — injections, wound dressing, catheter care, ECG and more.'

export const metadata: Metadata = {
  title: { absolute: 'Unico HomeCare — Doctor, nurse & lab tests at home in Dhaka' },
  description: DESCRIPTION,
  keywords: ['home care Dhaka', 'doctor at home', 'nurse at home', 'home sample collection', 'physiotherapy at home', 'injection at home', 'wound dressing', 'ECG at home', 'Unico Hospitals', 'হোম কেয়ার', 'বাসায় ডাক্তার', 'বাসায় নার্স'],
  alternates: { canonical: '/' },
  openGraph: { title: 'Unico HomeCare — care at home by Unico Hospitals', description: DESCRIPTION, url: '/' },
  twitter: { card: 'summary_large_image', title: 'Unico HomeCare — care at home by Unico Hospitals', description: DESCRIPTION },
  robots: { index: true, follow: true },
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

  // structured data for search engines (Google business / medical result)
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    name: 'Unico HomeCare — Unico Hospitals Family Medicine',
    description: DESCRIPTION,
    url: process.env.APP_BASE_URL || undefined,
    telephone: g.hospitalPhone,
    address: { '@type': 'PostalAddress', streetAddress: g.address, addressLocality: 'Dhaka', addressCountry: 'BD' },
    areaServed: { '@type': 'City', name: 'Dhaka' },
    medicalSpecialty: 'PrimaryCare',
    openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: g.workingHours?.from ?? '08:00', closes: g.workingHours?.to ?? '20:00' },
    availableService: services.map((t) => ({ '@type': 'MedicalProcedure', name: t.name })),
    ...(g.hospitalLocation?.lat != null && g.hospitalLocation?.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: g.hospitalLocation.lat, longitude: g.hospitalLocation.lng } } : {}),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <PublicHome
        hospital={{ name: g.hospitalName, department: g.department, phone: g.hospitalPhone, address: g.address, hours: b ? `${b.from}–${b.to}` : `${g.workingHours?.from ?? '09:00'}–${g.workingHours?.to ?? '17:00'}` }}
        services={services.map((t) => ({ code: t.code, name: t.name, category: t.category ?? '', requiresPrescription: !!t.requiresPrescription }))}
        zones={zones}
        booking={{ enabled: !!b, days }}
        legacySlots={g.slots}
        bnFont={bn.variable}
      />
    </>
  )
}
