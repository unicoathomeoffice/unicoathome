import { ChevronDown, CloudOff, MessageCircle, NotebookPen, Phone, UserPlus } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { FHeader } from '@/components/field'
import { coordinatorOnDuty } from '@/components/field/data'
import { requireAppUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { telUrl } from '@/components/ui'

export const metadata = { title: 'How to use' }

const STEPS = [
  ['Accept within 15 minutes', 'A new assignment arrives as a notification. Accept it, or decline with a reason if you can’t take it.'],
  ['Start journey when you leave', 'Tap Start journey on the visit. You can send the patient an “on the way” WhatsApp in one tap.'],
  ['Check-in at the door', 'Optional GPS. Late flag after +10 min — call the coordinator if you are delayed.'],
  ['Tick as you go', 'Each tick shows its time. Unticking asks for a reason. Add vitals, notes, medications and photos.'],
  ['Get confirmation', 'Signature on the phone, a 4-digit code sent to the patient’s WhatsApp, or “confirmed verbally”.'],
  ['Check-out & complete', 'Enter the bill and paid / due. The report is emailed to the department; send the patient a thank-you.'],
]

const GOOD = [
  { icon: CloudOff, t: 'Working offline', d: 'Ticks, vitals, notes, journey and check-in queue on your phone and sync later with their true time. A dark bar at the top shows what is pending.' },
  { icon: UserPlus, t: 'Anyone can create a request', d: 'Field staff requests go to the coordinator as NEW for confirmation. Use Request follow-up on a visit to fill in the patient for you.' },
  { icon: NotebookPen, t: 'Notes are shared with your team', d: 'Choose Coordinator only or Only me when needed. Never put lab values or prescriptions inside WhatsApp — send the report link.' },
]

const FAQ = [
  ['Why can’t I press Complete?', 'Complete unlocks only when every mandatory checklist item (marked *) is ticked. The check-out screen lists what is missing — tap an item to go straight to it.'],
  ['How do I change my availability?', 'On Home or Profile switch between On duty, Off duty and On leave. The coordinator only sees you as free for new visits when you are On duty.'],
  ['What if the patient has no phone for OTP?', 'Use the Signature tab (patient or relative signs on your screen), or Verbal as a last resort — it is logged with your name and the time.'],
  ['I can’t make a visit I accepted', 'Open the visit → ⋮ → Request reschedule / cancel / hand over. The coordinator approves it; the visit stays yours until then.'],
  ['I need money for consumables or a rickshaw', 'On the visit, Petty cash → Request. Enter the amount and purpose; the coordinator approves it before you spend.'],
  ['I forgot my password', 'The coordinator or IT resets it from Staff & users. You can change it yourself from Profile → Change password.'],
]

/** M23 Help & how to use */
export default async function Help() {
  await requireAppUser()
  const [coord, s] = await Promise.all([coordinatorOnDuty(), getSettings()])
  const wa = (p?: string) => `https://wa.me/${(p ?? '').replace(/\D/g, '').replace(/^0/, '880')}`
  return (
    <MScreen tab="profile" header={<FHeader back="/m/profile" title="How to use" sub="Unico HomeCare · v1.0" />}>
      <Col>
      <div className="rounded-2xl bg-slate-900 px-[18px] py-4 text-white">
        <div className="text-[12px] font-semibold uppercase tracking-[.08em] text-[#5EEAD4]">Your visit in 6 steps</div>
        <div className="mt-1.5 text-[20px] font-bold leading-[26px]">Accept → Start journey → Check-in → Checklist → Check-out → Complete</div>
        <div className="mt-2 text-[13px] leading-[19px] text-slate-300">Every tap stamps the time. Complete unlocks only when all mandatory checklist items are ticked.</div>
      </div>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
        {STEPS.map(([t, d], i) => (
          <div key={t} className="flex gap-3.5 px-4 py-3.5">
            <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-primary-50 text-[13px] font-bold text-primary-700">{i + 1}</span>
            <div>
              <div className="text-[15px] font-semibold">{t}</div>
              <div className="mt-0.5 text-[13px] leading-[18px] text-slate-500">{d}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Good to know</div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
        {GOOD.map((g) => (
          <div key={g.t} className="flex gap-3.5 px-4 py-3.5">
            <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-slate-100 text-slate-600">
              <g.icon size={18} />
            </span>
            <div>
              <div className="text-[15px] font-semibold">{g.t}</div>
              <div className="mt-0.5 text-[13px] leading-[18px] text-slate-500">{g.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Frequently asked</div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
              <span className="flex-1">{q}</span>
              <ChevronDown size={18} className="flex-none text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-3.5 text-[14px] leading-5 text-slate-600">{a}</div>
          </details>
        ))}
      </div>

      <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
        <div className="text-[15px] font-bold">Need help right now?</div>
        <div className="mt-0.5 text-[13px] text-slate-500">{coord ? `Coordinator on duty: ${coord.name}` : `Home Care desk · ${s.general.hospitalPhone}`}</div>
        <div className="mt-3 flex gap-2">
          <a href={telUrl(coord?.phone ?? s.general.hospitalPhone)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-bold text-white">
            <Phone size={18} /> Call
          </a>
          <a href={wa(coord?.whatsapp ?? s.general.hospitalPhone)} target="_blank" rel="noreferrer" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-slate-300 text-[15px] font-bold text-primary-700">
            <MessageCircle size={18} /> WhatsApp
          </a>
        </div>
      </div>
      </Col>
    </MScreen>
  )
}
