import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { ToastProvider } from '@/components/client/toast'
import './globals.css'

// Self-hosted (no build-time dependency on Google Fonts). Variable weight 100–1000.
const dmSans = localFont({ src: './fonts/dm-sans.woff2', variable: '--font-dm-sans', weight: '100 1000', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Unico HomeCare', template: '%s · Unico HomeCare' },
  description: 'Unico Hospitals · Family Medicine · Home Care Module',
  icons: { icon: '/logo.svg' },
  manifest: '/manifest.webmanifest',
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
