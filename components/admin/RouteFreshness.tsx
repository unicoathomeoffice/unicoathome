'use client'
// Instant pages, fresh data: a page can open from the browser's short cache (next.config.ts staleTimes) or from a
// hover prefetch. When that copy may be older than 15 s, refresh it quietly in the background right after it shows.
// Also refresh when the tab comes back after a while. Also a slim top progress bar for any in-app link click.
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ageOf, noteFetched } from '@/components/client/warm'

const FRESH_MS = 15_000
const MAX_CACHE_MS = 120_000 // the longest the browser may keep a page (staleTimes.static)

export function RouteFreshness() {
  const path = usePathname()
  const router = useRouter()
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    const age = ageOf(path)
    if (age != null && age > FRESH_MS && age < MAX_CACHE_MS) {
      // shown from the cache: bring it up to date without a loading screen
      const t = setTimeout(() => {
        noteFetched(path)
        router.refresh()
      }, 250)
      return () => clearTimeout(t)
    }
    noteFetched(path)
  }, [path, router])

  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 60_000) {
        hiddenAt.current = null
        noteFetched(path)
        router.refresh()
      }
    }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [path, router])

  return <NavProgress path={path} />
}

/** A thin bar at the top while the next page is on its way (starts on any in-app link click, ends when it shows). */
function NavProgress({ path }: { path: string }) {
  const [state, setState] = useState<'idle' | 'run' | 'done'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement)?.closest?.('a')
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const href = a.getAttribute('href') ?? ''
      if (!href.startsWith('/') || href.startsWith('/api/') || href.split('?')[0] === window.location.pathname) return
      setState('run')
    }
    document.addEventListener('click', click, true)
    return () => document.removeEventListener('click', click, true)
  }, [])
  useEffect(() => {
    setState((s) => (s === 'run' ? 'done' : s))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 350)
  }, [path])
  if (state === 'idle') return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]" aria-hidden>
      <div className={state === 'run' ? 'hc-nav-run h-full bg-primary shadow-[0_0_8px_#0090CA]' : 'h-full w-full bg-primary opacity-0 transition-opacity duration-300'} />
    </div>
  )
}
