import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { Department } from '@/lib/models'
import { readSignup, SIGNUP_COOKIE } from '@/lib/google-auth'
import { JoinForm } from '@/components/public/JoinForm'

export const metadata: Metadata = { title: 'Your details' }

/** Step 2 of staff sign-up: the Google account is proven by a 30-minute signed cookie. */
export default async function JoinDetails() {
  const g = await readSignup((await cookies()).get(SIGNUP_COOKIE)?.value)
  if (!g) redirect(`/join?error=${encodeURIComponent('Your Google sign-in expired. Please continue with Google again.')}`)
  await db()
  const departments = await Department.find({ isActive: { $ne: false } }).sort({ name: 1 }).select('name').lean<any[]>()
  return (
    <div className="min-h-dvh bg-page px-4 py-8">
      <div className="mx-auto max-w-[460px]">
        <img src="/logo.svg" alt="Unico Hospitals" className="h-10" />
        <div className="mt-6 rounded-card bg-white p-5 shadow-card sm:p-6">
          <h1 className="text-[22px] font-bold text-navy">Your details</h1>
          <div className="mt-3 flex items-center gap-3 rounded-[10px] bg-slate-50 p-3">
            {g.picture ? <img src={g.picture} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" /> : null}
            <div className="min-w-0 text-[14px]">
              <div className="truncate font-semibold">{g.name}</div>
              <div className="truncate text-slate-500">{g.email}</div>
            </div>
          </div>
          <JoinForm name={g.name} departments={departments.map((d) => ({ id: String(d._id), name: d.name }))} />
        </div>
      </div>
    </div>
  )
}
