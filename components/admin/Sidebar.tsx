'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Home, KanbanSquare, Users, UserRound, BarChart3, Mail, Bell, Settings, MoreVertical, LogOut, Smartphone, KeyRound, Menu, X } from 'lucide-react'
import { cx } from '@/lib/format'
import { api } from '@/components/client/api'

type NavUser = { name: string; initials: string; roleLabel: string; role: string }

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/requests', label: 'Requests', icon: KanbanSquare, countKey: 'open' },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/staff', label: 'Staff', icon: UserRound, roles: ['SUPER_ADMIN', 'HC_ADMIN'] },
  { href: '/reports', label: 'Reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'HC_ADMIN', 'VIEWER'] },
  { href: '/messages', label: 'Messages', icon: Mail, roles: ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'VIEWER'] },
  { href: '/notifications', label: 'Notifications', icon: Bell, countKey: 'unread' },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN', 'HC_ADMIN'] },
]

const SETTINGS_SUB = [
  { href: '/settings', label: 'General & integrations' },
  { href: '/settings/designations', label: 'Designations & departments' },
  { href: '/settings/services', label: 'Service types' },
  { href: '/settings/roles', label: 'Roles & permissions' },
  { href: '/settings/fleet', label: 'Fleet & drivers' },
  { href: '/settings/zones', label: 'Zones, slots & rules' },
  { href: '/settings/approvals', label: 'Approvals' },
  { href: '/settings/templates', label: 'Templates' },
  { href: '/settings/notifications', label: 'Notification rules' },
  { href: '/audit', label: 'Audit log' },
]

export function Sidebar({ user, counts }: { user: NavUser; counts: Record<string, number> }) {
  const path = usePathname()
  const [menu, setMenu] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const inSettings = path.startsWith('/settings') || path.startsWith('/audit')
  const active = (href: string) => (href === '/settings' ? inSettings : path === href || path.startsWith(href + '/'))

  const body = (
    <div className="flex h-full w-[264px] flex-none flex-col bg-navy px-4 py-5 text-white">
      <Link href="/dashboard" className="flex items-center gap-2.5 rounded-[10px] bg-white px-3.5 py-2.5">
        <img src="/logo.svg" alt="Unico Hospitals" className="block h-[34px]" />
      </Link>
      <div className="mx-3 mb-2 mt-[22px] text-[11px] font-bold uppercase tracking-[.1em] text-white/50">Home Care</div>
      <nav className="no-scrollbar flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV.filter((n) => !n.roles || n.roles.includes(user.role)).map((n) => {
          const on = active(n.href)
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
              {n.href === '/settings' && inSettings && (
                <div className="my-1 ml-[21px] flex flex-col gap-0.5 border-l border-white/15 pl-3">
                  {SETTINGS_SUB.filter((s) => user.role === 'SUPER_ADMIN' || !['/settings/roles', '/settings/designations'].includes(s.href)).map((s) => (
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
