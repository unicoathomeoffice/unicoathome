'use client'
// Public landing: a full-height hero (left on desktop, first screen on phones) and the booking form in its own
// scroll panel. Soft "neumorphic" surfaces with colourful blurred blobs; EN / বাংলা; patient + staff entry points.
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { ArrowDown, CalendarPlus, FlaskConical, Phone, PhoneCall, Stethoscope, UserRound } from 'lucide-react'
import { telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { BookingForm, type BookingDay, type BookingPrefill } from './BookingForm'
import { LangProvider, LangSwitch, useLang } from './i18n'

type Props = {
  hospital: { name: string; department: string; phone: string; address: string; hours: string }
  staff: { href: string; signedIn: boolean }
  patient: { name: string } | null
  prefill?: BookingPrefill
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

function Page({ hospital: h, staff, patient, prefill, services, zones, booking, legacySlots, bnFont }: Props) {
  const { t, lang } = useLang()
  const panel = useRef<HTMLDivElement>(null)
  // "?book=1" / "#book" (from the patient portal) → jump straight to the form
  useEffect(() => {
    if (window.location.hash === '#book' || new URLSearchParams(window.location.search).has('book')) panel.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])
  const scrollToForm = () => panel.current?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className={cx('bg-page lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]', lang === 'bn' && bnFont)} style={lang === 'bn' ? { fontFamily: 'var(--font-bn), var(--font-dm-sans), sans-serif' } : undefined}>
      {/* ------------------------------------------------------------ hero */}
      <section className="relative flex min-h-[100svh] flex-col overflow-hidden bg-navy text-white lg:h-dvh lg:min-h-0">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-32 size-[420px] rounded-full bg-primary/50 blur-3xl hc-blob" />
          <div className="absolute right-[-120px] top-1/3 size-[380px] rounded-full bg-teal/40 blur-3xl hc-blob" style={{ animationDelay: '-3s' }} />
          <div className="absolute -bottom-40 left-1/4 size-[460px] rounded-full bg-[#7C3AED]/30 blur-3xl hc-blob" style={{ animationDelay: '-6s' }} />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,.08),transparent_45%)]" />
        </div>

        <header className="relative z-10 flex items-center gap-2 px-4 pt-[max(14px,env(safe-area-inset-top))] sm:px-8">
          <Link href="/" className="rounded-xl bg-white px-2.5 py-1.5">
            <img src="/logo.svg" alt={h.name} className="h-7" />
          </Link>
          <span className="flex-1" />
          <LangSwitch />
          <a href={telUrl(h.phone)} className="flex size-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25" aria-label={`${t.call} ${h.phone}`}>
            <Phone size={17} />
          </a>
          <Link href={staff.href} className="hidden h-10 items-center rounded-full px-3 text-[13px] font-semibold text-white/75 hover:bg-white/10 hover:text-white md:flex">
            {staff.signedIn ? t.openDashboard : t.navStaff}
          </Link>
        </header>

        <div className="relative z-10 flex flex-1 flex-col justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
          <div className="text-[12px] font-bold uppercase tracking-[.14em] text-white/70">{t.heroKicker}</div>
          <h1 className="mt-3 max-w-[13ch] text-[38px] font-bold leading-[1.05] tracking-[-.02em] sm:text-[48px] xl:text-[58px]">{t.heroTitle}</h1>
          <p className="mt-4 max-w-[520px] text-[15.5px] leading-[25px] text-white/80 sm:text-[17px] sm:leading-[27px]">{t.heroSub}</p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <button type="button" onClick={scrollToForm} className="flex h-[52px] items-center gap-2 rounded-full bg-white px-6 text-[15.5px] font-bold text-navy shadow-lg shadow-black/20 transition hover:-translate-y-px">
              <CalendarPlus size={19} /> {t.ctaBook}
            </button>
            {patient ? (
              <Link href="/my" className="flex h-[52px] items-center gap-2 rounded-full bg-white/15 px-5 text-[15px] font-semibold text-white ring-1 ring-white/30 backdrop-blur hover:bg-white/25">
                <UserRound size={18} /> {t.ctaMy}
              </Link>
            ) : (
              <>
                <Link href="/my/register" className="flex h-[52px] items-center gap-2 rounded-full bg-white/15 px-5 text-[15px] font-semibold text-white ring-1 ring-white/30 backdrop-blur hover:bg-white/25">
                  <UserRound size={18} /> {t.ctaAccount}
                </Link>
                <Link href="/my/login" className="flex h-[52px] items-center rounded-full px-4 text-[15px] font-semibold text-white/85 hover:bg-white/10">
                  {t.navSignIn}
                </Link>
              </>
            )}
          </div>

          <ul className="mt-9 grid gap-2.5 sm:grid-cols-3">
            {[
              { icon: Stethoscope, title: t.feat1, sub: t.feat1s, tone: 'from-primary/60 to-primary/20' },
              { icon: FlaskConical, title: t.feat2, sub: t.feat2s, tone: 'from-teal/60 to-teal/20' },
              { icon: PhoneCall, title: t.feat3, sub: t.feat3s, tone: 'from-[#F59E0B]/60 to-[#F59E0B]/20' },
            ].map((f) => (
              <li key={f.title} className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur sm:flex-col sm:items-start">
                <span className={cx('flex size-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br text-white', f.tone)}>
                  <f.icon size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold">{f.title}</span>
                  <span className="block text-[12.5px] text-white/70">{f.sub}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-semibold text-white/70">
            <span>● {t.stat1}</span>
            <span>● {t.stat2}</span>
            <span>● {t.stat3}</span>
            <span className="hidden sm:inline">● {h.hours}</span>
          </div>
        </div>

        <button type="button" onClick={scrollToForm} className="relative z-10 mx-auto mb-[max(16px,env(safe-area-inset-bottom))] flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[13px] font-semibold text-white/80 ring-1 ring-white/20 lg:hidden">
          {t.scrollHint} <ArrowDown size={15} className="animate-bounce" />
        </button>
      </section>

      {/* ------------------------------------------------------------ booking panel (scrolls on its own on desktop) */}
      <section id="book" ref={panel} className="relative lg:h-dvh lg:overflow-y-auto hc-scroll">
        <div className="mx-auto max-w-[640px] px-4 pb-10 pt-6 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[22px] font-bold leading-tight text-navy">{t.ctaBook}</h2>
              <p className="mt-1 text-[13.5px] text-slate-500">{t.confirmByPhone}</p>
            </div>
            {!patient ? (
              <Link href="/my/login" className="hidden h-9 flex-none items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-semibold text-primary-700 shadow-card sm:flex">
                <UserRound size={15} /> {t.navSignIn}
              </Link>
            ) : (
              <Link href="/my" className="hidden h-9 flex-none items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-semibold text-primary-700 shadow-card sm:flex">
                <UserRound size={15} /> {patient.name.split(' ')[0]}
              </Link>
            )}
          </div>
          <BookingForm services={services} zones={zones} booking={booking} legacySlots={legacySlots} hotline={h.phone} hours={h.hours} prefill={prefill} signedIn={!!patient} />
          <footer className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-200 pb-24 pt-5 text-[13px] text-slate-500 sm:pb-0">
            <span className="w-full text-slate-700">
              {h.name} · {h.address}
            </span>
            <Link href="/privacy" className="hover:text-primary-700">{t.privacy}</Link>
            <Link href="/terms" className="hover:text-primary-700">{t.terms}</Link>
            <Link href={patient ? '/my' : '/my/login'} className="hover:text-primary-700">{patient ? t.navMyVisits : t.navSignIn}</Link>
            <Link href={staff.href} className="hover:text-primary-700">{staff.signedIn ? t.openDashboard : t.staffSignIn}</Link>
            <Link href="/join" className="hover:text-primary-700">{t.join}</Link>
          </footer>
        </div>
      </section>
    </div>
  )
}
