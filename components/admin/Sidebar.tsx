'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Home, KanbanSquare, Users, UserRound, BarChart3, Mail, Bell, Settings, MoreVertical, LogOut, Smartphone, KeyRound, Menu, X } from 'lucide-react'
import { cx } from '@/lib/format'
import { api } from '@/components/client/api'
import type { Permission } from '@/lib/constants'

/** perms: what the signed-in user holds (custom role included) — computed on the server with permissionsFor() */
type NavUser = { name: string; initials: string; roleLabel: string; perms: Permission[] }

type Perm = Permission | ((perms: Permission[]) => boolean)

const NAV: { href: string; label: string; icon: any; countKey?: string; perm?: Perm }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/requests', label: 'Requests', icon: KanbanSquare, countKey: 'open', perm: 'requests.readAll' },
  { href: '/patients', label: 'Patients', icon: Users, perm: 'requests.readAll' },
  { href: '/staff', label: 'Staff', icon: UserRound, perm: 'users.read' },
  { href: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' },
  { href: '/messages', label: 'Messages', icon: Mail, perm: (p) => p.includes('requests.readAll') && (p.includes('messages.send') || p.includes('reports.view')) },
  { href: '/notifications', label: 'Notifications', icon: Bell, countKey: 'unread' },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const SETTINGS_HUB: Perm = (p) => p.includes('settings.manage') || p.includes('templates.manage')
const SETTINGS_SUB: { href: string; label: string; perm: Perm }[] = [
  { href: '/settings', label: 'General & integrations', perm: SETTINGS_HUB },
  { href: '/settings/designations', label: 'Designations & departments', perm: 'master.manage' },
  { href: '/settings/services', label: 'Service types', perm: 'requests.manage' },
  { href: '/settings/roles', label: 'Roles & permissions', perm: 'users.manage' },
  { href: '/settings/fleet', label: 'Fleet & drivers', perm: 'transport.manage' },
  { href: '/settings/zones', label: 'Zones, slots & rules', perm: 'requests.manage' },
  { href: '/settings/booking', label: 'Online booking', perm: 'requests.manage' },
  { href: '/settings/approvals', label: 'Approvals', perm: 'approvals.decide' },
  { href: '/settings/templates', label: 'Templates', perm: 'templates.manage' },
  { href: '/settings/notifications', label: 'Notification rules', perm: SETTINGS_HUB },
  { href: '/settings/maps', label: 'Maps & API usage', perm: SETTINGS_HUB },
  { href: '/audit', label: 'Audit log', perm: 'audit.view' },
]

export function Sidebar({ user, counts }: { user: NavUser; counts: Record<string, number> }) {
  const path = usePathname()
  const [menu, setMenu] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const inSettings = path.startsWith('/settings') || path.startsWith('/audit')
  const active = (href: string) => (href === '/settings' ? inSettings : path === href || path.startsWith(href + '/'))
  const allowed = (perm?: Perm) => !perm || (typeof perm === 'function' ? perm(user.perms) : user.perms.includes(perm))
  const settingsSub = SETTINGS_SUB.filter((s) => allowed(s.perm))
  // Settings shows when any settings page is open to the user; it links to the first one they can use
  const nav = NAV.filter((n) => (n.href === '/settings' ? settingsSub.length > 0 : allowed(n.perm))).map((n) => (n.href === '/settings' ? { ...n, href: settingsSub[0].href } : n))

  const body = (
    <div className="flex h-full w-[264px] flex-none flex-col bg-navy px-4 py-5 text-white">
      <Link href="/dashboard" className="flex items-center gap-2.5 rounded-[10px] bg-white px-3.5 py-2.5">
        <img src="/logo.svg" alt="Unico Hospitals" className="block h-[34px]" />
      </Link>
      <div className="mx-3 mb-2 mt-[22px] text-[11px] font-bold uppercase tracking-[.1em] text-white/50">Home Care</div>
      <nav className="no-scrollbar flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {nav.map((n) => {
          const on = n.label === 'Settings' ? inSettings : active(n.href)
          const count = n.countKey ? counts[n.countKey] : 0
          return (
            <div key={n.href}>
              <Link
                href={n.href}
                onClick={() => setMobileOpen(false)}
                className={cx('flex h-10 items-center gap-3 rounded-lg px-3 text-sm', on ? 'bg-white/[.12] font-semibold text-white' : 'font-medium text-white/75 hover:bg-white/[.06] hover:text-white')}
              >
                <n.icon size={18} />
                <span className="flex-1">{n.label}</span>
                {count > 0 &&
                  (n.countKey === 'unread' ? (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DC2626] px-1.5 text-[11px] font-bold">{count}</span>
                  ) : (
                    <span className="text-[12px] text-white/60">{count}</span>
                  ))}
              </Link>
              {n.label === 'Settings' && inSettings && (
                <div className="my-1 ml-[21px] flex flex-col gap-0.5 border-l border-white/15 pl-3">
                  {settingsSub.map((s) => (
                    <Link
                      key={s.href}
                      href={s.href}
                      onClick={() => setMobileOpen(false)}
                      className={cx('rounded-md px-2.5 py-1.5 text-[13px]', path === s.href ? 'bg-white/[.12] font-semibold text-white' : 'text-white/65 hover:text-white')}
                    >
                      {s.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="relative mt-3">
        <button onClick={() => setMenu((m) => !m)} className="flex w-full items-center gap-2.5 rounded-[10px] bg-white/[.08] px-3 py-2.5 text-left">
          <div className="flex size-9 flex-none items-center justify-center rounded-full bg-teal text-[13px] font-bold">{user.initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{user.name}</div>
            <div className="truncate text-[11.5px] text-white/60">{user.roleLabel}</div>
          </div>
          <MoreVertical size={16} className="text-white/60" />
        </button>
        {menu && (
          <div className="absolute bottom-[calc(100%+6px)] left-0 right-0 overflow-hidden rounded-xl bg-white py-1 text-sm text-slate-700 shadow-xl">
            <Link href="/m" className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-50">
              <Smartphone size={16} /> Open field app
            </Link>
            <Link href="/account" className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-50">
              <KeyRound size={16} /> Account & password
            </Link>
            <button
              onClick={async () => {
                await api('/auth/logout', { body: {} }).catch(() => {})
                window.location.href = '/login'
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[#B91C1C] hover:bg-slate-50"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div className="hidden h-dvh lg:block">{body}</div>
      <button onClick={() => setMobileOpen(true)} className="fixed left-3 top-3 z-40 flex size-10 items-center justify-center rounded-lg bg-navy text-white shadow lg:hidden" aria-label="Menu">
        <Menu size={20} />
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="h-full">{body}</div>
          <button className="flex-1 bg-slate-900/40" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="ml-3 mt-3 text-white" />
          </button>
        </div>
      )}
    </>
  )
}
