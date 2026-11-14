'use client'
// Instant navigation helpers. Pages are fetched before the click (on hover / focus / touch) and kept in the browser for a
// short while (next.config.ts staleTimes); we remember when each path was fetched so a page shown from that cache can
// quietly refresh itself (components/admin/RouteFreshness.tsx) — instant first, fresh a moment later.
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

const fetchedAt = new Map<string, number>()
const pathOf = (href: string) => href.split('#')[0].split('?')[0] || '/'

/** remember that a path's data was just fetched (navigation, prefetch or refresh) */
export const noteFetched = (href: string) => fetchedAt.set(pathOf(href), Date.now())
/** how old the browser's copy of a path may be (ms), or null when we never fetched it */
export const ageOf = (href: string) => {
  const t = fetchedAt.get(pathOf(href))
  return t ? Date.now() - t : null
}

/** prefetch a page in full when the user shows intent; at most once per 20 s per path */
export function useWarm() {
  const router = useRouter()
  return useCallback(
    (href: string) => {
      if (!href.startsWith('/') || href.startsWith('/api/')) return
      const age = ageOf(href)
      if (age != null && age < 20_000) return
      noteFetched(href)
      try {
        router.prefetch(href)
      } catch {}
    },
    [router],
  )
}

/** props that warm a link on hover, keyboard focus or the first touch */
export function useWarmProps(href: string) {
  const warm = useWarm()
  return { onMouseEnter: () => warm(href), onFocus: () => warm(href), onTouchStart: () => warm(href) }
}
