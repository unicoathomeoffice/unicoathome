import type { Metadata } from 'next'
import { Star } from 'lucide-react'
import { db } from '@/lib/db'
import { HomecareRequest, isOid } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { FeedbackForm } from '@/components/comms/FeedbackForm'
import { date as fmtDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Your feedback', robots: { index: false, follow: false } }

/** Public patient feedback page (link in the "visit completed" message). Shows no clinical data. */
export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db()
  const [r, s] = await Promise.all([
    isOid(id) ? HomecareRequest.findOne({ _id: id, deletedAt: null }).select('status patientSnapshot.name scheduledAt timeline.checkInAt timeline.completedAt feedback').lean<any>() : null,
    getSettings(),
  ])
  const first = (r?.patientSnapshot?.name ?? '')
    .replace(/^(Mr\.?|Mrs\.?|Ms\.?|Md\.?|Mst\.?|Dr\.?)\s+/i, '')
    .split(/\s+/)[0]
  const visitDate = r?.timeline?.checkInAt ?? r?.timeline?.completedAt ?? r?.scheduledAt

  let body: React.ReactNode
  if (!r) body = <Notice title="Link not found" text="This feedback link is not valid. Please check the message you received." />
  else if (r.feedback?.rating)
    body = (
      <div className="py-4 text-center">
        <div className="flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={30} className={n <= r.feedback.rating ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-slate-300'} />
          ))}
        </div>
        <div className="mt-3 text-[19px] font-bold">Thank you{first ? `, ${first}` : ''}!</div>
        <div className="mt-1 text-[15px] text-slate-600">We have already received your feedback for this visit.</div>
      </div>
    )
  else if (!['COMPLETED', 'CLOSED'].includes(r.status)) body = <Notice title="Not ready yet" text="Feedback opens once your home care visit is complete." />
  else body = <FeedbackForm requestId={id} />
  const asking = !!r && !r.feedback?.rating && ['COMPLETED', 'CLOSED'].includes(r.status)

  return (
    <div className="min-h-dvh bg-page px-4 py-8">
      <div className="mx-auto w-full max-w-[440px]">
        <div className="rounded-2xl bg-white shadow-card">
          <div className="border-b-[3px] border-primary px-6 py-4">
            <img src="/logo.svg" alt="Unico Hospitals" className="h-9" />
          </div>
          <div className="px-6 pb-7 pt-5">
            <div className="text-[12px] font-semibold uppercase tracking-[.08em] text-slate-500">Home care · feedback</div>
            {asking && (
              <h1 className="mt-1 text-[22px] font-bold leading-tight">
                {first ? `Dear ${first},` : 'Hello,'}
                <br />
                <span className="text-[17px] font-semibold text-slate-600">how was your home care visit{visitDate ? ` on ${fmtDate(visitDate)}` : ''}?</span>
              </h1>
            )}
            <div className="mt-5">{body}</div>
          </div>
        </div>
        <div className="mt-4 text-center text-[12.5px] leading-5 text-slate-500">
          {s.general.hospitalName} · {s.general.department}
          <br />
          Need help? Call {s.general.hospitalPhone}
        </div>
      </div>
    </div>
  )
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-5 text-center">
      <div className="text-[17px] font-bold">{title}</div>
      <div className="mt-1 text-[15px] text-slate-600">{text}</div>
    </div>
  )
}
