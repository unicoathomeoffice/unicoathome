'use client'
// Full-size picture of a store item with Change / Crop / Paste / Remove, and "use for the other sizes" of its family.
// Every new picture goes through the editor (crop, auto-clean) and is stored as AVIF by the server.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Clipboard, Copy, Crop, ImagePlus, Loader2, Package, Trash2, X } from 'lucide-react'
import { api, compressImage, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { ImageEditor } from './ImageEditor'

export type PictureItem = { _id: string; name: string; imageId?: string | null; family?: string; variant?: string; brand?: string; unit: string; stock?: number }

export const itemImageUrl = (i: { _id: string; imageId?: string | null }) => (i.imageId ? `/api/v1/equipment/${i._id}/image?v=${i.imageId}` : null)

/** Upload a picture for an item (the server crops white margins and stores AVIF); optionally for the family too. */
export async function uploadItemPicture(id: string, file: File, opts: { family?: boolean } = {}) {
  const form = new FormData()
  form.append('file', file.size > 3_500_000 ? await compressImage(file, false) : file)
  await api(`/equipment/${id}/image`, { form })
  if (opts.family) return (await api<{ count: number }>(`/equipment/${id}/image/family`, { body: {} })).count
  return 0
}

export function ImageViewer({ item, canEdit, siblings = 0, onClose }: { item: PictureItem; canEdit: boolean; siblings?: number; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [editor, setEditor] = useState<null | { url?: string | null; paste?: boolean }>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const url = itemImageUrl(item)

  async function saved(file: File) {
    setBusy('save')
    try {
      await uploadItemPicture(item._id, file)
      toast('Picture saved', 'ok')
      setEditor(null)
      router.refresh()
      onClose()
    } finally {
      setBusy(null)
    }
  }
  async function forFamily() {
    setBusy('family')
    try {
      const r = await api<{ count: number }>(`/equipment/${item._id}/image/family`, { body: {} })
      toast(r.count ? `Used for ${r.count} more size${r.count === 1 ? '' : 's'}` : 'All sizes already have a picture', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function remove() {
    if (!confirm(`Remove the picture of ${item.name}?`)) return
    setBusy('remove')
    try {
      await api(`/equipment/${item._id}/image`, { method: 'DELETE' })
      toast('Picture removed', 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  if (editor) return <ImageEditor title={`Picture · ${item.name}`} initialUrl={editor.url ?? null} autoPaste={!!editor.paste} onUse={saved} onCancel={() => setEditor(null)} />

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/70 p-3" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="flex max-h-[96dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold">{item.name}</div>
            <div className="text-[12px] text-slate-500">{[item.family, item.variant, item.brand, `${item.stock ?? 0} ${item.unit} in store`].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-[260px] flex-1 items-center justify-center bg-white p-4">
          {url ? <img src={url} alt={item.name} className="max-h-[62dvh] max-w-full rounded-lg object-contain" /> : <div className="flex flex-col items-center gap-2 text-slate-400"><Package size={56} /><span className="text-[13px]">No picture yet</span></div>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
            <button type="button" className={btnClass('p', 'sm')} onClick={() => setEditor({})} disabled={!!busy}>
              <ImagePlus size={15} /> {url ? 'Change picture' : 'Add picture'}
            </button>
            <button type="button" className={btnClass('o', 'sm')} onClick={() => setEditor({ paste: true })} disabled={!!busy} title="Copy a picture anywhere, then paste it">
              <Clipboard size={15} /> Paste image
            </button>
            {url && (
              <button type="button" className={btnClass('o', 'sm')} onClick={() => setEditor({ url })} disabled={!!busy}>
                <Crop size={15} /> Crop / clean
              </button>
            )}
            {url && item.family && siblings > 0 && (
              <button type="button" className={btnClass('o', 'sm')} onClick={forFamily} disabled={!!busy}>
                {busy === 'family' ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />} Use for other sizes
              </button>
            )}
            {url && (
              <button type="button" className={btnClass('o', 'sm', 'ml-auto text-[#B91C1C]')} onClick={remove} disabled={!!busy}>
                {busy === 'remove' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
