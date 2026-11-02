'use client'
// Instant feedback inside a <Link>: visible from the click until the next page starts rendering.
import { useLinkStatus } from 'next/link'
import { cx } from '@/lib/format'

/** A short primary bar along the top edge of the link (mobile tab bar, cards). */
export function LinkPendingBar({ className }: { className?: string }) {
  const { pending } = useLinkStatus()
  return <span aria-hidden className={cx('pointer-events-none absolute inset-x-3 top-0 h-[3px] rounded-full bg-primary transition-opacity', pending ? 'animate-pulse opacity-100' : 'opacity-0', className)} />
}
