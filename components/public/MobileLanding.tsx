'use client'
// Phones and tablets (below lg): the public home. MobileHero is a compact blue band with the photo; the booking card
// (PublicHome) sits right under it, so the form is the first thing on the screen. MobileLanding is everything after
// the form: quick actions, the services (tap one to book it), how it works, why us, the two logins and the footer.
// The desktop split screen is a separate tree in PublicHome.
import Link from 'next/link'
import { useEffect, useRef, type ReactNode } from 'react'
import { CalendarDays, ChevronRight, Clock3, FlaskConical, House, MessageCircle, Phone, Stethoscope, Truck, UserRound } from 'lucide-react'
import { telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { useLang } from './i18n'
import { LoginCards, staffLoginHref, type PublicSession } from './LoginSheet'
import { serviceMeta } from './services-meta'
import styles from './PublicHome.module.css'

export type Hospital = { name: string; department: string; phone: string; address: string; hours: string }
type Service = { code: string; name: string; category: string }

/** wa.me link of a Bangladeshi number written any way ("+880 1841-996655", "01841996655") */
export const waUrl = (phone: string) => {
  const d = phone.replace(/\D/g, '')
  return `https://wa.me/${d.startsWith('880') ? d : d.startsWith('0') ? `88${d}` : `880${d}`}`
}

/** Fades a block up as it scrolls into view. Blocks already on screen at load are left alone (nothing flashes),
 *  and without JavaScript everything simply shows. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return
    el.classList.add(styles.pre)
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          el.classList.remove(styles.pre)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={cx(styles.rv, className)}>
      {children}
    </div>
  )
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[21px] font-extrabold leading-tight tracking-[-.01em] text-navy">{title}</h2>
        {sub && <p className="mt-0.5 text-[13.5px] text-slate-500">{sub}</p>}
      </div>
    </div>
  )
}

/** Phones / tablets: a compact blue band — the title, one line about the service and the photo. The booking card
 *  overlaps its bottom edge, so the form is on the first screen. */
export function MobileHero() {
  const { t, lang } = useLang()
  const fade = 'linear-gradient(to right, transparent 6%, #000 56%)'
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[#0A6FB5] via-primary to-[#12A5B8] px-5 pb-[70px] pt-5 text-white sm:px-8 lg:hidden">
      {/* the portrait photo, zoomed on the two faces and faded into the blue (desktop has its own hero: 1px GIF there) */}
      <picture aria-hidden="true">
        <source media="(min-width: 1024px)" srcSet="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
        <source type="image/avif" srcSet="/home-care-mobile.avif" />
        <img src="/home-care-mobile.webp" alt="" fetchPriority="high" decoding="async" className="absolute right-0 top-[-34%] h-[165%] w-auto max-w-none" style={{ maskImage: fade, WebkitMaskImage: fade }} />
      </picture>
      <span className="pointer-events-none absolute -left-16 -top-20 size-56 rounded-full bg-white/10" aria-hidden />
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[62%] bg-gradient-to-r from-[#0A6FB5]/70 to-transparent" aria-hidden />
      <div className="relative mx-auto max-w-[720px]">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#0A5C9C]/55 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-white ring-1 ring-white/25 backdrop-blur">
          <span className="size-1.5 flex-none rounded-full bg-[#9BE8DD]" />
          <span className="truncate">{t.heroKicker}</span>
        </span>
        <div className="max-w-[64%] sm:max-w-[52%]">
          <h1 className={cx('mt-2.5 font-extrabold drop-shadow-[0_2px_10px_rgba(10,60,110,.35)]', lang === 'bn' ? 'text-[clamp(23px,6.6vw,34px)] leading-[1.25]' : 'text-[clamp(27px,7.8vw,40px)] leading-[1.06] tracking-[-.02em]')}>
            {t.heroTitle1} <span className="text-[#BDF3EA]">{t.heroTitle2}</span>
          </h1>
          <p className="mt-2 text-[13.5px] font-medium leading-[20px] text-white/90 sm:text-[15px] sm:leading-[23px]">{t.heroSubM}</p>
        </div>
      </div>
    </section>
  )
}

export function MobileLanding({ hospital: h, services, session, onBook, onLogin }: { hospital: Hospital; services: Service[]; session: PublicSession; onBook: (serviceCode?: string) => void; onLogin: () => void }) {
  const { t, lang } = useLang()
  const { patient } = session
  const quick = [
    { key: 'call', icon: Phone, label: t.call, tint: 'bg-[#E6F7EC] text-[#16A34A]', href: telUrl(h.phone) },
    { key: 'wa', icon: MessageCircle, label: 'WhatsApp', tint: 'bg-[#DCFCE7] text-[#128C7E]', href: waUrl(h.phone), ext: true },
    { key: 'track', icon: Truck, label: t.qaTrack, tint: 'bg-[#E6F3FB] text-primary', href: patient ? '/my' : null },
    { key: 'me', icon: UserRound, label: patient ? t.navAccount : t.login, tint: 'bg-[#F1E9FD] text-[#7C3AED]', href: patient ? '/my/profile' : null },
  ]
  const steps = [
    { title: t.how1, sub: t.how1s },
    { title: t.how2, sub: t.how2s },
    { title: t.how3, sub: t.how3s },
  ]
  const points = [
    { icon: Stethoscope, title: t.feat1, sub: t.feat1s },
    { icon: FlaskConical, title: t.feat2, sub: t.feat2s },
    { icon: Clock3, title: t.feat3, sub: t.feat3s },
    { icon: House, title: t.feat4, sub: t.feat4s },
  ]
  const tile = 'flex flex-col items-center gap-1.5 rounded-2xl bg-white px-1 py-3 text-[12.5px] font-semibold text-slate-700 shadow-[0_6px_20px_rgba(31,56,100,.07)] ring-1 ring-slate-100 active:scale-[.97]'

  return (
    <main className="px-4 pb-32 pt-4 sm:px-8 lg:hidden">
      <div className="mx-auto max-w-[720px]">
          <div className="grid grid-cols-4 gap-2.5">
            {quick.map((q) => {
              const body = (
                <>
                  <span className={cx('flex size-11 items-center justify-center rounded-2xl', q.tint)}>
                    <q.icon size={21} />
                  </span>
                  <span className="max-w-full truncate px-0.5">{q.label}</span>
                </>
              )
              if (!q.href)
                return (
                  <button key={q.key} type="button" onClick={onLogin} className={tile}>
                    {body}
                  </button>
                )
              return q.href.startsWith('/') ? (
                <Link key={q.key} href={q.href} className={tile}>
                  {body}
                </Link>
              ) : (
                <a key={q.key} href={q.href} className={tile} {...(q.ext && { target: '_blank', rel: 'noreferrer' })}>
                  {body}
                </a>
              )
            })}
          </div>

          {/* ---------------------------------------------------------- services */}
          {services.length > 0 && (
            <Reveal className="mt-8">
              <section id="m-services" className="scroll-mt-20">
                <Head title={t.secServices} sub={t.secServicesSub} />
                <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 no-scrollbar sm:-mx-8 sm:scroll-px-8 sm:px-8">
                  {services.map((svc) => {
                    const m = serviceMeta(svc, lang)
                    return (
                      <button key={svc.code} type="button" onClick={() => onBook(svc.code)} className="flex w-[152px] flex-none snap-start flex-col rounded-3xl bg-white p-3.5 text-left shadow-[0_8px_24px_rgba(31,56,100,.08)] ring-1 ring-slate-100 active:scale-[.98]">
                        <span className={cx('flex size-12 items-center justify-center rounded-2xl', m.tile)}>
                          <m.icon size={24} />
                        </span>
                        <span className="mt-3 line-clamp-2 min-h-[38px] text-[14.5px] font-bold leading-[19px] text-navy">{svc.name}</span>
                        <span className="mt-1 line-clamp-2 min-h-[34px] text-[12px] leading-[17px] text-slate-500">{m.sub}</span>
                        <span className="mt-2.5 flex items-center gap-0.5 text-[12.5px] font-bold text-primary-700">
                          {t.qaBook} <ChevronRight size={14} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            </Reveal>
          )}

          {/* ---------------------------------------------------------- how it works */}
          <Reveal className="mt-7">
            <section id="m-how" className="scroll-mt-20">
              <Head title={t.navHow} />
              <ol className="grid gap-0 rounded-3xl bg-white p-4 shadow-[0_8px_24px_rgba(31,56,100,.07)] ring-1 ring-slate-100 sm:grid-cols-3 sm:gap-4">
                {steps.map((s, i) => (
                  <li key={s.title} className="relative flex gap-3.5 pb-5 last:pb-0 sm:flex-col sm:pb-0">
                    {i < steps.length - 1 && <span className="absolute left-[19px] top-10 h-[calc(100%-40px)] w-0.5 rounded-full bg-gradient-to-b from-primary/40 to-teal/30 sm:hidden" aria-hidden />}
                    <span className="flex size-10 flex-none items-center justify-center rounded-full bg-gradient-to-br from-primary to-teal text-[16px] font-extrabold text-white shadow-[0_6px_14px_rgba(0,144,202,.3)]">{lang === 'bn' ? (i + 1).toLocaleString('bn-BD') : i + 1}</span>
                    <span className="min-w-0 pt-0.5">
                      <span className="block text-[15px] font-bold leading-snug text-navy">{s.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-[19px] text-slate-500">{s.sub}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </Reveal>

          {/* ---------------------------------------------------------- why us */}
          <Reveal className="mt-7">
            <section id="m-why" className="relative scroll-mt-20 overflow-hidden rounded-[28px] bg-gradient-to-br from-navy via-[#1B4F8F] to-primary p-5 text-white shadow-[0_16px_36px_rgba(31,56,100,.28)]">
              <span className="pointer-events-none absolute -right-14 -top-16 size-48 rounded-full bg-white/10" aria-hidden />
              <span className="pointer-events-none absolute -bottom-20 -left-10 size-44 rounded-full bg-teal/25 blur-2xl" aria-hidden />
              <div className="relative">
                <div className="text-[11.5px] font-bold uppercase tracking-[.16em] text-white/70">{t.navWhy}</div>
                <h2 className="mt-1 text-[24px] font-extrabold leading-[1.1] tracking-[-.01em]">
                  {t.badge1}, <span className="text-[#9BE8DD]">{t.badge2}</span>
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {points.map((x) => (
                    <div key={x.title} className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur-sm">
                      <x.icon size={20} className="text-[#9BE8DD]" />
                      <div className="mt-2 text-[14.5px] font-bold leading-snug">{x.title}</div>
                      <div className="mt-0.5 text-[12px] leading-[16px] text-white/75">{x.sub}</div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => onBook()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-bold text-navy active:scale-[.99]">
                  <CalendarDays size={18} /> {t.ctaBook}
                </button>
              </div>
            </section>
          </Reveal>

          {/* ---------------------------------------------------------- the two logins */}
          <Reveal className="mt-7">
            <section id="m-login" className="scroll-mt-20">
              <Head title={t.lsTitle} sub={t.lsSub} />
              <LoginCards session={session} phone />
            </section>
          </Reveal>

          <Reveal className="mt-7">
            <SiteFooter hospital={h} session={session} phone />
          </Reveal>
      </div>
    </main>
  )
}

/** Address, phone and the small links — a card (phone page end, and under the booking card on desktop). */
export function SiteFooter({ hospital: h, session, phone, className }: { hospital: Hospital; session: PublicSession; phone: boolean; className?: string }) {
  const { t } = useLang()
  const { patient, staff } = session
  const links = [
    { href: '/privacy', label: t.privacyTitle },
    { href: '/terms', label: t.terms },
    { href: patient ? '/my' : '/my/login', label: patient ? t.navMyVisits : t.navPatientLogin },
    { href: staffLoginHref(staff, phone), label: staff.signedIn ? t.openDashboard : t.navStaffLogin },
    { href: '/join', label: t.join },
  ]
  return (
    <footer id={phone ? 'm-contact' : 'contact'} className={cx('scroll-mt-20 rounded-3xl bg-white/95 p-4 text-[13px] text-slate-500 shadow-[0_6px_24px_rgba(31,56,100,0.08)] ring-1 ring-slate-100 backdrop-blur sm:p-5', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
          <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary">
            <House size={19} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14.5px] font-bold leading-snug text-navy">{h.name}</span>
            <span className="block text-[12.5px] leading-snug text-slate-500">{h.address}</span>
          </span>
        </div>
        <a href={telUrl(h.phone)} className="inline-flex h-11 w-full flex-none items-center justify-center gap-2 rounded-full bg-primary-50 px-4 text-[14px] font-bold text-primary-700 transition hover:bg-primary hover:text-white sm:h-10 sm:w-auto">
          <Phone size={16} /> {h.phone}
        </a>
      </div>
      <nav className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3.5 text-[13px] font-medium text-slate-600 sm:gap-x-1">
        {links.map((l, i) => (
          <span key={l.href + i} className="inline-flex items-center gap-1">
            {i > 0 && (
              <span className="hidden px-1 text-slate-300 sm:inline" aria-hidden>
                ·
              </span>
            )}
            <Link href={l.href} className="rounded px-0.5 hover:text-primary-700 hover:underline">
              {l.label}
            </Link>
          </span>
        ))}
      </nav>
      <div className="mt-2.5 text-[11.5px] text-slate-400">
        © {new Date().getFullYear()} {h.name} · {h.department} · {t.rights}
      </div>
    </footer>
  )
}
