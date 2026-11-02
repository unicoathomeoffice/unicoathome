import type { MetadataRoute } from 'next'
import { baseUrl } from '@/lib/links'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = baseUrl()
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/join`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
