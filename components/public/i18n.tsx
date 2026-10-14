'use client'
// English / বাংলা for the public patient pages only (the staff app stays English). Choice is remembered per browser.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'bn'

const en = {
  call: 'Call',
  staffSignIn: 'Staff sign in',
  openDashboard: 'Open dashboard',
  heroTitle: 'Home care at your door',
  heroText: (h: string) => `Doctors, nurses, physiotherapy and lab sample collection at home in Dhaka, from ${h}. Send the form and our coordinator will call you to confirm the visit.`,
  sPatient: 'Patient',
  sAddress: 'Address',
  sService: 'Service needed',
  sWhen: 'Preferred day & time',
  sMore: 'Anything else? (optional)',
  name: 'Patient name',
  namePh: 'Full name',
  phone: 'Mobile number',
  age: 'Age',
  agePh: 'Years',
  gender: 'Gender',
  male: 'Male',
  female: 'Female',
  other: 'Other',
  email: 'Email (optional)',
  emailHint: 'We’ll email you a copy',
  useLocation: 'Use my current location',
  autoTag: 'Auto-filled',
  locating: 'Finding your location…',
  located: 'Location added — tap to update',
  road: 'Road, block & area',
  roadHint: 'Start typing to pick from the map',
  roadPh: 'e.g. Road 11, Block C, Banani',
  house: 'House / holding no.',
  housePh: 'e.g. 24/B',
  flat: 'Flat / floor',
  flatPh: 'e.g. 5A, 5th floor',
  area: 'Area / thana (optional)',
  areaPh: 'e.g. Dhanmondi',
  landmark: 'Nearby landmark (optional)',
  landmarkPh: 'Near…',
  onMap: 'Your home on the map',
  mapHint: 'Drag the pin or tap the map so our team finds the exact door.',
  pinTap: 'Tap the map to drop a pin',
  pinNone: 'No pin yet',
  pinSet: 'Pinned',
  myLocation: 'My location',
  clearPin: 'Clear pin',
  today: 'Today',
  tomorrow: 'Tomorrow',
  full: 'Full',
  closed: 'Closed',
  booked: 'Booked',
  unavailable: 'Not available',
  noSlots: 'No free times on this day — please choose another day.',
  confirmByPhone: 'The coordinator will confirm the exact time with you by phone.',
  notesPh: 'Symptoms, medicines, tests needed, who to ask for, best time to call…',
  consent1: 'By sending, you agree that Unico Hospitals may call, WhatsApp or email you about this request. See our',
  privacy: 'privacy policy',
  consent2: 'For emergencies call 999 or come to the hospital.',
  send: 'Send request',
  sending: 'Sending…',
  sent: 'Request sent',
  yourNo: 'Your request number',
  willCall: (phone: string, min: number, hours: string) => `Our Home Care coordinator will call you on ${phone} within about ${min} minutes during working hours (${hours}) to confirm the visit.`,
  emailed: 'A copy has been emailed to you.',
  another: 'Book another visit',
  terms: 'Terms',
  join: 'Join our team',
  callUs: (p: string) => `Call us on ${p} to book.`,
  eName: 'Enter the patient’s name',
  ePhone: 'Enter a valid mobile number (01XXXXXXXXX)',
  eAge: 'Enter the age',
  eGender: 'Choose one',
  eEmail: 'Check the email, or leave it empty',
  eRequired: 'Required',
  eRoad: 'Enter road, block and area — or use your location',
  eService: 'Choose at least one service',
  eSlot: 'Choose a time',
  eTaken: 'That time was just booked. Please choose another slot.',
  eLocBlocked: 'Location permission was blocked — allow it, or type the address',
  eLocFail: 'Could not get your location — type the address instead',
  eLocNone: 'This phone does not share its location — type the address instead',
}

const bn: typeof en = {
  call: 'কল করুন',
  staffSignIn: 'স্টাফ লগইন',
  openDashboard: 'ড্যাশবোর্ড',
  heroTitle: 'আপনার দোরগোড়ায় হোম কেয়ার',
  heroText: (h) => `ঢাকায় বাসায় বসেই ডাক্তার, নার্স, ফিজিওথেরাপি ও ল্যাব স্যাম্পল কালেকশন সেবা — ${h}। ফর্মটি পাঠান, আমাদের কো-অর্ডিনেটর ফোন করে ভিজিট নিশ্চিত করবেন।`,
  sPatient: 'রোগীর তথ্য',
  sAddress: 'ঠিকানা',
  sService: 'কোন সেবা প্রয়োজন',
  sWhen: 'পছন্দের দিন ও সময়',
  sMore: 'আর কিছু জানাতে চান? (ঐচ্ছিক)',
  name: 'রোগীর নাম',
  namePh: 'পূর্ণ নাম',
  phone: 'মোবাইল নম্বর',
  age: 'বয়স',
  agePh: 'বছর',
  gender: 'লিঙ্গ',
  male: 'পুরুষ',
  female: 'মহিলা',
  other: 'অন্যান্য',
  email: 'ইমেইল (ঐচ্ছিক)',
  emailHint: 'আপনাকে একটি কপি ইমেইল করা হবে',
  useLocation: 'আমার বর্তমান লোকেশন ব্যবহার করুন',
  autoTag: 'স্বয়ংক্রিয়ভাবে পূরণ',
  locating: 'লোকেশন খোঁজা হচ্ছে…',
  located: 'লোকেশন যুক্ত হয়েছে — আপডেট করতে চাপুন',
  road: 'রোড, ব্লক ও এলাকা',
  roadHint: 'টাইপ করা শুরু করুন, ম্যাপ থেকে বেছে নিন',
  roadPh: 'যেমন: রোড ১১, ব্লক সি, বনানী',
  house: 'বাড়ি / হোল্ডিং নম্বর',
  housePh: 'যেমন: ২৪/বি',
  flat: 'ফ্ল্যাট / তলা',
  flatPh: 'যেমন: ৫এ, ৫ম তলা',
  area: 'এলাকা / থানা (ঐচ্ছিক)',
  areaPh: 'যেমন: ধানমন্ডি',
  landmark: 'কাছাকাছি পরিচিত স্থান (ঐচ্ছিক)',
  landmarkPh: 'যেমন: … এর কাছে',
  onMap: 'ম্যাপে আপনার বাসা',
  mapHint: 'পিনটি টেনে সরান বা ম্যাপে চাপ দিন, যাতে আমাদের টিম সঠিক বাসা খুঁজে পায়।',
  pinTap: 'পিন বসাতে ম্যাপে চাপ দিন',
  pinNone: 'এখনও পিন দেওয়া হয়নি',
  pinSet: 'পিন দেওয়া হয়েছে',
  myLocation: 'আমার লোকেশন',
  clearPin: 'পিন মুছুন',
  today: 'আজ',
  tomorrow: 'আগামীকাল',
  full: 'পূর্ণ',
  closed: 'বন্ধ',
  booked: 'বুকড',
  unavailable: 'খালি নেই',
  noSlots: 'এই দিনে কোনো সময় খালি নেই — অন্য একটি দিন বেছে নিন।',
  confirmByPhone: 'কো-অর্ডিনেটর ফোনে সঠিক সময় নিশ্চিত করবেন।',
  notesPh: 'উপসর্গ, ওষুধ, প্রয়োজনীয় টেস্ট, কার সাথে কথা বলতে হবে, কখন ফোন করা সুবিধা…',
  consent1: 'পাঠানোর মাধ্যমে আপনি সম্মতি দিচ্ছেন যে এই অনুরোধের বিষয়ে ইউনিকো হসপিটালস আপনাকে ফোন, হোয়াটসঅ্যাপ বা ইমেইল করতে পারবে। দেখুন আমাদের',
  privacy: 'গোপনীয়তা নীতি',
  consent2: 'জরুরি প্রয়োজনে ৯৯৯-এ কল করুন অথবা হাসপাতালে আসুন।',
  send: 'অনুরোধ পাঠান',
  sending: 'পাঠানো হচ্ছে…',
  sent: 'অনুরোধ পাঠানো হয়েছে',
  yourNo: 'আপনার অনুরোধ নম্বর',
  willCall: (phone, min, hours) => `কর্মঘণ্টায় (${hours}) প্রায় ${min} মিনিটের মধ্যে আমাদের হোম কেয়ার কো-অর্ডিনেটর ${phone} নম্বরে ফোন করে ভিজিট নিশ্চিত করবেন।`,
  emailed: 'আপনাকে একটি কপি ইমেইল করা হয়েছে।',
  another: 'আরেকটি ভিজিট বুক করুন',
  terms: 'শর্তাবলি',
  join: 'আমাদের টিমে যোগ দিন',
  callUs: (p) => `বুক করতে ${p} নম্বরে কল করুন।`,
  eName: 'রোগীর নাম লিখুন',
  ePhone: 'সঠিক মোবাইল নম্বর লিখুন (01XXXXXXXXX)',
  eAge: 'বয়স লিখুন',
  eGender: 'একটি বেছে নিন',
  eEmail: 'ইমেইলটি ঠিক আছে কিনা দেখুন, না থাকলে খালি রাখুন',
  eRequired: 'আবশ্যক',
  eRoad: 'রোড, ব্লক ও এলাকা লিখুন — অথবা লোকেশন ব্যবহার করুন',
  eService: 'অন্তত একটি সেবা বেছে নিন',
  eSlot: 'একটি সময় বেছে নিন',
  eTaken: 'এই সময়টি এইমাত্র বুক হয়ে গেছে। অন্য একটি সময় বেছে নিন।',
  eLocBlocked: 'লোকেশনের অনুমতি বন্ধ — অনুমতি দিন অথবা ঠিকানা টাইপ করুন',
  eLocFail: 'লোকেশন পাওয়া যায়নি — ঠিকানা টাইপ করুন',
  eLocNone: 'এই ফোন লোকেশন শেয়ার করে না — ঠিকানা টাইপ করুন',
}

export type Dict = typeof en
const DICT: Record<Lang, Dict> = { en, bn }
const Ctx = createContext<{ lang: Lang; t: Dict; setLang: (l: Lang) => void }>({ lang: 'en', t: en, setLang: () => {} })

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')
  useEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem('hc:lang')
    } catch {}
    setLangState(saved === 'bn' || saved === 'en' ? saved : navigator.language?.toLowerCase().startsWith('bn') ? 'bn' : 'en')
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem('hc:lang', l)
    } catch {}
  }
  return <Ctx.Provider value={{ lang, t: DICT[lang], setLang }}>{children}</Ctx.Provider>
}

export const useLang = () => useContext(Ctx)

/** EN | বাংলা switch for the header. */
export function LangSwitch() {
  const { lang, setLang } = useLang()
  return (
    <div className="flex h-10 items-center rounded-full bg-slate-100 p-1 text-[13px] font-semibold" role="group" aria-label="Language">
      {(['en', 'bn'] as const).map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`h-8 rounded-full px-3 ${lang === l ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
          {l === 'en' ? 'EN' : 'বাংলা'}
        </button>
      ))}
    </div>
  )
}
