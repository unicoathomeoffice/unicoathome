'use client'
// Public landing, ported from the "Home care at your door" mockups (desktop + mobile): light page with soft blue
// blobs, a top nav, hero copy + photo on the left and the booking card (gradient header) in its own scroll panel
// on the right. On phones: feature list card over the photo, "Your Health · Our Priority" badge, the booking card
// as a sheet with a grabber, and a bottom tab bar. EN / বাংলা; every link / button goes to a real page or section.
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, ChevronDown, Clock3, FlaskConical, HeartPulse, House, LayoutGrid, Menu, Mouse, Phone, ShieldCheck, Smile, Stethoscope, Truck, UserRound, Users, X } from 'lucide-react'
import { telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { BookingForm, type BookingDay, type BookingPrefill } from './BookingForm'
import { LangProvider, LangSwitch, useLang } from './i18n'
import styles from './PublicHome.module.css'

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

const pill = 'flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 text-[14px] font-semibold text-navy shadow-card ring-1 ring-slate-200 transition hover:bg-slate-50'
const roundBtn = 'flex size-11 flex-none items-center justify-center rounded-full transition'

function Page({ hospital: h, staff, patient, prefill, services, zones, booking, legacySlots, bnFont }: Props) {
  const { t, lang } = useLang()
  const panel = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  // "?book=1" / "#book" (from the patient portal) → jump straight to the form
  useEffect(() => {
    if (window.location.hash === '#book' || new URLSearchParams(window.location.search).has('book')) panel.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])
  const scrollToForm = () => {
    setMenu(false)
    panel.current?.scrollIntoView({ behavior: 'smooth' })
    document.getElementById('f-name')?.focus({ preventScroll: true })
  }
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const features = [
    { icon: Stethoscope, title: t.feat1, sub: t.feat1s },
    { icon: FlaskConical, title: t.feat2, sub: t.feat2s },
    { icon: Clock3, title: t.feat3, sub: t.feat3s },
    { icon: House, title: t.feat4, sub: t.feat4s },
  ]
  const stats = [
    { icon: Users, n: t.statVisitsN, l: t.statVisits },
    { icon: Smile, n: t.statFamiliesN, l: t.statFamilies },
    { icon: UserRound, n: t.statStaffN, l: t.statStaff },
    { icon: ShieldCheck, n: t.statSafe, l: t.statSafeS },
  ]
  const nav = [
    { href: '#top', label: t.navHome, active: true },
    { href: '#services', label: t.navServices },
    { href: '#why', label: t.navWhy },
    { href: '#book', label: t.navHow },
    { href: '#contact', label: t.navContact },
  ]
  const accountHref = patient ? '/my' : '/my/login'

  return (
    <div id="top" className={cx('relative min-h-dvh overflow-x-hidden bg-[#F2F8FD] text-slate-900 lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:overflow-hidden', lang === 'bn' && bnFont)} style={lang === 'bn' ? { fontFamily: 'var(--font-bn), var(--font-dm-sans), sans-serif' } : undefined}>
      {/* ------------------------------------------------------------ background: soft blobs + the blue wave behind the card */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 top-10 size-[520px] rounded-full bg-primary/15 blur-3xl hc-blob" />
        <div className="absolute bottom-[-220px] left-1/3 size-[520px] rounded-full bg-teal/15 blur-3xl hc-blob" style={{ animationDelay: '-4s' }} />
        <div className="absolute -right-[260px] -top-[10%] hidden h-[120%] w-[760px] rotate-[12deg] rounded-[46%] bg-gradient-to-b from-primary via-[#22B8E6] to-[#9BE1FB] opacity-90 lg:block" />
        <div className="absolute -right-[120px] top-[55%] hidden h-[70%] w-[520px] -rotate-[18deg] rounded-[48%] bg-white/35 lg:block" />
      </div>

      {/* ------------------------------------------------------------ hero */}
      <section className={cx(styles.hero, 'relative flex flex-col overflow-hidden lg:h-dvh lg:min-h-0')}>
        {/* AVIF first (≈35% smaller), WebP for browsers without it; portrait photo on phones */}
        <picture className={styles.backdrop} aria-hidden="true">
          <source media="(max-width: 639px)" type="image/avif" srcSet="/home-care-mobile.avif" />
          <source media="(max-width: 639px)" type="image/webp" srcSet="/home-care-mobile.webp" />
          <source type="image/avif" srcSet="/home-care-desktop.avif" />
          <img src="/home-care-desktop.webp" alt="" fetchPriority="high" decoding="async" />
        </picture>
        <div className={styles.scrim} aria-hidden="true" />
        <div className={styles.wave} aria-hidden="true" />
        <header className="relative z-20 flex items-center gap-2 px-4 pt-[max(14px,env(safe-area-inset-top))] sm:px-8 lg:px-12">
          <Link href="/" className="flex-none">
            <img src="/logo.svg" alt={h.name} className="h-9 sm:h-10" />
          </Link>
          <nav className="ml-8 hidden items-center gap-6 whitespace-nowrap text-[14.5px] font-semibold text-slate-600 xl:flex 2xl:ml-10 2xl:gap-7">
            {nav.map((n) => (
              <a key={n.href} href={n.href} onClick={n.href === '#book' ? (e) => (e.preventDefault(), scrollToForm()) : undefined} className={cx('relative whitespace-nowrap transition hover:text-navy', n.active &&'text-navy after:absolute after:-bottom-2.5 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary')}>
                {n.label}
              </a>
            ))}
          </nav>
          <span className="flex-1" />
          <LangSwitch className="bg-white shadow-card ring-1 ring-slate-200" />
          <a href={telUrl(h.phone)} className={cx(roundBtn, 'size-10 bg-primary text-white shadow-[0_6px_16px_rgba(0,144,202,.35)] hover:bg-primary-700 sm:size-10')} aria-label={`${t.call} ${h.phone}`}>
            <Phone size={17} />
          </a>
          <Link href={staff.href} className="hidden h-10 items-center whitespace-nowrap text-[14px] font-semibold text-slate-700 hover:text-navy md:flex">
            {staff.signedIn ? t.openDashboard : t.navStaff}
          </Link>
          <Link href={accountHref} className={cx(pill, 'hidden sm:flex')}>
            <UserRound size={16} /> {patient ? patient.name.split(' ')[0] : t.navSignIn}
          </Link>
          <button type="button" onClick={() => setMenu(true)} className={cx(roundBtn, 'size-10 bg-white text-navy shadow-card ring-1 ring-slate-200 lg:hidden')} aria-label={t.menu}>
            <Menu size={20} />
          </button>
        </header>

        <div className={cx(styles.content, 'relative z-10 flex flex-1 flex-col justify-center px-5 pb-6 pt-6 sm:px-8 sm:pt-8 lg:px-12 xl:px-16')}>
          <div className={styles.copy}>
            <div className="text-[11.5px] font-bold uppercase tracking-[.18em] text-primary sm:text-[12.5px]">{t.heroKicker}</div>
            <h1 className="mt-2.5 text-[44px] font-extrabold leading-[1.0] tracking-[-.03em] text-navy sm:mt-3 sm:text-[62px] xl:text-[80px]">
              {t.heroTitle1}
              <br />
              <span className="bg-gradient-to-r from-[#0085ff] to-[#00a7a8] bg-clip-text text-transparent">{t.heroTitle2}</span>
            </h1>
            <p className="mt-4 max-w-[64%] text-[15px] leading-[24px] text-slate-700 sm:mt-5 sm:max-w-[500px] sm:text-[17px] sm:leading-[28px] sm:text-slate-600">{t.heroSub}</p>

            <div className="mt-7 hidden flex-wrap gap-3 sm:flex">
              <button type="button" onClick={scrollToForm} className="flex h-[56px] items-center gap-2.5 rounded-full bg-primary px-7 text-[16px] font-bold text-white shadow-[0_10px_24px_rgba(0,144,202,.35)] transition hover:-translate-y-px hover:bg-primary-700">
                <CalendarDays size={19} /> {t.ctaBook} <ArrowRight size={18} />
              </button>
              {patient ? (
                <Link href="/my" className={cx(pill, 'h-[56px] px-6 text-[16px]')}>
                  <UserRound size={18} /> {t.ctaMy}
                </Link>
              ) : (
                <Link href="/my/register" className={cx(pill, 'h-[56px] px-6 text-[16px]')}>
                  <UserRound size={18} /> {t.ctaAccount}
                </Link>
              )}
            </div>
          </div>

          {/* features: a translucent list card on phones, four columns from sm up */}
          <ul id="services" className="mt-6 grid max-w-[238px] scroll-mt-6 gap-1.5 rounded-3xl bg-white/75 p-2.5 shadow-[0_10px_30px_rgba(31,56,100,.10)] ring-1 ring-white/80 backdrop-blur sm:mt-9 sm:max-w-none sm:grid-cols-4 sm:gap-x-4 sm:gap-y-5 sm:rounded-none sm:bg-transparent sm:p-0 sm:shadow-none sm:ring-0 sm:backdrop-blur-none lg:max-w-[620px]">
            {features.map((f) => (
              <li key={f.title} className="flex min-w-0 items-center gap-2.5 sm:block">
                <span className="flex size-9 flex-none items-center justify-center rounded-full bg-primary-50 text-primary sm:size-14 sm:bg-white sm:shadow-[0_6px_18px_rgba(0,144,202,.18)] sm:ring-1 sm:ring-primary/10">
                  <f.icon size={19} className="sm:hidden" />
                  <f.icon size={24} className="hidden sm:block" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-tight text-navy sm:mt-2.5 sm:text-[14.5px] sm:font-bold">{f.title}</span>
                  <span className="mt-1 hidden text-[12.5px] leading-[18px] text-slate-500 sm:block">{f.sub}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* phones: badge + scroll hint */}
          <div className="mt-5 flex items-end gap-5 sm:hidden">
            <span className="flex items-center gap-3 rounded-full bg-white py-3 pl-4 pr-6 shadow-[0_10px_30px_rgba(31,56,100,.14)]">
              <HeartPulse size={34} className="text-primary" strokeWidth={2.2} />
              <span className="text-[17px] font-extrabold leading-[1.1] text-navy">
                {t.badge1}
                <br />
                {t.badge2}
              </span>
            </span>
            <button type="button" onClick={scrollToForm} className="flex flex-col items-center gap-1 pb-1 text-[13.5px] font-medium text-navy">
              <Mouse size={22} className="text-primary" />
              {t.scrollHintM}
            </button>
          </div>

          <div id="why" className="mt-8 hidden scroll-mt-6 grid-cols-2 gap-4 rounded-3xl bg-white/90 p-4 shadow-[0_12px_40px_rgba(31,56,100,.10)] ring-1 ring-white backdrop-blur sm:grid sm:grid-cols-4 sm:p-5 lg:max-w-[860px]">
            {stats.map((s) => (
              <div key={s.l} className="flex items-center gap-3 sm:border-l sm:border-slate-200 sm:pl-4 sm:first:border-0 sm:first:pl-0">
                <span className="flex size-12 flex-none items-center justify-center rounded-full bg-primary-50 text-primary">
                  <s.icon size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[19px] font-extrabold leading-tight text-navy">{s.n}</span>
                  <span className="block text-[12.5px] leading-[17px] text-slate-500">{s.l}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <button type="button" onClick={scrollToForm} className="relative z-10 mx-auto mb-[max(14px,env(safe-area-inset-bottom))] hidden flex-col items-center gap-0.5 text-[13px] font-semibold text-slate-500 hover:text-navy sm:flex">
          <Mouse size={18} />
          {t.scrollHint}
          <ChevronDown size={16} className="animate-bounce" />
        </button>

      </section>

      {/* ------------------------------------------------------------ booking card (a sheet on phones; scrolls on its own on desktop) */}
      <section id="book" ref={panel} className="relative z-10 -mt-6 lg:mt-0 lg:h-dvh lg:overflow-y-auto hc-scroll lg:py-4 lg:pr-4">
        <div className="mx-auto max-w-[640px] pb-10 sm:px-4 lg:px-0 lg:pb-4">
          <div className="overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(31,56,100,.14)] ring-1 ring-white/70 sm:rounded-[28px] sm:shadow-[0_24px_60px_rgba(31,56,100,.18)]">
            <div className="mx-auto mt-3 h-1.5 w-20 rounded-full bg-slate-300 lg:hidden" />
            <div className="flex items-center gap-3.5 px-5 py-5 sm:px-6 lg:flex-row-reverse lg:items-start lg:justify-between lg:bg-gradient-to-r lg:from-primary lg:to-[#1FB6E8] lg:text-white">
              <span className="flex size-14 flex-none items-center justify-center rounded-2xl bg-primary-50 text-primary lg:size-11 lg:rounded-xl lg:bg-white/20 lg:text-white lg:ring-1 lg:ring-white/40">
                <CalendarDays size={30} className="lg:hidden" />
                <CalendarDays size={22} className="hidden lg:block" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[26px] font-extrabold leading-tight text-navy lg:text-white">{t.ctaBook}</h2>
                <p className="mt-0.5 text-[14px] text-slate-500 lg:mt-1 lg:text-[13.5px] lg:text-white/85">{t.bookSub}</p>
              </div>
            </div>
            <div className="bg-[#EEF5FA] p-3 sm:p-4">
              <BookingForm services={services} zones={zones} booking={booking} legacySlots={legacySlots} hotline={h.phone} hours={h.hours} prefill={prefill} signedIn={!!patient} />
            </div>
          </div>

          <footer id="contact" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 px-5 pb-28 text-[13px] text-slate-500 sm:px-2 lg:pb-0">
            <span className="w-full text-slate-700">
              {h.name} · {h.address} ·{' '}
              <a href={telUrl(h.phone)} className="font-semibold text-primary-700">
                {h.phone}
              </a>
            </span>
            <Link href="/privacy" className="hover:text-primary-700">
              {t.privacy}
            </Link>
            <Link href="/terms" className="hover:text-primary-700">
              {t.terms}
            </Link>
            <Link href={accountHref} className="hover:text-primary-700">
              {patient ? t.navMyVisits : t.navSignIn}
            </Link>
            <Link href={staff.href} className="hover:text-primary-700">
              {staff.signedIn ? t.openDashboard : t.staffSignIn}
            </Link>
            <Link href="/join" className="hover:text-primary-700">
              {t.join}
            </Link>
          </footer>
        </div>
      </section>

      {/* ------------------------------------------------------------ phones: bottom tab bar + "More" menu */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] text-[12px] font-medium text-slate-600 shadow-[0_-6px_24px_rgba(31,56,100,.08)] backdrop-blur lg:hidden" aria-label={t.menu}>
        <TabButton icon={House} label={t.navHome} active onClick={scrollTop} />
        <TabButton icon={CalendarDays} label={t.navBook} onClick={scrollToForm} />
        <TabLink icon={Truck} label={t.navTrack} href={accountHref} />
        <TabLink icon={UserRound} label={t.navAccount} href={accountHref} />
        <TabButton icon={LayoutGrid} label={t.navMore} onClick={() => setMenu(true)} />
      </nav>

      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label={t.menu}>
          <button type="button" className="absolute inset-0 bg-navy/40 backdrop-blur-[2px]" onClick={() => setMenu(false)} aria-label="Close" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-sheet">
            <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-slate-300" />
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[17px] font-bold text-navy">{t.menu}</span>
              <button type="button" onClick={() => setMenu(false)} className={cx(roundBtn, 'size-9 bg-slate-100 text-slate-600')} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-2 text-[15px] font-semibold text-slate-800">
              <button type="button" onClick={scrollToForm} className="flex h-12 items-center gap-3 rounded-xl bg-primary px-4 text-white">
                <CalendarDays size={18} /> {t.ctaBook}
              </button>
              <Link href={accountHref} className="flex h-12 items-center gap-3 rounded-xl bg-slate-50 px-4" onClick={() => setMenu(false)}>
                <UserRound size={18} /> {patient ? t.navMyVisits : t.navSignIn}
              </Link>
              {!patient && (
                <Link href="/my/register" className="flex h-12 items-center gap-3 rounded-xl bg-slate-50 px-4" onClick={() => setMenu(false)}>
                  <UserRound size={18} /> {t.ctaAccount}
                </Link>
              )}
              <a href={telUrl(h.phone)} className="flex h-12 items-center gap-3 rounded-xl bg-slate-50 px-4">
                <Phone size={18} /> {t.call} {h.phone}
              </a>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 px-1 text-[13px] font-medium text-slate-500">
                <Link href={staff.href} onClick={() => setMenu(false)}>
                  {staff.signedIn ? t.openDashboard : t.staffSignIn}
                </Link>
                <Link href="/join" onClick={() => setMenu(false)}>
                  {t.join}
                </Link>
                <Link href="/privacy" onClick={() => setMenu(false)}>
                  {t.privacy}
                </Link>
                <Link href="/terms" onClick={() => setMenu(false)}>
                  {t.terms}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type Icon = typeof House
const tab = 'flex h-16 flex-col items-center justify-center gap-1 transition'
function TabButton({ icon: I, label, active, onClick }: { icon: Icon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx(tab, active ? 'relative font-semibold text-primary after:absolute after:bottom-0 after:h-[3px] after:w-12 after:rounded-full after:bg-primary' : 'hover:text-navy')}>
      <I size={23} /> {label}
    </button>
  )
}
function TabLink({ icon: I, label, href }: { icon: Icon; label: string; href: string }) {
  return (
    <Link href={href} className={cx(tab, 'hover:text-navy')}>
      <I size={23} /> {label}
    </Link>
  )
}
