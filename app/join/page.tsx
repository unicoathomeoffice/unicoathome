import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react'
import { GoogleButton } from '@/components/GoogleButton'

export const metadata: Metadata = { title: 'Join the Home Care team' }

/** Staff sign-up link (share it with new staff): Google sign-up → details form → admin approval. */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string }> }) {
  const sp = await searchParams
  return (
    <div className="min-h-dvh bg-page px-4 py-8">
      <div className="mx-auto max-w-[460px]">
        <img src="/logo.svg" alt="Unico Hospitals" className="h-10" />
        <div className="mt-6 rounded-card bg-white p-6 shadow-card">
          {sp.status === 'pending' || sp.status === 'sent' ? (
            <div className="text-center">
              <Clock size={48} className="mx-auto text-[#D97706]" />
              <h1 className="mt-3 text-[22px] font-bold">{sp.status === 'sent' ? 'Registration sent' : 'Waiting for approval'}</h1>
              <p className="mt-2 text-[15px] leading-[23px] text-slate-600">
                An administrator will review your details and approve your account. You’ll get an email when it’s ready — then sign in with the same Google account.
              </p>
              <Link href="/login" className="mt-5 inline-block text-[14.5px] font-semibold text-primary-700">
                Go to sign in →
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-[24px] font-bold leading-tight text-navy">Join the Home Care team</h1>
              <p className="mt-2 text-[15px] leading-[23px] text-slate-600">For Unico Hospitals staff — doctors, nurses, allied health, front desk and drivers. Register with your Google account; an administrator approves it before you can sign in.</p>
              {sp.error && (
                <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-[#FEE2E2] px-3.5 py-3 text-[14px] text-[#B91C1C]">
                  <AlertTriangle size={18} className="mt-px flex-none" /> {sp.error}
                </div>
              )}
              <div className="mt-5">
                <GoogleButton intent="register" big />
              </div>
              <ol className="mt-5 space-y-2 text-[14px] text-slate-600">
                <li className="flex gap-2.5"><Step n={1} /> Continue with your Google account</li>
                <li className="flex gap-2.5"><Step n={2} /> Add your phone, employee ID and role</li>
                <li className="flex gap-2.5"><Step n={3} /> Wait for approval — we email you</li>
              </ol>
              <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-[12.5px] text-slate-500">
                <ShieldCheck size={16} className="flex-none text-[#16A34A]" /> We only read your name, email and photo from Google.
              </div>
            </>
          )}
        </div>
        <div className="mt-4 text-center text-[14px] text-slate-500">
          Already approved?{' '}
          <Link href="/login" className="font-semibold text-primary-700">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

const Step = ({ n }: { n: number }) => <span className="flex size-6 flex-none items-center justify-center rounded-full bg-primary-50 text-[12px] font-bold text-primary-700">{n}</span>
