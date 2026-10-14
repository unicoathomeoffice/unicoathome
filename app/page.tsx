import type { Metadata } from 'next'
import { Noto_Sans_Bengali } from 'next/font/google'
import { getUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { availability } from '@/lib/booking'
import { ServiceType, Zone } from '@/lib/models'
import { PublicHome } from '@/components/public/PublicHome'

// Bangla glyphs for the public page's বাংলা mode only (the staff app stays English)
const bn = Noto_Sans_Bengali({ subsets: ['bengali'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-bn' })

export const metadata: Metadata = {
  title: 'Book a home care visit',
  description: 'Doctors, nurses, physiotherapy and lab tests at home in Dhaka — Unico Hospitals Family Medicine.',
}

/** Public home page: anyone can request a home-care visit (no sign-in). Slots are live from Settings → Online booking. */
export default async function Home() {
  await db()
  const [user, s, services, zones] = await Promise.all([
    getUser().catch(() => null),
    getSettings(),
    ServiceType.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('code name category').lean<any[]>(),
    Zone.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>(),
  ])
  const g = s.general
  const days = s.booking.enabled ? await availability(s.booking) : []
  const b = s.booking.enabled ? s.booking : null

  return (
    <PublicHome
      hospital={{ name: g.hospitalName, department: g.department, phone: g.hospitalPhone, address: g.address, hours: b ? `${b.from}–${b.to}` : `${g.workingHours?.from ?? '09:00'}–${g.workingHours?.to ?? '17:00'}` }}
      staff={{ href: user ? (user.platformAccess.includes('web') && user.client === 'web' ? '/dashboard' : '/m') : '/login', signedIn: !!user }}
      services={services.map((t) => ({ code: t.code, name: t.name, category: t.category ?? '' }))}
      zones={zones.map((z) => z.name)}
      booking={{ enabled: !!b, days }}
      legacySlots={g.slots}
      bnFont={bn.variable}
    />
  )
}
