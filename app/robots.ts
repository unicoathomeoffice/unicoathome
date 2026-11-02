import type { MetadataRoute } from 'next'
import { baseUrl } from '@/lib/links'

// Only the public pages are for search engines; staff, patient and share links stay out of results.
export default function robots(): MetadataRoute.Robots {
  const base = baseUrl()
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$', '/privacy', '/terms', '/join', '/opengraph-image'],
        disallow: ['/s/', '/t/', '/feedback/', '/m', '/my', '/api/', '/print/', '/dashboard', '/requests', '/patients', '/staff', '/settings', '/reports', '/login'],
      },
    ],
    sitemap: base ? `${base}/sitemap.xml` : undefined,
  }
}
