import { route, bad, forbidden, clientMeta } from '@/lib/api'
import { can } from '@/lib/constants'
import { getSettings, saveSetting } from '@/lib/settings'
import { storeFile } from '@/lib/files'
import { MAX_UPLOAD_BYTES } from '@/lib/storage'
import { audit } from '@/lib/audit'

/** GET /api/v1/payments/bkash — is bKash payment by QR set up (merchant number, QR picture). Any signed-in staff. */
export const GET = route(async () => {
  const b = (await getSettings()).payments.bkash
  return { enabled: !!b.enabled && !!b.qrAttachmentId, merchantNumber: b.merchantNumber || null, hasQr: !!b.qrAttachmentId, qrVersion: b.qrAttachmentId || null }
})

/**
 * POST /api/v1/payments/bkash (multipart: file?, merchantNumber, enabled) — the hospital's own bKash / Bangla QR picture,
 * kept exactly as uploaded (never re-drawn or re-generated), and the merchant number printed under it. Super admin.
 */
export const POST = route(async ({ req, user }) => {
  if (!can(user, 'settings.manage')) throw forbidden()
  const form = await req.formData()
  const s = await getSettings()
  const cur = s.payments.bkash
  const next = { ...cur }
  const number = String(form.get('merchantNumber') ?? cur.merchantNumber ?? '').replace(/[^\d]/g, '')
  if (number && !/^01[3-9]\d{8}$/.test(number)) throw bad('Merchant number: 01XXXXXXXXX')
  next.merchantNumber = number
  const file = form.get('file')
  if (file instanceof File && file.size) {
    if (file.size > MAX_UPLOAD_BYTES) throw bad('Picture is too large')
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw bad('Only a JPG, PNG or WEBP picture of the QR')
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const a = await storeFile({ data: Buffer.from(await file.arrayBuffer()), mime: file.type, filename: `bkash-qr.${ext}`, kind: 'OTHER', uploadedBy: user.id, ownerType: 'USER', ownerId: user.id, caption: 'bKash payment QR' })
    next.qrAttachmentId = String(a._id)
  }
  if (form.has('enabled')) next.enabled = String(form.get('enabled')) === 'true'
  await saveSetting('payments', { ...s.payments, bkash: next }, user.id)
  await audit(user, 'settings.payments', 'setting', null, { before: { bkash: cur }, after: { bkash: next } }, clientMeta(req, user))
  return { ok: true, enabled: !!next.enabled && !!next.qrAttachmentId, merchantNumber: next.merchantNumber, hasQr: !!next.qrAttachmentId }
})
