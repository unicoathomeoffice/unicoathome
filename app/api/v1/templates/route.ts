import { route } from '@/lib/api'
import { PLACEHOLDERS } from '@/lib/templates'
import { listTemplates } from './_shared'

/** GET /api/v1/templates — DEFAULT_TEMPLATES merged with DB overrides (E5). */
export const GET = route(
  async () => {
    return { items: await listTemplates(), placeholders: PLACEHOLDERS }
  },
  { perm: 'templates.manage' },
)
