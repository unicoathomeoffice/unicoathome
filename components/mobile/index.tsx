import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronLeft, Home, ClipboardList, LayoutGrid, Bell, UserRound, Car, Truck } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { Notification } from '@/lib/models'
import { UnreadBadge } from '@/components/client'
import { cx } from '@/lib/format'
import { mapsUrl, telUrl } from '@/components/ui'
import { Phone, MapPin } from 'lucide-react'

type TabKey = 'home' | 'visits' | 'admin' | 'notifications' | 'profile' | 'trips' | 'fleet' | 'vehicle'

export function tabsFor(role: string): { key: TabKey; label: string; href: string; icon: any }[] {
  const common = [
    { key: 'notifications' as const, label: 'Notifications', href: '/m/notifications', icon: Bell },
    { key: 'profile' as const, label: 'Profile', href: '/m/profile', icon: UserRound },
  ]
  if (role === 'DRIVER') return [{ key: 'trips', label: 'Trips', href: '/m/trips', icon: Truck }, { key: 'vehicle', label: 'Vehicle', href: '/m/vehicle', icon: Car }, ...common]
  if (role === 'TRANSPORT_SUPERVISOR') return [{ key: 'trips', label: 'Trips', href: '/m/trips', icon: Truck }, { key: 'fleet', label: 'Fleet', href: '/m/fleet', icon: Car }, ...common]
  const base = [
    { key: 'home' as const, label: 'Home', href: '/m', icon: Home },
    { key: 'visits' as const, label: 'Visits', href: '/m/visits', icon: ClipboardList },
  ]
  if (['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK'].includes(role)) base.push({ key: 'admin' as any, label: 'Admin', href: '/m/admin', icon: LayoutGrid })
  return [...base, ...common]
}

async function TabBar({ active }: { active: TabKey }) {
  const user = (await getUser())!
  const unread = await Notification.countDocuments({ userId: user.id, readAt: null })
  return (
    <nav className="sticky bottom-0 z-20 flex border-t border-slate-200 bg-white px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
      {tabsFor(user.role).map((t) => (
        <Link key={t.key} href={t.href} className={cx('relative flex flex-1 flex-col items-center gap-[3px] text-[11px]', t.key === active ? 'font-semibold text-primary' : 'font-medium text-slate-500')}>
          <t.icon size={24} strokeWidth={t.key === active ? 2.2 : 2} />
          {t.label}
          {t.key === 'notifications' && <UnreadBadge initial={unread} className="absolute -top-0.5 left-[calc(50%+4px)]" />}
        </Link>
      ))}
    </nav>
  )
}

/**
 * One mobile screen (390-wide design): optional top bar, scrolling body, optional sticky bottom
 * action bar and/or tab bar. Use inside app/m/(app)/.
 */
export async function MScreen({
  title,
  sub,
  back,
  right,
  header,
  children,
  bottom,
  bottomNote,
  tab,
  bg = 'bg-slate-100',
  pad = true,
  headerClass,
}: {
  title?: ReactNode
  sub?: ReactNode
  back?: string
  right?: ReactNode
  /** replaces the default top bar entirely */
  header?: ReactNode
  children: ReactNode
  bottom?: ReactNode
  bottomNote?: ReactNode
  tab?: TabKey
  bg?: string
  pad?: boolean
  headerClass?: string
}) {
  return (
    <div className={cx('flex min-h-dvh flex-col', bg)}>
      {header ??
        (title != null && (
          <header className={cx('sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]', headerClass)}>
            {back ? (
              <Link href={back} className="flex size-10 items-center justify-center text-slate-700" aria-label="Back">
                <ChevronLeft size={22} />
              </Link>
            ) : (
              <div className="w-2" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-bold">{title}</div>
              {sub && <div className="truncate text-[13px] text-slate-500">{sub}</div>}
            </div>
            {right}
          </header>
        ))}
      <main className={cx('grid flex-1 auto-rows-max content-start gap-3', pad && 'px-5 py-4')}>{children}</main>
      {bottom && (
        <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          {bottomNote && <div className="mb-2 text-center text-[12px] font-semibold text-[#B45309]">{bottomNote}</div>}
          <div className="flex gap-2.5">{bottom}</div>
        </div>
      )}
      {tab && <TabBar active={tab} />}
    </div>
  )
}

/** White rounded card (design `card`) */
export function MCard({ children, className, pad = 'px-4 py-3.5' }: { children: ReactNode; className?: string; pad?: string }) {
  return <div className={cx('rounded-card bg-white shadow-card', pad, className)}>{children}</div>
}

/** Stacked rows inside one card (design `listcard`) */
export function MList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card', className)}>{children}</div>
}
export function MRow({ children, href, className }: { children: ReactNode; href?: string; className?: string }) {
  const cls = cx('flex items-center gap-3 px-4 py-3.5', href && 'active:bg-slate-50', className)
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  )
}

/** Call · WhatsApp · Map (design `contact`). WhatsApp is a link to a prefilled chat; for templated + logged sends use <WhatsAppButton>. */
export function ContactBar({ phone, address, lat, lng, whatsappHref, soft }: { phone?: string; address?: string; lat?: number; lng?: number; whatsappHref?: string; soft?: boolean }) {
  const cls = cx('flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-sm font-semibold text-primary-700', soft ? 'bg-slate-100' : 'border-[1.5px] border-slate-300 bg-white')
  return (
    <div className="flex gap-2">
      <a href={telUrl(phone)} className={cls}>
        <Phone size={18} /> Call
      </a>
      <a href={whatsappHref ?? `https://wa.me/${(phone ?? '').replace(/\D/g, '').replace(/^0/, '880')}`} target="_blank" rel="noreferrer" className={cls}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
        WhatsApp
      </a>
      <a href={mapsUrl(address, lat, lng)} target="_blank" rel="noreferrer" className={cls}>
        <MapPin size={18} /> Map
      </a>
    </div>
  )
}

export function MSection({ title, right, children }: { title: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-1 flex items-center justify-between">
      <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">{title}</div>
      {right}
      {children}
    </div>
  )
}
