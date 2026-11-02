import 'server-only'
import sharp from 'sharp'
import { Attachment, HomecareRequest, Patient, User } from './models'
import { storeFile } from './files'
import { bad } from './api'

// Profile photos for staff and patients. The photo is cropped square in the browser, then normalised here to a
// 320px WebP and stored as an AVATAR attachment. `photoUrl` on the User / Patient points at /api/v1/avatars/<id>,
// so everything that already shows `photoUrl` (session, lists, request joins) picks it up. A new photo is a new id,
// which lets the avatar route cache it for a year.

export const avatarUrl = (id: unknown) => `/api/v1/avatars/${id}`
const MAX_BYTES = 4 * 1024 * 1024

async function readPhoto(req: Request) {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw bad('No photo')
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw bad('Use a JPG, PNG or WebP photo')
  if (file.size > MAX_BYTES) throw bad('The photo is too large (max 4 MB)')
  try {
    return await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none' })
      .rotate()
      .resize(320, 320, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    throw bad('That photo could not be read')
  }
}

/** Is this one of our stored avatars (not e.g. a Google picture URL)? Returns its attachment id. */
const ownId = (url?: string | null) => url?.match(/^\/api\/v1\/avatars\/([a-f0-9]{24})$/i)?.[1]

async function dropOld(url?: string | null) {
  const id = ownId(url)
  if (id) await Attachment.updateOne({ _id: id }, { deletedAt: new Date() })
}

/** Set a staff member's photo from a multipart request (field `file`). */
export async function setUserPhoto(req: Request, userId: string, by: string) {
  const data = await readPhoto(req)
  const prev = await User.findById(userId).select('photoUrl employeeId').lean<any>()
  if (!prev) throw bad('Unknown user')
  const a = await storeFile({ data, mime: 'image/webp', filename: `photo-${prev.employeeId ?? userId}.webp`, kind: 'AVATAR', ownerType: 'USER', ownerId: userId, uploadedBy: by, caption: 'Profile photo' })
  const url = avatarUrl(a._id)
  await User.updateOne({ _id: userId }, { photoUrl: url })
  await dropOld(prev.photoUrl)
  return { url, before: prev.photoUrl as string | undefined }
}

export async function clearUserPhoto(userId: string) {
  const prev = await User.findById(userId).select('photoUrl').lean<any>()
  await User.updateOne({ _id: userId }, { $unset: { photoUrl: 1 } })
  await dropOld(prev?.photoUrl)
  return { before: prev?.photoUrl as string | undefined }
}

/** Set a patient's photo; also copied onto their requests' patient snapshot so lists show it without a join. */
export async function setPatientPhoto(req: Request, patientId: string, by?: string) {
  const data = await readPhoto(req)
  const prev = await Patient.findById(patientId).select('photoUrl').lean<any>()
  if (!prev) throw bad('Unknown patient')
  const a = await storeFile({ data, mime: 'image/webp', filename: `patient-${patientId}.webp`, kind: 'AVATAR', ownerType: 'PATIENT', ownerId: patientId, uploadedBy: by, caption: 'Profile photo' })
  const url = avatarUrl(a._id)
  await Patient.updateOne({ _id: patientId }, { photoUrl: url })
  await HomecareRequest.updateMany({ patientId }, { $set: { 'patientSnapshot.photoUrl': url } })
  await dropOld(prev.photoUrl)
  return { url, before: prev.photoUrl as string | undefined }
}

export async function clearPatientPhoto(patientId: string) {
  const prev = await Patient.findById(patientId).select('photoUrl').lean<any>()
  await Patient.updateOne({ _id: patientId }, { $unset: { photoUrl: 1 } })
  await HomecareRequest.updateMany({ patientId }, { $unset: { 'patientSnapshot.photoUrl': 1 } })
  await dropOld(prev?.photoUrl)
  return { before: prev?.photoUrl as string | undefined }
}
