'use client'
// Public landing. EN / বাংলা; every link / button goes to a real page or section.
//  · Desktop (lg+): split screen — hero copy + photo on the left, the booking card in its own scroll panel on the right.
//  · Phones / tablets: a scrolling landing page (MobileLanding) with a bottom tab bar; "Book a visit" opens the same
//    booking form as a full-screen, step-by-step flow (the #book section becomes a fixed dialog).
//  · Two ways in, always in sight: Patient login and Staff login (header pills on desktop, the Login sheet on phones).
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/components/client/api'
import { ArrowRight, CalendarDays, ChevronDown, Clock3, FlaskConical, House, LayoutGrid, Mouse, Phone, PhoneCall, ShieldCheck, Smile, Stethoscope, Truck, UserRound, Users, X } from 'lucide-react'
import { telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { BookingForm, type BookingDay, type BookingPrefill } from './BookingForm'
import { LangProvider, LangSwitch, useLang } from './i18n'
import { LoginCards, LoginSheet, staffLoginHref, type PublicSession } from './LoginSheet'
import { MobileLanding, SiteFooter, type Hospital } from './MobileLanding'
import styles from './PublicHome.module.css'

type Props = {
  hospital: Hospital
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

const pill = 'flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition'
const pillWhite = cx(pill, 'bg-white text-navy shadow-card ring-1 ring-slate-200 hover:bg-slate-50')
const roundBtn = 'flex size-11 flex-none items-center justify-center rounded-full transition'
const PHONE = '(max-width: 1023px)' // below lg: the landing page + full-screen booking

type Session = PublicSession & { prefill: BookingPrefill | null }

function Page({ hospital: h, services, zones, booking, legacySlots, bnFont }: Props) {
  // The page is cached for everyone; who is signed in arrives right after first paint.
  const [session, setSession] = useState<Session>({ staff: { href: '/login', signedIn: false }, patient: null, prefill: null })
  useEffect(() => {
    api<Session>('/public/session').then(setSession).catch(() => {})
  }, [])
  const { staff, patient } = session
  const prefill = session.prefill ?? undefined
  const { t, lang } = useLang()
  const panel = useRef<HTMLElement>(null)
  const [menu, setMenu] = useState(false)
  const [login, setLogin] = useState(false)
  // ---- phones: the booking form is a full-screen flow; its progress strip and Back / Next bar are drawn into these
  const [phone, setPhone] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [progressHost, setProgressHost] = useState<HTMLElement | null>(null)
  const [barHost, setBarHost] = useState<HTMLElement | null>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [preselect, setPreselect] = useState<{ code: string; n: number } | null>(null)
  useEffect(() => {
    const mq = window.matchMedia(PHONE)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  /** Any "Book a visit": the full-screen flow on phones, the right-hand card on desktop. A service code ticks it. */
  const openBooking = useCallback((serviceCode?: string) => {
    setMenu(false)
    setLogin(false)
    if (serviceCode) setPreselect({ code: serviceCode, n: Date.now() })
    if (window.matchMedia(PHONE).matches) {
      if (!window.history.state?.hcBook) window.history.pushState({ ...window.history.state, hcBook: 1 }, '')
      setBookOpen(true)
    } else {
      panel.current?.scrollTo({ top: 0, behavior: 'smooth' })
      document.getElementById('f-name')?.focus({ preventScroll: true })
    }
  }, [])
  /** Close the flow; the phone's Back button does the same (the answers stay in the form). */
  const closeBooking = useCallback(() => {
    if (window.history.state?.hcBook) window.history.back()
    else setBookOpen(false)
  }, [])
  useEffect(() => {
    // a reload while the flow was open leaves its history marker behind: drop it, or Close would leave the page
    if (window.history.state?.hcBook) {
      const { hcBook: _, ...rest } = window.history.state
      window.history.replaceState(rest, '')
    }
    const onPop = () => setBookOpen(false)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // "?book=1" / "#book" (from the patient portal) → straight to the form
  useEffect(() => {
    if (window.location.hash === '#book' || new URLSearchParams(window.location.search).has('book')) openBooking()
  }, [openBooking])
  // while the flow is open on a phone the page behind does not scroll; Esc closes it
  const flow = phone && bookOpen
  useEffect(() => {
    if (!flow) return
    const root = document.documentElement
    const was = root.style.overflow
    root.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeBooking()
    window.addEventListener('keydown', onKey)
    window.dispatchEvent(new Event('resize')) // the map was measured while hidden
    return () => {
      root.style.overflow = was
      window.removeEventListener('keydown', onKey)
    }
  }, [flow, closeBooking])

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
  const firstName = patient?.name.split(' ')[0]

  return (
    <div id="top" className={cx('relative min-h-dvh bg-[#F2F8FD] text-slate-900 max-lg:overflow-x-clip lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]', lang === 'bn' && bnFont)} style={lang === 'bn' ? { fontFamily: 'var(--font-bn), var(--font-dm-sans), sans-serif' } : undefined}>
      {/* ------------------------------------------------------------ desktop background: soft blobs + the blue wave behind the card */}
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
        <div className="absolute -left-40 top-10 size-[520px] rounded-full bg-primary/15 blur-3xl hc-blob" />
        <div className="absolute bottom-[-220px] left-1/3 size-[520px] rounded-full bg-teal/15 blur-3xl hc-blob" style={{ animationDelay: '-4s' }} />
        <div className="absolute -right-[260px] -top-[10%] h-[120%] w-[760px] rotate-[12deg] rounded-[46%] bg-gradient-to-b from-primary via-[#22B8E6] to-[#9BE1FB] opacity-90" />
        <div className="absolute -right-[120px] top-[55%] h-[70%] w-[520px] -rotate-[18deg] rounded-[48%] bg-white/35" />
      </div>

      {/* ------------------------------------------------------------ phones / tablets: glass top bar + landing page */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-white/60 bg-white/80 px-4 pb-2.5 pt-[max(10px,env(safe-area-inset-top))] shadow-[0_6px_20px_rgba(31,56,100,.06)] backdrop-blur-xl sm:px-8 lg:hidden">
        <button type="button" onClick={scrollTop} className="flex-none" aria-label={t.navHome}>
          <img src="/logo.svg" alt={h.name} className="h-9" />
        </button>
        <span className="flex-1" />
        <LangSwitch className="!h-9 bg-slate-100 [&>button]:!h-7 [&>button]:!px-2.5" />
        {patient ? (
          <Link href="/my" className={cx(pill, 'h-9 max-w-[124px] bg-primary px-3.5 text-white shadow-[0_6px_16px_rgba(0,144,202,.32)]')}>
            <UserRound size={16} className="flex-none" /> <span className="truncate">{firstName}</span>
          </Link>
        ) : (
          <button type="button" onClick={() => setLogin(true)} className={cx(pill, 'h-9 bg-primary px-3.5 text-white shadow-[0_6px_16px_rgba(0,144,202,.32)] active:bg-primary-700')}>
            <UserRound size={16} /> {t.login}
          </button>
        )}
      </header>
      <MobileLanding hospital={h} services={services} session={session} onBook={openBooking} onLogin={() => setLogin(true)} />

      {/* ------------------------------------------------------------ desktop: hero */}
      <section className={cx(styles.hero, 'relative hidden flex-col overflow-hidden lg:flex lg:h-dvh lg:min-h-0')}>
        {/* AVIF first (≈35% smaller), WebP for browsers without it; below lg this hero is hidden, so they get a 1px GIF */}
        <picture className={styles.backdrop} aria-hidden="true">
          <source media="(max-width: 1023px)" srcSet="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
          <source type="image/avif" srcSet="/home-care-desktop.avif" />
          <img src="/home-care-desktop.webp" alt="" fetchPriority="high" decoding="async" />
        </picture>
        <div className={styles.scrim} aria-hidden="true" />
        <div className={styles.wave} aria-hidden="true" />
        <header className="relative z-20 flex items-center gap-2 px-6 pt-4 xl:px-12 2xl:px-16">
          <Link href="/" className="flex-none">
            <img src="/logo.svg" alt={h.name} className="h-9 xl:h-10" />
          </Link>
          <nav className="ml-8 hidden items-center gap-5 whitespace-nowrap text-[14px] font-semibold text-slate-600 min-[1760px]:flex">
            {nav.map((n) => (
              <a key={n.href} href={n.href} onClick={n.href === '#book' ? (e) => (e.preventDefault(), openBooking()) : undefined} className={cx('relative whitespace-nowrap transition hover:text-navy', n.active && 'text-navy after:absolute after:-bottom-2.5 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary')}>
                {n.label}
              </a>
            ))}
          </nav>
          <span className="flex-1" />
          <LangSwitch className="bg-white shadow-card ring-1 ring-slate-200 max-xl:[&>button]:!px-2.5" />
          <a href={telUrl(h.phone)} className="hidden items-center gap-2.5 xl:flex" aria-label={`${t.call} ${h.phone}`}>
            <span className={cx(roundBtn, 'size-10 bg-white text-primary shadow-card ring-1 ring-slate-200 hover:bg-primary-50')}>
              <Phone size={17} />
            </span>
            <span className="hidden flex-col leading-tight min-[1900px]:flex">
              <span className="text-[11px] font-medium text-slate-500">{t.emergency}</span>
              <span className="whitespace-nowrap text-[14px] font-bold text-navy">{h.phone}</span>
            </span>
          </a>
          {/* the two logins, labelled at every width */}
          <Link href={staffLoginHref(staff, false)} className={cx(pill, 'bg-white text-navy shadow-card ring-[1.5px] ring-navy/25 hover:bg-navy hover:text-white max-xl:px-3 max-xl:text-[13px]')}>
            <Stethoscope size={16} className="max-xl:hidden" /> {staff.signedIn ? t.openDashboard : t.navStaffLogin}
          </Link>
          <Link href={accountHref} className={cx(pill, 'max-w-[190px] bg-primary text-white shadow-[0_6px_16px_rgba(0,144,202,.35)] hover:bg-primary-700 max-xl:px-3 max-xl:text-[13px]')}>
            <UserRound size={16} className="flex-none max-xl:hidden" /> <span className="truncate">{patient ? firstName : t.navPatientLogin}</span>
          </Link>
        </header>

        <div className={cx(styles.content, 'relative z-10 flex flex-1 flex-col justify-center px-6 pb-6 pt-8 xl:px-12 2xl:px-16')}>
          <div className={styles.copy}>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-[.16em] text-primary-700 shadow-sm ring-1 ring-white backdrop-blur">
              <span className="size-1.5 rounded-full bg-teal shadow-[0_0_0_3px_rgba(58,181,167,.28)]" />
              {t.heroKicker}
            </div>
            <h1 className="mt-4 font-extrabold leading-[1.0] tracking-[-.03em] text-navy">
              {t.heroTitle1}
              <br />
              <span className="bg-gradient-to-r from-[#0085ff] to-[#00a7a8] bg-clip-text text-transparent">{t.heroTitle2}</span>
            </h1>
            <p className="mt-5 text-[17px] leading-[28px] text-slate-600">{t.heroSub}</p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => openBooking()} className="flex h-[56px] items-center gap-2.5 rounded-full bg-gradient-to-r from-primary to-[#12A5B8] px-7 text-[16px] font-bold text-white shadow-[0_10px_24px_rgba(0,144,202,.35)] transition hover:-translate-y-px hover:shadow-[0_14px_30px_rgba(0,144,202,.45)]">
                <CalendarDays size={19} /> {t.ctaBook} <ArrowRight size={18} />
              </button>
              <Link href={patient ? '/my' : '/my/register'} className={cx(pillWhite, styles.cta2, 'h-[56px] px-6 text-[16px]')}>
                <UserRound size={18} /> {patient ? t.ctaMy : t.ctaAccount}
              </Link>
            </div>
            <div className="mt-4 inline-flex items-center gap-2.5 rounded-2xl bg-white/85 py-1.5 pl-1.5 pr-3.5 shadow-sm ring-1 ring-white backdrop-blur">
              <span className="flex size-8 flex-none items-center justify-center rounded-xl bg-primary text-white">
                <PhoneCall size={15} />
              </span>
              <span className="text-[13px] font-semibold text-navy">
                {t.heroChip} <span className="font-normal text-slate-500">· {t.openHours} {h.hours}</span>
              </span>
            </div>
          </div>

          {/* what we do: four compact tiles that stay clear of the photo */}
          <ul id="services" className={cx(styles.features, 'mt-7 grid scroll-mt-6 grid-cols-2 gap-2.5')}>
            {features.map((f) => (
              <li key={f.title} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white/90 px-3 py-2.5 shadow-[0_6px_18px_rgba(31,56,100,.08)] ring-1 ring-white backdrop-blur" title={f.sub}>
                <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary">
                  <f.icon size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold leading-tight text-navy">{f.title}</span>
                  <span className={cx(styles.featSub, 'mt-0.5 block truncate text-[12px] text-slate-500')}>{f.sub}</span>
                </span>
              </li>
            ))}
          </ul>

          <div id="why" className={cx(styles.stats, 'mt-8 grid scroll-mt-6 grid-cols-4 gap-4 rounded-3xl bg-white/90 p-5 shadow-[0_12px_40px_rgba(31,56,100,.10)] ring-1 ring-white backdrop-blur')}>
            {stats.map((s) => (
              <div key={s.l} className="flex items-center gap-3 border-l border-slate-200 pl-4 first:border-0 first:pl-0">
                <span className={cx(styles.statIcon, 'flex size-12 flex-none items-center justify-center rounded-full bg-primary-50 text-primary')}>
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

        <button type="button" onClick={() => openBooking()} className={cx(styles.hint, 'relative z-10 mx-auto mb-3.5 flex flex-col items-center gap-0.5 text-[13px] font-semibold text-slate-500 hover:text-navy')}>
          <Mouse size={18} />
          {t.scrollHint}
          <ChevronDown size={16} className="animate-bounce" />
        </button>
      </section>

      {/* ------------------------------------------------------------ booking: the right-hand card on desktop · a full-screen step-by-step flow on phones */}
      <section
        id="book"
        ref={panel}
        {...(phone && { role: 'dialog', 'aria-modal': true, 'aria-label': t.ctaBook })}
        className={cx('hc-scroll max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:flex-col max-lg:bg-[#EEF5FA] lg:relative lg:z-10 lg:block lg:h-dvh lg:overflow-y-auto lg:py-4 lg:pr-4', bookOpen ? 'max-lg:flex' : 'max-lg:hidden')}
      >
        {/* phones: the flow's top bar — close, title, language, then the progress strip (drawn by the form) */}
        <div className="flex-none bg-white shadow-[0_6px_20px_rgba(31,56,100,.07)] lg:hidden">
          <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-[max(10px,env(safe-area-inset-top))]">
            <button type="button" onClick={closeBooking} className={cx(roundBtn, 'size-10 bg-slate-100 text-slate-700 active:bg-slate-200')} aria-label={t.close}>
              <X size={20} />
            </button>
            <span className="min-w-0 flex-1 truncate text-[18px] font-extrabold text-navy">{t.ctaBook}</span>
            <LangSwitch className="!h-9 bg-slate-100 [&>button]:!h-7 [&>button]:!px-2.5" />
          </div>
          <div ref={setProgressHost} />
        </div>

        <div ref={setScroller} className="max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto max-lg:overscroll-contain">
          <div className="mx-auto max-w-[640px] max-lg:px-3 max-lg:py-3.5 lg:pb-4">
            <div className="lg:overflow-hidden lg:rounded-[28px] lg:bg-white lg:shadow-[0_24px_60px_rgba(31,56,100,.18)] lg:ring-1 lg:ring-white/70">
              <div className="hidden items-start justify-between gap-3.5 bg-gradient-to-r from-primary to-[#1FB6E8] px-6 py-5 text-white lg:flex">
                <div className="min-w-0">
                  <h2 className="text-[26px] font-extrabold leading-tight">{t.ctaBook}</h2>
                  <p className="mt-1 text-[13.5px] text-white/85">{t.bookSub}</p>
                </div>
                <span className="flex size-11 flex-none items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/40">
                  <CalendarDays size={22} />
                </span>
              </div>
              <div className="lg:bg-[#EEF5FA] lg:p-4">
                <BookingForm services={services} zones={zones} booking={booking} legacySlots={legacySlots} hotline={h.phone} hours={h.hours} prefill={prefill} signedIn={!!patient} wizard={phone ? { progress: progressHost, bar: barHost, scroller } : null} preselect={preselect} />
              </div>
            </div>

            {/* desktop: the two logins and the footer sit under the card */}
            <div className="hidden lg:block">
              <LoginCards session={session} phone={false} className="mt-4" />
              <SiteFooter hospital={h} session={session} phone={false} className="mb-6 mt-4" />
            </div>
          </div>
        </div>

        {/* phones: Back / Next (drawn by the form) */}
        <div ref={setBarHost} className="flex-none border-t border-slate-200 bg-white/95 backdrop-blur empty:hidden lg:hidden" />
      </section>

      {/* ------------------------------------------------------------ phones: bottom tab bar (Book raised in the middle) + "More" menu + Login sheet */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 rounded-t-[26px] border-t border-white/70 bg-white/90 pb-[env(safe-area-inset-bottom)] text-[11.5px] font-semibold text-slate-500 shadow-[0_-8px_30px_rgba(31,56,100,.12)] backdrop-blur-xl lg:hidden" aria-label={t.menu}>
        <TabButton icon={House} label={t.navHome} active onClick={scrollTop} />
        {patient ? <TabLink icon={Truck} label={t.qaTrack} href="/my" /> : <TabButton icon={Truck} label={t.qaTrack} onClick={() => setLogin(true)} />}
        <button type="button" onClick={() => openBooking()} className="relative flex flex-col items-center justify-end pb-2 text-primary-700" aria-label={t.ctaBook}>
          <span className="absolute -top-6 flex size-[58px] items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#12A5B8] text-white shadow-[0_10px_24px_rgba(0,144,202,.45)] ring-4 ring-[#F2F8FD] active:scale-95">
            <CalendarDays size={25} />
          </span>
          <span className="font-bold">{t.qaBook}</span>
        </button>
        {patient ? <TabLink icon={UserRound} label={t.navAccount} href="/my" /> : <TabButton icon={UserRound} label={t.login} onClick={() => setLogin(true)} />}
        <TabButton icon={LayoutGrid} label={t.navMore} onClick={() => setMenu(true)} />
      </nav>

      {login && <LoginSheet session={session} onClose={() => setLogin(false)} />}

      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label={t.menu}>
          <button type="button" className="absolute inset-0 bg-navy/40 backdrop-blur-[2px]" onClick={() => setMenu(false)} aria-label={t.close} />
          <div className="hc-enter absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-sheet">
            <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-slate-300" />
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[17px] font-bold text-navy">{t.menu}</span>
              <button type="button" onClick={() => setMenu(false)} className={cx(roundBtn, 'size-9 bg-slate-100 text-slate-600')} aria-label={t.close}>
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-2 text-[15px] font-semibold text-slate-800">
              <button type="button" onClick={() => openBooking()} className="flex h-12 items-center gap-3 rounded-xl bg-primary px-4 text-white">
                <CalendarDays size={18} /> {t.ctaBook}
              </button>
              <Link href={accountHref} className="flex h-12 items-center gap-3 rounded-xl bg-slate-50 px-4" onClick={() => setMenu(false)}>
                <UserRound size={18} /> {patient ? t.navMyVisits : t.navPatientLogin}
              </Link>
              <Link href={staffLoginHref(staff, true)} className="flex h-12 items-center gap-3 rounded-xl bg-slate-50 px-4" onClick={() => setMenu(false)}>
                <Stethoscope size={18} /> {staff.signedIn ? t.openDashboard : t.navStaffLogin}
              </Link>
              <a href={telUrl(h.phone)} className="flex h-12 items-center gap-3 rounded-xl bg-slate-50 px-4">
                <Phone size={18} /> {t.call} {h.phone}
              </a>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 px-1 text-[13px] font-medium text-slate-500">
                {!patient && (
                  <Link href="/my/register" onClick={() => setMenu(false)}>
                    {t.ctaAccount}
                  </Link>
                )}
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
const tab = 'flex h-[62px] flex-col items-center justify-center gap-1 transition'
function TabButton({ icon: I, label, active, onClick }: { icon: Icon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx(tab, active ? 'text-primary-700' : 'active:text-navy')}>
      <I size={22} strokeWidth={active ? 2.4 : 2} /> <span className="max-w-full truncate px-1">{label}</span>
    </button>
  )
}
function TabLink({ icon: I, label, href }: { icon: Icon; label: string; href: string }) {
  return (
    <Link href={href} className={cx(tab, 'active:text-navy')}>
      <I size={22} /> <span className="max-w-full truncate px-1">{label}</span>
    </Link>
  )
}
