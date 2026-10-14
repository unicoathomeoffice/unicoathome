import Link from 'next/link'
import type { ReactNode } from 'react'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'

/** Public, signed-out page shell for /privacy and /terms (linked from the Google OAuth consent screen). */
export async function LegalPage({ title, updated, children }: { title: string; updated: string; children: (g: { name: string; dept: string; phone: string; address: string }) => ReactNode }) {
  await db()
  const { general } = await getSettings()
  const g = { name: general.hospitalName, dept: general.department, phone: general.hospitalPhone, address: general.address }
  return (
    <div className="min-h-dvh bg-page px-4 py-10">
      <article className="mx-auto max-w-[760px] rounded-card bg-white p-6 shadow-card sm:p-10 [&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:text-[17px] [&_h2]:font-bold [&_li]:mt-1 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        <img src="/logo.svg" alt={g.name} className="h-11" />
        <h1 className="mt-6 text-[26px] font-bold leading-tight">{title}</h1>
        <div className="mt-1 text-[13px] text-slate-500">
          Unico HomeCare · {g.name} · Last updated {updated}
        </div>
        <div className="mt-4 text-[14.5px] leading-[23px] text-slate-700">{children(g)}</div>
        <div className="mt-10 flex flex-wrap gap-4 border-t border-slate-100 pt-4 text-[13px] text-slate-500">
          <Link href="/privacy" className="hover:text-primary-700">Privacy policy</Link>
          <Link href="/terms" className="hover:text-primary-700">Terms of use</Link>
          <Link href="/login" className="hover:text-primary-700">Staff sign in</Link>
        </div>
      </article>
    </div>
  )
}
