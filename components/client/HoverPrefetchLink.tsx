'use client'
// A Link that loads its page the moment the user points at it (hover / focus / touch), so the click opens it at once.
import Link from 'next/link'
import type { ComponentProps } from 'react'
import { useWarmProps } from './warm'

export function HoverPrefetchLink({ href, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const warm = useWarmProps(href)
  return (
    <Link
      href={href}
      {...rest}
      onMouseEnter={(e) => (warm.onMouseEnter(), rest.onMouseEnter?.(e))}
      onFocus={(e) => (warm.onFocus(), rest.onFocus?.(e))}
      onTouchStart={(e) => (warm.onTouchStart(), rest.onTouchStart?.(e))}
    />
  )
}
