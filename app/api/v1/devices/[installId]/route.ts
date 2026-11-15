import { route, clientMeta, notFound, forbidden } from '@/lib/api'
import { Device, Session } from '@/lib/models'
import { can } from '@/lib/constants'
import { forgetAuth } from '@/lib/auth'
import { audit } from '@/lib/audit'

/**
 * DELETE — remove a phone: stops its push messages and signs it out. Your own phones, or anyone's with users.manage
 * (staff screen → Devices).
 */
export const DELETE = route<{ installId: string }>(async ({ req, user, params }) => {
  const d = await Device.findOne({ installId: params.installId }).lean<any>()
  if (!d) throw notFound('Device')
  if (String(d.userId) !== user.id && !can(user, 'users.manage')) throw forbidden()
  await Device.updateOne({ _id: d._id }, { $unset: { pushToken: 1, jti: 1 }, revokedAt: new Date(), waHost: false })
  if (d.jti) {
    await Session.updateOne({ jti: d.jti }, { revokedAt: new Date() })
    forgetAuth(d.jti)
  }
  await audit(user, 'device.remove', 'device', d._id, { label: `${d.model ?? 'Android'} · ${d.appVersion ?? ''}` }, clientMeta(req, user))
  return { ok: true }
})
