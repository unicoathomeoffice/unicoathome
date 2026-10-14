'use client'
// Patient portal chrome (/my): glass header, EN/বাংলা, bottom tab bar on phones. Shares the public page's i18n.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { CalendarPlus, Home, LogOut, Phone, UserRound } from 'lucide-react'
import { api } from '@/components/client/api'
import { telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { LangProvider, LangSwitch, useLang } from '@/components/public/i18n'

type Patient = { name: string; initials: string }

export function PortalShell({ patient, hotline, children }: { patient: Patient; hotline: string; children: ReactNode }) {
  return (
    <LangProvider>
      <Shell patient={patient} hotline={hotline}>
        {children}
      </Shell>
    </LangProvider>
  )
}

function Shell({ patient, hotline, children }: { patient: Patient; hotline: string; children: ReactNode }) {
  const { t, lang } = useLang()
  const path = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    await api('/patient/logout', { method: 'POST', body: {} }).catch(() => {})
    router.replace('/')
    router.refresh()
  }
  const tabs = [
    { href: '/my', label: t.navMyVisits, icon: Home, on: path === '/my' || path.startsWith('/my/requests') },
    { href: '/?book=1#book', label: t.newRequest, icon: CalendarPlus, on: false, accent: true },
    { href: '/my/profile', label: t.profile, icon: UserRound, on: path.startsWith('/my/profile') },
  ]
  return (
    <div className="min-h-dvh bg-page pb-24 md:pb-10" style={lang === 'bn' ? { fontFamily: 'var(--font-bn), var(--font-dm-sans), sans-serif' } : undefined}>
      <header className="sticky top-0 z-30 border-b border-white/60 hc-glass">
        <div className="mx-auto flex h-14 max-w-[960px] items-center gap-2 px-4">
          <Link href="/" className="flex items-center">
            <img src="/logo.svg" alt="Unico Hospitals" className="h-8" />
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {tabs.map((tb) => (
              <Link key={tb.href} href={tb.href} className={cx('flex h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold', tb.on ? 'bg-primary-50 text-primary-700' : tb.accent ? 'text-primary-700 hover:bg-primary-50' : 'text-slate-600 hover:bg-slate-100')}>
                <tb.icon size={16} /> {tb.label}
              </Link>
            ))}
          </nav>
          <span className="flex-1" />
          <LangSwitch />
          <a href={telUrl(hotline)} className="flex size-10 items-center justify-center rounded-full bg-primary-50 text-primary-700" aria-label={`${t.call} ${hotline}`}>
            <Phone size={17} />
          </a>
          <div className="ml-1 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-teal text-[13px] font-bold text-white">{patient.initials}</span>
            <button type="button" onClick={signOut} disabled={busy} className="hidden h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-slate-500 hover:bg-slate-100 md:flex" title={t.signOut}>
              <LogOut size={15} /> {t.signOut}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[960px] px-4 pt-5">{children}</main>

      {/* phone tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/60 px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 hc-glass md:hidden">
        <div className="flex">
          {tabs.map((tb) => (
            <Link key={tb.href} href={tb.href} className={cx('flex flex-1 flex-col items-center gap-[3px] text-[11px] font-semibold', tb.on ? 'text-primary' : tb.accent ? 'text-primary-700' : 'text-slate-500')}>
              <span className={cx('flex size-10 items-center justify-center rounded-full', tb.accent && 'bg-gradient-to-br from-primary to-teal text-white shadow-md', tb.on && !tb.accent && 'bg-primary-50')}>
                <tb.icon size={tb.accent ? 22 : 21} />
              </span>
              <span className="max-w-[100px] truncate">{tb.accent ? t.ctaBook : tb.label}</span>
            </Link>
          ))}
          <button type="button" onClick={signOut} disabled={busy} className="flex flex-1 flex-col items-center gap-[3px] text-[11px] font-semibold text-slate-500">
            <span className="flex size-10 items-center justify-center rounded-full">
              <LogOut size={21} />
            </span>
            {t.signOut}
          </button>
        </div>
      </nav>
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
