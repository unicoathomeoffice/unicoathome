'use client'
// The two ways in — Patient login and Staff login — as a pair of cards (used on the landing page, in the desktop
// right column and in the phone "Login" sheet), plus the sheet itself.
import Link from 'next/link'
import { ArrowRight, Stethoscope, UserRound, X } from 'lucide-react'
import { cx } from '@/lib/format'
import { useLang } from './i18n'

export type PublicSession = { staff: { href: string; signedIn: boolean }; patient: { name: string } | null }

/** Where "Staff login" goes: the dashboard when signed in; otherwise the field app sign-in on phones, the web one on desktop. */
export const staffLoginHref = (s: PublicSession['staff'], phone: boolean) => (s.signedIn ? s.href : phone ? '/m/login' : '/login')

export function LoginCards({ session, phone, onNavigate, className }: { session: PublicSession; phone: boolean; onNavigate?: () => void; className?: string }) {
  const { t } = useLang()
  const { patient, staff } = session
  const card = 'group relative flex flex-col overflow-hidden rounded-3xl p-4 text-left transition hover:-translate-y-0.5'
  return (
    <div className={cx('grid gap-3 sm:grid-cols-2', className)}>
      {/* ---- patient */}
      <div className={cx(card, 'bg-gradient-to-br from-primary to-[#12A5B8] text-white shadow-[0_14px_30px_rgba(0,144,202,.28)]')}>
        <span className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/15" aria-hidden />
        <span className="flex size-11 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/40">
          <UserRound size={22} />
        </span>
        <span className="mt-3 text-[17px] font-extrabold leading-tight">{patient ? patient.name : t.lsPatient}</span>
        <span className="mt-1 text-[13px] leading-[19px] text-white/85">{t.lsPatientSub}</span>
        <Link href={patient ? '/my' : '/my/login'} onClick={onNavigate} className="mt-3.5 flex h-11 items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-bold text-primary-700 shadow-sm after:absolute after:inset-0">
          {patient ? t.ctaMy : t.navPatientLogin} <ArrowRight size={16} />
        </Link>
        {!patient && (
          <Link href="/my/register" onClick={onNavigate} className="relative z-10 mt-2 self-center text-[12.5px] font-semibold text-white/90 underline decoration-white/40 underline-offset-2">
            {t.ctaAccount}
          </Link>
        )}
      </div>
      {/* ---- staff */}
      <div className={cx(card, 'bg-gradient-to-br from-navy to-[#2B4C86] text-white shadow-[0_14px_30px_rgba(31,56,100,.28)]')}>
        <span className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/10" aria-hidden />
        <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30">
          <Stethoscope size={22} />
        </span>
        <span className="mt-3 text-[17px] font-extrabold leading-tight">{t.lsStaff}</span>
        <span className="mt-1 text-[13px] leading-[19px] text-white/80">{t.lsStaffSub}</span>
        <Link href={staffLoginHref(staff, phone)} onClick={onNavigate} className="mt-3.5 flex h-11 items-center justify-center gap-2 rounded-full bg-white text-[14.5px] font-bold text-navy shadow-sm after:absolute after:inset-0">
          {staff.signedIn ? t.openDashboard : t.navStaffLogin} <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}

/** Phones / tablets: the "Login" bottom sheet. */
export function LoginSheet({ session, onClose }: { session: PublicSession; onClose: () => void }) {
  const { t } = useLang()
  return (
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal aria-label={t.lsTitle}>
      <button type="button" className="absolute inset-0 bg-navy/45 backdrop-blur-[2px]" onClick={onClose} aria-label={t.close} />
      <div className="hc-enter absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-[30px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-sheet">
        <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-300" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[21px] font-extrabold leading-tight text-navy">{t.lsTitle}</div>
            <div className="mt-0.5 text-[13.5px] text-slate-500">{t.lsSub}</div>
          </div>
          <button type="button" onClick={onClose} className="flex size-9 flex-none items-center justify-center rounded-full bg-slate-100 text-slate-600" aria-label={t.close}>
            <X size={18} />
          </button>
        </div>
        <LoginCards session={session} phone onNavigate={onClose} />
      </div>
    </div>
  )
}
