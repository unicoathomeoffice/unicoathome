import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { ToastProvider } from '@/components/client/toast'
import './globals.css'

// Self-hosted (no build-time dependency on Google Fonts). Variable weight 100–1000.
const dmSans = localFont({ src: './fonts/dm-sans.woff2', variable: '--font-dm-sans', weight: '100 1000', display: 'swap' })

// Absolute base for Open Graph / canonical URLs (the preview card itself is app/opengraph-image.tsx)
const SITE = (process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/+$/, '')

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Unico HomeCare', template: '%s · Unico HomeCare' },
  description: 'Doctors, nurses, physiotherapy and lab tests at home in Dhaka — Unico Hospitals Family Medicine.',
  applicationName: 'Unico HomeCare',
  icons: { icon: '/logo.svg' },
  manifest: '/manifest.webmanifest',
  openGraph: { type: 'website', siteName: 'Unico HomeCare', locale: 'en_BD', alternateLocale: ['bn_BD'] },
  twitter: { card: 'summary_large_image' },
}

export const viewport: Viewport = { themeColor: '#0090CA', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
