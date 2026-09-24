import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cx } from '@/lib/format'
import { SyncBanner, LiveElapsed } from './live'

/** Sticky screen header usable from client screens (back · title/sub · right · optional content below) */
export function CHeader({ title, sub, back, right, below }: { title: ReactNode; sub?: ReactNode; back?: string; right?: ReactNode; below?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20">
      <SyncBanner />
      <header className="border-b border-slate-200 bg-white px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          {back ? (
            <Link href={back} className="flex size-10 flex-none items-center justify-center text-slate-700" aria-label="Back">
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
        </div>
        {below}
      </header>
    </div>
  )
}

/** Amber pulsing elapsed pill (M08-e / M09 header) */
export function TimerPill({ from }: { from?: string | null }) {
  if (!from) return null
  return (
    <span className="inline-flex h-7 flex-none items-center gap-1.5 rounded-full bg-[#FEF3C7] px-2.5 text-[13px] font-bold text-[#B45309]">
      <span className="size-[7px] animate-hcpulse rounded-full bg-[#F59E0B]" />
      <LiveElapsed from={from} />
    </span>
  )
}

/** Body wrapper for client screens rendered in <MScreen pad={false}> */
export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid min-w-0 auto-rows-max grid-cols-[minmax(0,1fr)] content-start gap-3 px-5 py-4', className)}>{children}</div>
}

/**
 * Bottom-anchored action bar for client-driven field screens (one primary action, 52px).
 * Fixed to the viewport inside the 480px app column; renders its own spacer.
 */
export function BottomBar({ children, note, noteTone = 'amber', sub }: { children: ReactNode; note?: ReactNode; noteTone?: 'amber' | 'green' | 'slate'; sub?: ReactNode }) {
  return (
    <>
      <div aria-hidden className={cx(note || sub ? 'h-[108px]' : 'h-[76px]')} />
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[480px] border-t border-slate-200 bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,.06)]">
        {note && <div className={cx('mb-2 text-center text-[12px] font-semibold', noteTone === 'amber' ? 'text-[#B45309]' : noteTone === 'green' ? 'text-[#15803D]' : 'text-slate-500')}>{note}</div>}
        <div className="flex gap-2.5">{children}</div>
        {sub && <div className="mt-2 text-center text-[12px] text-slate-500">{sub}</div>}
      </div>
    </>
  )
}

/** 52px primary button look (for <button> and <a>) */
export const bigBtn = (tone: 'p' | 'g' | 'o' | 'r' | 'd' = 'p', extra?: string) =>
  cx(
    'flex h-[52px] items-center justify-center gap-2 whitespace-nowrap rounded-xl text-base font-bold transition disabled:opacity-60',
    /(^|\s)(flex-|w-full)/.test(extra ?? '') ? '' : 'flex-1',
    tone === 'p' && 'bg-primary text-white',
    tone === 'g' && 'bg-[#16A34A] text-white',
    tone === 'o' && 'border-[1.5px] border-slate-300 bg-white text-slate-700',
    tone === 'r' && 'border-[1.5px] border-[#FCA5A5] bg-white text-[#B91C1C]',
    tone === 'd' && 'bg-slate-300 text-white',
    extra,
  )

/** Single-column stack for server pages inside MScreen (keeps long truncated text from widening the grid) */
export function Col({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid min-w-0 auto-rows-max grid-cols-[minmax(0,1fr)] content-start gap-3', className)}>{children}</div>
}
