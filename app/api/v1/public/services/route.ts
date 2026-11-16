import { publicRoute } from '@/lib/api'
import { ServiceType } from '@/lib/models'
import { getSettings } from '@/lib/settings'

/** GET /api/v1/public/services — the services anyone can ask for (the app's no-login request form). Names only. */
export const GET = publicRoute(async () => {
  const s = await getSettings()
  const items = await ServiceType.find({ isActive: true, deletedAt: null }).select('code name category defaultDurationMin sortOrder').sort({ sortOrder: 1, name: 1 }).lean<any[]>()
  return {
    enabled: s.booking.enabled !== false,
    hotline: s.general.hospitalPhone || null,
    items: items.map((t) => ({ code: t.code, name: t.name, category: t.category ?? null, durationMin: t.defaultDurationMin ?? null })),
  }
})
