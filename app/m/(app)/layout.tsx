import { requireAppUser } from '@/lib/auth'

/** Field app frame: phone-width column centred on larger screens. */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  await requireAppUser()
  return (
    <div className="min-h-dvh bg-slate-200/60">
      <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-slate-100 shadow-[0_0_0_1px_rgba(15,23,42,.06)]">{children}</div>
    </div>
  )
}
