import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { LoginForm } from '@/components/LoginForm'

export const metadata = { title: 'Sign in' }

/** M01 Login */
export default async function MobileLogin() {
  const u = await getUser().catch(() => null)
  if (u?.platformAccess.includes('app')) redirect('/m')
  return (
    <div className="min-h-dvh bg-slate-200/60">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-white px-6 pb-8 pt-[max(56px,env(safe-area-inset-top))]">
        <img src="/logo.svg" alt="Unico Hospitals" className="h-12 self-start" />
        <div className="mb-8 mt-10">
          <div className="text-[28px] font-bold leading-[34px] tracking-[-.01em]">Unico HomeCare</div>
          <div className="mt-1.5 text-[15px] text-slate-500">Sign in to see your visits for today</div>
        </div>
        <Suspense>
          <LoginForm client="app" />
        </Suspense>
        <div className="mt-auto pt-10 text-center text-[13px] text-slate-500">
          Trouble signing in? Call the Home Care coordinator.
          <div className="mt-1 text-[12px] text-slate-400">Unico Hospitals PLC · Family Medicine</div>
        </div>
      </div>
    </div>
  )
}
