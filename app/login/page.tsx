import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { LoginForm } from '@/components/LoginForm'

export const metadata = { title: 'Sign in' }

/** W01 Login */
export default async function LoginPage() {
  const u = await getUser().catch(() => null)
  if (u?.platformAccess.includes('web')) redirect('/dashboard')
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-[560px] flex-none flex-col bg-navy p-12 text-white lg:flex">
        <div className="self-start rounded-card bg-white px-[18px] py-3.5">
          <img src="/logo.svg" alt="Unico Hospitals" className="block h-11" />
        </div>
        <div className="mt-auto">
          <div className="text-[40px] font-bold leading-[46px] tracking-[-.02em]">
            Home Care
            <br />
            Module
          </div>
          <div className="mt-3 max-w-[380px] text-base leading-6 text-white/70">Receive, confirm, assign and track every home visit of the Family Medicine department. Every step timed, every message logged.</div>
        </div>
        <div className="mt-12 flex gap-6 text-[13px] text-white/55">
          <span>Unico Hospitals PLC · Dhaka</span>
          <span>v1.0</span>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center bg-page p-4">
        <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-card sm:p-8">
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
