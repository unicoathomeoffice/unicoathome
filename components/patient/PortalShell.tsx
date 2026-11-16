'use client'
// Patient portal chrome (/my): the patient's own home care module, view only. Desktop: left sidebar (patient card, the
// sections, book + help); phones: header + bottom tab bar with a "More" sheet. Shares the public page's EN | বাংলা.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { CalendarCheck, CalendarPlus, FileText, HeartPulse, LayoutDashboard, LogOut, Menu, Phone, Receipt, Repeat, UserRound, X } from 'lucide-react'
import { api } from '@/components/client/api'
import { telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { LangProvider, LangSwitch, useLang } from '@/components/public/i18n'

type Patient = { name: string; initials: string; photoUrl?: string; uhid?: string }

export function PortalShell({ patient, hotline, children }: { patient: Patient; hotline: string; children: ReactNode }) {
  return (
    <LangProvider>
      <Shell patient={patient} hotline={hotline}>
        {children}
      </Shell>
    </LangProvider>
  )
}

function Avatar({ p, size = 44 }: { p: Patient; size?: number }) {
  return (
    <span className="relative flex flex-none items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-teal font-bold text-white ring-2 ring-white/70" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {p.initials}
      {p.photoUrl && <img src={p.photoUrl} alt="" className="absolute inset-0 size-full object-cover" />}
    </span>
  )
}

function Shell({ patient, hotline, children }: { patient: Patient; hotline: string; children: ReactNode }) {
  const { t, lang } = useLang()
  const path = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  useEffect(() => setMore(false), [path])
  async function signOut() {
    setBusy(true)
    await api('/patient/logout', { method: 'POST', body: {} }).catch(() => {})
    router.replace('/')
    router.refresh()
  }
  const nav = [
    { href: '/my', label: t.pOverview, icon: LayoutDashboard, on: path === '/my' },
    { href: '/my/visits', label: t.navMyVisits, icon: CalendarCheck, on: path.startsWith('/my/visits') || path.startsWith('/my/requests') },
    { href: '/my/schedules', label: t.pSchedules, icon: Repeat, on: path.startsWith('/my/schedules') },
    { href: '/my/health', label: t.pHealth, icon: HeartPulse, on: path.startsWith('/my/health') },
    { href: '/my/bills', label: t.pBills, icon: Receipt, on: path.startsWith('/my/bills') },
    { href: '/my/documents', label: t.pDocs, icon: FileText, on: path.startsWith('/my/documents') },
    { href: '/my/profile', label: t.profile, icon: UserRound, on: path.startsWith('/my/profile') },
  ]
  const tabs = [nav[0], nav[1], null, nav[4]] // phones: overview · visits · [book] · bills · more
  const current = nav.find((n) => n.on)

  return (
    <div className="min-h-dvh bg-page" style={lang === 'bn' ? { fontFamily: 'var(--font-bn), var(--font-dm-sans), sans-serif' } : undefined}>
      {/* ---------------------------------------------------------------- desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-slate-200/70 bg-white lg:flex">
        <div className="relative overflow-hidden bg-gradient-to-br from-navy via-[#1B5A8C] to-primary px-5 pb-5 pt-4 text-white">
          <span className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-white/10" />
          <span className="pointer-events-none absolute -bottom-12 right-8 size-24 rounded-full bg-teal/30 blur-xl" />
          <Link href="/" className="relative inline-flex rounded-lg bg-white px-2 py-1">
            <img src="/logo.svg" alt="Unico Hospitals" className="h-7" />
          </Link>
          <div className="relative mt-4 flex items-center gap-3">
            <Avatar p={patient} size={48} />
            <div className="min-w-0">
              <div className="truncate text-[15.5px] font-bold">{patient.name}</div>
              {patient.uhid ? <div className="mt-0.5 inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[11.5px] font-semibold tracking-wide ring-1 ring-white/25">{t.uhidLabel} {patient.uhid}</div> : <div className="text-[12px] text-white/75">{t.portalTitle}</div>}
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[.08em] text-slate-400">{t.portalTitle}</div>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={cx('group mb-0.5 flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition', n.on ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
              <span className={cx('flex size-8 items-center justify-center rounded-lg transition', n.on ? 'bg-gradient-to-br from-primary to-teal text-white shadow-sm' : 'bg-slate-100 text-slate-500 group-hover:text-primary-700')}>
                <n.icon size={16} />
              </span>
              {n.label}
            </Link>
          ))}
          <Link href="/?book=1#book" className="mt-4 flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-teal text-[14px] font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-px">
            <CalendarPlus size={18} /> {t.newRequest}
          </Link>
        </nav>
        <div className="border-t border-slate-100 p-3">
          <a href={telUrl(hotline)} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 hover:bg-primary-50">
            <span className="flex size-9 items-center justify-center rounded-full bg-white text-primary-700 shadow-sm">
              <Phone size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[11.5px] text-slate-500">{t.needHelp}</span>
              <span className="block text-[14px] font-bold text-navy">{hotline}</span>
            </span>
          </a>
          <button type="button" onClick={signOut} disabled={busy} className="mt-2 flex h-10 w-full items-center gap-2 rounded-xl px-3 text-[13.5px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-[#B91C1C]">
            <LogOut size={16} /> {t.signOut}
          </button>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- top bar (all sizes) */}
      <header className="sticky top-0 z-20 border-b border-white/60 hc-glass lg:pl-[264px]">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-2 px-4 lg:px-8">
          <Link href="/" className="flex items-center lg:hidden">
            <img src="/logo.svg" alt="Unico Hospitals" className="h-8" />
          </Link>
          <div className="hidden min-w-0 lg:block">
            <div className="text-[11.5px] font-semibold uppercase tracking-[.07em] text-slate-400">{t.portalTitle}</div>
            <div className="-mt-0.5 truncate text-[16px] font-bold text-navy">{current?.label ?? t.portalTitle}</div>
          </div>
          <span className="flex-1" />
          <span className="mr-1 hidden rounded-full bg-amber-50 px-3 py-1 text-[12px] font-semibold text-amber-700 ring-1 ring-amber-200 xl:inline">{t.viewOnly}</span>
          <LangSwitch />
          <a href={telUrl(hotline)} className="flex size-10 items-center justify-center rounded-full bg-primary-50 text-primary-700 lg:hidden" aria-label={`${t.call} ${hotline}`}>
            <Phone size={17} />
          </a>
          <span className="lg:hidden">
            <Avatar p={patient} size={36} />
          </span>
        </div>
      </header>

      <main className="pb-28 lg:pb-12 lg:pl-[264px]">
        <div className="mx-auto max-w-[1180px] px-4 pt-5 lg:px-8 lg:pt-7">{children}</div>
      </main>

      {/* ---------------------------------------------------------------- phone tab bar + More sheet */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/60 px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 hc-glass lg:hidden">
        <div className="flex">
          {tabs.map((tb, i) =>
            tb ? (
              <Link key={tb.href} href={tb.href} className={cx('flex flex-1 flex-col items-center gap-[3px] text-[11px] font-semibold', tb.on ? 'text-primary' : 'text-slate-500')}>
                <span className={cx('flex size-10 items-center justify-center rounded-full', tb.on && 'bg-primary-50')}>
                  <tb.icon size={21} />
                </span>
                <span className="max-w-[90px] truncate">{tb.label}</span>
              </Link>
            ) : (
              <Link key={`book-${i}`} href="/?book=1#book" className="flex flex-1 flex-col items-center gap-[3px] text-[11px] font-semibold text-primary-700">
                <span className="-mt-5 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-teal text-white shadow-lg shadow-primary/30 ring-4 ring-white">
                  <CalendarPlus size={24} />
                </span>
                {t.ctaBook}
              </Link>
            ),
          )}
          <button type="button" onClick={() => setMore(true)} className={cx('flex flex-1 flex-col items-center gap-[3px] text-[11px] font-semibold', more || [2, 3, 5, 6].some((k) => nav[k].on) ? 'text-primary' : 'text-slate-500')}>
            <span className="flex size-10 items-center justify-center rounded-full">
              <Menu size={21} />
            </span>
            {t.pMore}
          </button>
        </div>
      </nav>
      {more && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[26px] bg-white p-4 pb-[max(18px,env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-navy to-primary p-3.5 text-white">
              <Avatar p={patient} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">{patient.name}</div>
                {patient.uhid && <div className="text-[12px] text-white/80">{t.uhidLabel} {patient.uhid}</div>}
              </div>
              <button type="button" onClick={() => setMore(false)} className="flex size-9 items-center justify-center rounded-full bg-white/15" aria-label={t.close}>
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className={cx('flex items-center gap-2.5 rounded-xl px-3 py-3 text-[13.5px] font-semibold ring-1', n.on ? 'bg-primary-50 text-primary-700 ring-primary/20' : 'bg-slate-50 text-slate-700 ring-slate-100')}>
                  <n.icon size={18} /> {n.label}
                </Link>
              ))}
              <button type="button" onClick={signOut} disabled={busy} className="flex items-center gap-2.5 rounded-xl bg-[#FEF2F2] px-3 py-3 text-[13.5px] font-semibold text-[#B91C1C] ring-1 ring-[#FEE2E2]">
                <LogOut size={18} /> {t.signOut}
              </button>
            </div>
            <p className="mt-3 text-center text-[12px] text-slate-500">{t.viewOnly}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Centered card for sign-in / create-account pages. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <LangProvider>
      <AuthInner>{children}</AuthInner>
    </LangProvider>
  )
}
function AuthInner({ children }: { children: ReactNode }) {
  const { lang } = useLang()
  return (
    <div className="relative min-h-dvh overflow-hidden bg-page px-4 py-6" style={lang === 'bn' ? { fontFamily: 'var(--font-bn), var(--font-dm-sans), sans-serif' } : undefined}>
      <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-primary/15 blur-3xl hc-blob" />
      <div className="pointer-events-none absolute -bottom-24 -right-20 size-80 rounded-full bg-teal/20 blur-3xl hc-blob" style={{ animationDelay: '-4s' }} />
      <div className="relative mx-auto max-w-[440px]">
        <div className="mb-5 flex items-center justify-between">
          <Link href="/">
            <img src="/logo.svg" alt="Unico Hospitals" className="h-9" />
          </Link>
          <LangSwitch />
        </div>
        <div className="rounded-2xl p-5 hc-soft sm:p-7">{children}</div>
      </div>
    </div>
  )
}
