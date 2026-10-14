'use client'
import Link from 'next/link'
import { Phone } from 'lucide-react'
import { telUrl } from '@/components/ui'
import { BookingForm, type BookingDay } from './BookingForm'
import { LangProvider, LangSwitch, useLang } from './i18n'

type Props = {
  hospital: { name: string; department: string; phone: string; address: string; hours: string }
  staff: { href: string; signedIn: boolean }
  services: { code: string; name: string; category: string }[]
  zones: string[]
  booking: { enabled: boolean; days: BookingDay[] }
  legacySlots: string[]
  bnFont: string
}

export function PublicHome(p: Props) {
  return (
    <LangProvider>
      <Page {...p} />
    </LangProvider>
  )
}

function Page({ hospital: h, staff, services, zones, booking, legacySlots, bnFont }: Props) {
  const { t, lang } = useLang()
  return (
    <div className={`min-h-dvh bg-page ${lang === 'bn' ? bnFont : ''}`} style={lang === 'bn' ? { fontFamily: 'var(--font-bn), var(--font-dm-sans), sans-serif' } : undefined}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[720px] items-center gap-2 px-4">
          <img src="/logo.svg" alt={h.name} className="h-8" />
          <span className="flex-1" />
          <LangSwitch />
          <a href={telUrl(h.phone)} className="flex size-10 items-center justify-center rounded-full bg-primary-50 text-primary-700 sm:w-auto sm:gap-1.5 sm:px-3.5 sm:text-[13.5px] sm:font-semibold" aria-label={`${t.call} ${h.phone}`}>
            <Phone size={17} /> <span className="hidden sm:inline">{h.phone}</span>
          </a>
          <Link href={staff.href} className="hidden h-10 items-center px-2 text-[13.5px] font-semibold text-slate-600 hover:text-primary-700 md:flex">
            {staff.signedIn ? t.openDashboard : t.staffSignIn}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 pb-8 pt-6">
        <h1 className="text-[26px] font-bold leading-[34px] tracking-[-.01em] text-navy sm:text-[30px] sm:leading-[38px]">{t.heroTitle}</h1>
        <p className="mt-2 text-[15px] leading-[24px] text-slate-600">{t.heroText(`${h.name} · ${h.department}`)}</p>
        <BookingForm services={services} zones={zones} booking={booking} legacySlots={legacySlots} hotline={h.phone} hours={h.hours} />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[720px] flex-wrap gap-x-5 gap-y-2 px-4 pb-28 pt-5 text-[13px] text-slate-500 sm:pb-5">
          <span className="w-full text-slate-700">
            {h.name} · {h.address}
          </span>
          <Link href="/privacy" className="hover:text-primary-700">{t.privacy}</Link>
          <Link href="/terms" className="hover:text-primary-700">{t.terms}</Link>
          <Link href={staff.href} className="hover:text-primary-700">{staff.signedIn ? t.openDashboard : t.staffSignIn}</Link>
          <Link href="/join" className="hover:text-primary-700">{t.join}</Link>
        </div>
      </footer>
    </div>
  )
}
