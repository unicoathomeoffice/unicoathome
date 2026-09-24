import Link from 'next/link'
import type { ReactNode } from 'react'
import { Bell, Plus, Search } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { Notification } from '@/lib/models'
import { can } from '@/lib/constants'
import { UnreadBadge } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

/**
 * Web admin page frame: 64px top bar (title, crumbs, global search, + New request, bell, avatar)
 * followed by the scrolling content area (padding 24px 32px). Use inside app/(admin)/.
 */
export async function AdminPage({
  title,
  crumbs,
  actions,
  children,
  pad = true,
  className,
}: {
  title: ReactNode
  crumbs?: ReactNode
  actions?: ReactNode
  children: ReactNode
  pad?: boolean
  className?: string
}) {
  const user = (await getUser())!
  const unread = await Notification.countDocuments({ userId: user.id, readAt: null })
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-16 flex-none items-center gap-4 border-b border-slate-200 bg-white pl-16 pr-4 lg:px-8">
        <div className="min-w-0 flex-1">
          {crumbs && <div className="truncate text-[12px] text-slate-500">{crumbs}</div>}
          <h1 className="truncate text-xl font-bold tracking-[-.01em]">{title}</h1>
        </div>
        {actions}
        <form action="/search" className="hidden h-10 w-[360px] items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm focus-within:border-primary xl:flex">
          <Search size={18} className="text-slate-500" />
          <input name="q" placeholder="Search phone, UHID or request no" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" />
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] text-slate-500">⏎</kbd>
        </form>
        <Link href="/search" className="flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 xl:hidden" aria-label="Search">
          <Search size={18} />
        </Link>
        {can(user.role, 'requests.create') && (
          <Link href="/requests/new" className={btnClass('p', 'md', 'hidden sm:inline-flex')}>
            <Plus size={16} /> New request
          </Link>
        )}
        <Link href="/notifications" className="relative flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700" aria-label="Notifications">
          <Bell size={18} />
          <UnreadBadge initial={unread} className="absolute -right-1.5 -top-1.5" />
        </Link>
        <Link href="/account" className="hidden size-10 flex-none items-center justify-center rounded-full bg-teal text-[13px] font-bold text-white sm:flex" title={user.name}>
          {user.initials}
        </Link>
      </header>
      <main className={cx('min-h-0 flex-1 overflow-y-auto', pad && 'px-4 py-6 lg:px-8', className)}>{children}</main>
    </div>
  )
}
