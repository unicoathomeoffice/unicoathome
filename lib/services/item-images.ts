import 'server-only'
import { Attachment, Equipment } from '../models'

// Store items have a gallery (front, back, label, box…) — Equipment.images — and a cover (Equipment.imageId) that the
// cards, family tiles, bag check and pickers show. Older items only have imageId: their gallery is just the cover.
// A picture file can be shared (family pictures), so it is only retired when no item uses it any more.

export const MAX_IMAGES = 10

export type GalleryImage = { attachmentId: string; caption: string; at: string | null; cover: boolean }

export function galleryOf(item: { imageId?: unknown; images?: { attachmentId: unknown; caption?: string; at?: Date }[] }): GalleryImage[] {
  const cover = item.imageId ? String(item.imageId) : null
  const list = (item.images ?? []).map((i) => ({ attachmentId: String(i.attachmentId), caption: i.caption ?? '', at: i.at ? new Date(i.at).toISOString() : null }))
  // older items: the cover is the gallery
  if (cover && !list.some((i) => i.attachmentId === cover)) list.unshift({ attachmentId: cover, caption: '', at: null })
  return list.map((i) => ({ ...i, cover: i.attachmentId === cover }))
}

/** The stored gallery array including the cover (fills in older items on first change). */
export function materialize(item: any) {
  const g = galleryOf(item)
  item.images = g.map((i) => ({ attachmentId: i.attachmentId, caption: i.caption || undefined, at: i.at ? new Date(i.at) : new Date() }))
}

export async function retireIfUnused(attachmentId: unknown) {
  if (!attachmentId) return
  const used = await Equipment.exists({ $or: [{ imageId: attachmentId }, { 'images.attachmentId': attachmentId }] })
  if (!used) await Attachment.updateOne({ _id: attachmentId }, { deletedAt: new Date() })
}
