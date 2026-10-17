// Presentation only: icon, colour tile and one-line subtitle for each public service card. Services themselves
// come from Settings → Services (ServiceType); anything without an entry here falls back to its category.
import { Accessibility, Activity, Bandage, BedDouble, Cross, Droplets, HeartPulse, PersonStanding, Pill, ShieldPlus, Stethoscope, Syringe, TestTubeDiagonal, Wind, type LucideIcon } from 'lucide-react'
import type { Lang } from './i18n'

type Tint = 'blue' | 'pink' | 'green' | 'purple' | 'orange' | 'teal' | 'red'
const TINT: Record<Tint, string> = {
  blue: 'bg-[#E6F3FB] text-[#0090CA]',
  pink: 'bg-[#FDE8F0] text-[#DB2777]',
  green: 'bg-[#E6F7EC] text-[#16A34A]',
  purple: 'bg-[#F1E9FD] text-[#7C3AED]',
  orange: 'bg-[#FFF1E6] text-[#EA580C]',
  teal: 'bg-[#E3F6F4] text-[#0F9488]',
  red: 'bg-[#FDECEC] text-[#DC2626]',
}

type Meta = { icon: LucideIcon; tint: Tint; sub: { en: string; bn: string } }
const BY_CODE: Record<string, Meta> = {
  DOCTOR_VISIT: { icon: Stethoscope, tint: 'blue', sub: { en: 'General physician visit at home', bn: 'বাসায় জেনারেল ফিজিশিয়ানের ভিজিট' } },
  NURSING: { icon: Cross, tint: 'pink', sub: { en: 'Professional nursing care', bn: 'পেশাদার নার্সিং সেবা' } },
  INJECTION_IV: { icon: Syringe, tint: 'green', sub: { en: 'Safe injection & IV at home', bn: 'বাসায় নিরাপদ ইনজেকশন ও আইভি' } },
  WOUND_DRESSING: { icon: Bandage, tint: 'purple', sub: { en: 'Wound care & dressing', bn: 'ক্ষতের যত্ন ও ড্রেসিং' } },
  SAMPLE_COLLECTION: { icon: TestTubeDiagonal, tint: 'pink', sub: { en: 'Lab samples picked up', bn: 'ল্যাব স্যাম্পল বাসা থেকে সংগ্রহ' } },
  PHYSIO: { icon: PersonStanding, tint: 'orange', sub: { en: 'Home physiotherapy care', bn: 'বাসায় ফিজিওথেরাপি' } },
  CATHETER_NG: { icon: Droplets, tint: 'purple', sub: { en: 'Catheter & NG tube care', bn: 'ক্যাথেটার ও এনজি টিউবের যত্ন' } },
  POST_OP: { icon: BedDouble, tint: 'blue', sub: { en: 'After surgery care at home', bn: 'অস্ত্রোপচার-পরবর্তী যত্ন বাসায়' } },
  PALLIATIVE: { icon: Accessibility, tint: 'blue', sub: { en: 'Elderly & palliative support', bn: 'বয়স্ক ও প্যালিয়েটিভ সহায়তা' } },
  VACCINATION: { icon: ShieldPlus, tint: 'teal', sub: { en: 'Home vaccination service', bn: 'বাসায় টিকাদান সেবা' } },
  HEALTH_CHECK: { icon: HeartPulse, tint: 'green', sub: { en: 'Basic & comprehensive check', bn: 'বেসিক ও পূর্ণাঙ্গ স্বাস্থ্য পরীক্ষা' } },
  OXYGEN_NEB: { icon: Wind, tint: 'purple', sub: { en: 'Oxygen & nebulisation at home', bn: 'বাসায় অক্সিজেন ও নেবুলাইজেশন' } },
  ECG_HOME: { icon: Activity, tint: 'red', sub: { en: 'ECG test at your home', bn: 'বাসায় ইসিজি পরীক্ষা' } },
  NG_TUBE_INSERT: { icon: Pill, tint: 'orange', sub: { en: 'NG tube insertion at home', bn: 'বাসায় এনজি টিউব স্থাপন' } },
}

const BY_CATEGORY: Record<string, { icon: LucideIcon; tint: Tint; sub: { en: string; bn: string } }> = {
  doctor: { icon: Stethoscope, tint: 'blue', sub: { en: 'Doctor visit at home', bn: 'বাসায় ডাক্তারের ভিজিট' } },
  nursing: { icon: Cross, tint: 'pink', sub: { en: 'Nursing care at home', bn: 'বাসায় নার্সিং সেবা' } },
  lab: { icon: TestTubeDiagonal, tint: 'pink', sub: { en: 'Lab service at home', bn: 'বাসায় ল্যাব সেবা' } },
  physio: { icon: PersonStanding, tint: 'orange', sub: { en: 'Physiotherapy at home', bn: 'বাসায় ফিজিওথেরাপি' } },
}
const FALLBACK = { icon: HeartPulse, tint: 'teal' as Tint, sub: { en: 'Home care service', bn: 'হোম কেয়ার সেবা' } }

export function serviceMeta(s: { code: string; category?: string }, lang: Lang): { icon: LucideIcon; tile: string; sub: string } {
  const m = BY_CODE[s.code] ?? BY_CATEGORY[(s.category ?? '').toLowerCase()] ?? FALLBACK
  return { icon: m.icon, tile: TINT[m.tint], sub: m.sub[lang] }
}
