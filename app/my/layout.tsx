import { Noto_Sans_Bengali } from 'next/font/google'

// Bangla glyphs for the patient portal's বাংলা mode (same font as the public booking page)
const bn = Noto_Sans_Bengali({ subsets: ['bengali'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-bn' })

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return <div className={bn.variable}>{children}</div>
}
