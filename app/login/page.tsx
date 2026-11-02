import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { CalendarCheck, FileText, MapPin, MessageCircle } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { LoginForm } from '@/components/LoginForm'

export const metadata = { title: 'Sign in' }

const FEATURES = [
  { icon: CalendarCheck, label: 'Confirm & assign' },
  { icon: MapPin, label: 'Live tracking' },
  { icon: MessageCircle, label: 'WhatsApp updates' },
  { icon: FileText, label: 'H360 billing' },
]

/** W01 Login */
export default async function LoginPage() {
  const u = await getUser().catch(() => null)
  if (u?.platformAccess.includes('web')) redirect('/dashboard')
  return (
    <div className="flex min-h-dvh">
      <div className="relative hidden w-[560px] flex-none overflow-hidden bg-navy text-white lg:flex xl:w-[620px]">
        <picture>
          <source type="image/avif" srcSet="/home-care-mobile.avif" />
          <img src="/home-care-mobile.webp" alt="" fetchPriority="high" decoding="async" className="absolute -top-[30%] right-0 h-[130%] w-auto max-w-none" />
        </picture>
        <div className="absolute inset-0 bg-navy/15" />
        <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-navy/55 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[66%] bg-gradient-to-t from-navy via-navy/90 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_0%_100%,rgba(0,144,202,.35),transparent_60%)]" />

        <div className="relative flex w-full flex-col p-12">
          <div className="self-start rounded-card bg-white px-[18px] py-3.5 shadow-[0_10px_30px_rgba(15,23,42,.25)]">
            <img src="/logo.svg" alt="Unico Hospitals" className="block h-11" />
          </div>

          <div className="mt-auto">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[12.5px] font-semibold tracking-[.04em] text-white/90 ring-1 ring-white/20 backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-teal shadow-[0_0_0_3px_rgba(58,181,167,.3)]" />
              Family Medicine · Unico @ Home
            </div>
            <div className="mt-4 text-[44px] font-bold leading-[48px] tracking-[-.02em] drop-shadow-[0_2px_12px_rgba(15,23,42,.35)]">
              Hospital care,
              <br />
              <span className="bg-gradient-to-r from-[#7DD3F5] to-[#8FE3D6] bg-clip-text text-transparent">at the patient’s door.</span>
            </div>
            <div className="mt-3 max-w-[420px] text-base leading-6 text-white/80">Every Unico @ Home visit in one place — from the first call to the final bill. The right doctor, nurse and car on time, and families kept informed at every step.</div>
            <div className="mt-6 flex max-w-[460px] flex-wrap gap-2">
              {FEATURES.map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
                  <Icon size={14} className="text-[#8FE3D6]" /> {label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-10 flex items-center gap-6 border-t border-white/15 pt-5 text-[13px] text-white/60">
            <span>Unico Hospitals PLC · Dhaka</span>
            <span className="ml-auto rounded-md bg-white/10 px-2 py-0.5 text-[12px]">v1.0</span>
          </div>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-page p-4">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[480px] rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-32 size-[420px] rounded-full bg-teal/10 blur-3xl" />
        <div className="relative w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-card ring-1 ring-slate-100 sm:p-8">
          <img src="/logo.svg" alt="Unico Hospitals" className="mb-6 h-10 lg:hidden" />
          <h1 className="text-[22px] font-bold">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">Web access for coordinators, front desk and admins</p>
          <Suspense>
            <LoginForm client="web" />
          </Suspense>
          <div className="mt-6 text-center text-[13px] text-slate-500">
            Field staff?{' '}
            <a href="/m/login" className="font-semibold text-primary">
              Open the HomeCare app
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
