import Link from 'next/link'
import { ChevronLeft, KeyRound, Phone, ShieldCheck } from 'lucide-react'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { telUrl } from '@/components/ui'

export const metadata = { title: 'Forgot password' }

/** M02 · password reset is done by the coordinator / IT (no SMS provider). Public page. */
export default async function Forgot() {
  let phone = process.env.HOSPITAL_PHONE ?? '+880 9666 710 710'
  try {
    await db()
    phone = (await getSettings()).general.hospitalPhone
  } catch {}
  return (
    <div className="min-h-dvh bg-slate-200/60">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-white px-6 pb-8 pt-[max(20px,env(safe-area-inset-top))]">
        <Link href="/m/login" className="-ml-2 flex size-10 items-center justify-center text-slate-700" aria-label="Back to sign in">
          <ChevronLeft size={22} />
        </Link>
        <div className="mt-6 flex size-14 items-center justify-center rounded-2xl bg-primary-50 text-primary">
          <KeyRound size={26} />
        </div>
        <div className="mt-5 text-[26px] font-bold leading-8 tracking-[-.01em]">Forgot your password?</div>
        <div className="mt-2 text-[15px] leading-[22px] text-slate-500">For your patients&apos; safety, passwords are reset by the Home Care coordinator or IT — not by SMS.</div>

        <div className="mt-6 grid gap-3">
          {[
            ['Call the coordinator', 'Tell them your employee ID (e.g. 11432).'],
            ['They reset it', 'From Staff & users → Reset password, and give you a temporary password.'],
            ['Sign in and change it', 'You will be asked to set a new password — or use Profile → Change password.'],
          ].map(([t, d], i) => (
            <div key={t} className="flex gap-3.5 rounded-card bg-slate-50 px-4 py-3.5">
              <span className="flex size-7 flex-none items-center justify-center rounded-full bg-primary text-[13px] font-bold text-white">{i + 1}</span>
              <div>
                <div className="text-[15px] font-semibold">{t}</div>
                <div className="mt-0.5 text-[13px] leading-[18px] text-slate-500">{d}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-start gap-2.5 rounded-card bg-[#FEF3C7] px-4 py-3 text-[13px] leading-[18px] text-[#92400E]">
          <ShieldCheck size={18} className="mt-px flex-none" />
          Never share your password. The coordinator will never ask for it — only your employee ID.
        </div>

        <div className="mt-auto grid gap-2.5 pt-8">
          <a href={telUrl(phone)} className="flex h-[52px] items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold text-white">
            <Phone size={18} /> Call Home Care · {phone}
          </a>
          <Link href="/m/login" className="flex h-[52px] items-center justify-center rounded-xl border-[1.5px] border-slate-300 text-base font-bold text-slate-700">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
