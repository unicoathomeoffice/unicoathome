'use client'
// The pictures of a store item: a large view with ‹ › (arrows, keys or swipe) and a thumbnail strip. Per picture:
// set as cover (the one the cards show), name it (Front / Back / Label…), edit it in the photo studio, remove it.
// "+ Add pictures" takes several at once — they go through the studio one after another ("Picture 2 of 5", or the
// same look for all) — and paste / drop work too. The server stores every picture as AVIF.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Clipboard, Copy, ImagePlus, Loader2, Package, Pencil, Star, Trash2, X } from 'lucide-react'
import { api, compressImage, useToast } from '@/components/client'
import { usePasteFiles } from '@/components/client/paste'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { ImageEditor } from './ImageEditor'

export type PictureItem = { _id: string; name: string; imageId?: string | null; images?: { attachmentId: string }[]; family?: string; variant?: string; brand?: string; unit: string; stock?: number }
type Pic = { attachmentId: string; caption: string; at: string | null; cover: boolean }

export const itemImageUrl = (i: { _id: string; imageId?: string | null }) => (i.imageId ? `/api/v1/equipment/${i._id}/image?v=${i.imageId}` : null)
const picUrl = (id: string, att: string) => `/api/v1/equipment/${id}/image?att=${att}`
/** how many pictures an item has (older items: just the cover) */
export const pictureCount = (i: { imageId?: string | null; images?: { attachmentId: string }[] }) => {
  const n = i.images?.length ?? 0
  return i.imageId && !i.images?.some((x) => String(x.attachmentId) === String(i.imageId)) ? n + 1 : n
}
const CAPTIONS = ['Front', 'Back', 'Label', 'Box', 'Pack', 'In use']

/**
 * Upload a picture for an item (the server trims white margins and stores AVIF).
 * Default replaces the cover · add: a new gallery picture · replace: that gallery picture · family: also for the sizes.
 */
export async function uploadItemPicture(id: string, file: File, opts: { family?: boolean; add?: boolean; replace?: string; cover?: boolean; caption?: string } = {}) {
  const form = new FormData()
  form.append('file', file.size > 3_500_000 ? await compressImage(file, false) : file)
  if (opts.caption) form.append('caption', opts.caption)
  const q = new URLSearchParams()
  if (opts.add) q.set('add', '1')
  if (opts.cover) q.set('cover', '1')
  if (opts.replace) q.set('replace', opts.replace)
  await api(`/equipment/${id}/image${q.size ? `?${q}` : ''}`, { form })
  if (opts.family) return (await api<{ count: number }>(`/equipment/${id}/image/family`, { body: {} })).count
  return 0
}

export function ImageViewer({ item, canEdit, siblings = 0, onClose }: { item: PictureItem; canEdit: boolean; siblings?: number; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [pics, setPics] = useState<Pic[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [editor, setEditor] = useState<null | { files?: File[]; url?: string; replace?: string; paste?: boolean }>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [capEdit, setCapEdit] = useState<string | null>(null)
  const [saved, setSaved] = useState(0) // pictures added in a multi-upload run
  const pick = useRef<HTMLInputElement>(null)
  const touch = useRef<number | null>(null)

  const load = useCallback(
    async (focus?: 'last' | string) => {
      try {
        const r = await api<{ items: Pic[] }>(`/equipment/${item._id}/images`)
        setPics(r.items)
        setIdx((i) => (focus === 'last' ? Math.max(0, r.items.length - 1) : focus ? Math.max(0, r.items.findIndex((p) => p.attachmentId === focus)) : Math.min(i, Math.max(0, r.items.length - 1))))
      } catch (e: any) {
        toast(e.message, 'err')
        setPics([])
      }
    },
    [item._id, toast],
  )
  useEffect(() => {
    load(item.imageId ? String(item.imageId) : undefined)
  }, [load, item.imageId])

  const cur = pics?.[idx] ?? null
  const n = pics?.length ?? 0
  const go = (d: number) => n > 1 && setIdx((i) => (i + d + n) % n)
  useEffect(() => {
    if (editor) return
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  const { over, dropProps } = usePasteFiles((files) => canEdit && files.length && setEditor({ files }), { accept: ['image/*'], enabled: canEdit && !editor })

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key)
    try {
      await fn()
      if (ok) toast(ok, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  const setCover = () => cur && run('cover', async () => setPics((await api<{ items: Pic[] }>(`/equipment/${item._id}/images`, { method: 'PATCH', body: { cover: cur.attachmentId } })).items), 'Cover picture changed')
  const caption = (att: string, text: string) =>
    run('caption', async () => {
      setPics((await api<{ items: Pic[] }>(`/equipment/${item._id}/images`, { method: 'PATCH', body: { captions: { [att]: text.trim() } } })).items)
      setCapEdit(null)
    })
  const remove = () => {
    if (!cur || !confirm(`Remove this picture${cur.caption ? ` (${cur.caption})` : ''} of ${item.name}?`)) return
    run('remove', async () => {
      const r = await api<{ items: Pic[] }>(`/equipment/${item._id}/images/${cur.attachmentId}`, { method: 'DELETE' })
      setPics(r.items)
      setIdx((i) => Math.min(i, Math.max(0, r.items.length - 1)))
    }, 'Picture removed')
  }
  const forFamily = () =>
    run('family', async () => {
      const r = await api<{ count: number }>(`/equipment/${item._id}/image/family`, { body: {} })
      toast(r.count ? `Cover used for ${r.count} more size${r.count === 1 ? '' : 's'}` : 'All sizes already have a picture', 'ok')
    })

  /** one picture from the studio: an edited version (replace) or a new one (add) */
  async function fromStudio(file: File) {
    const ed = editor
    if (!ed) return
    if (ed.replace) {
      await uploadItemPicture(item._id, file, { replace: ed.replace })
      toast('Picture saved', 'ok')
      setEditor(null)
      await load()
    } else {
      await uploadItemPicture(item._id, file, { add: true })
      setSaved((x) => x + 1)
      if (!ed.files || ed.files.length < 2) {
        toast('Picture added', 'ok')
        setEditor(null)
      }
      await load('last')
    }
    router.refresh()
  }
  const closeStudio = () => {
    if (saved > 1) toast(`${saved} pictures added`, 'ok')
    setSaved(0)
    setEditor(null)
  }

  if (editor)
    return (
      <ImageEditor
        title={editor.replace ? `Edit picture · ${item.name}` : `New picture · ${item.name}`}
        initial={editor.files?.length === 1 ? editor.files[0] : null}
        queue={editor.files && editor.files.length > 1 ? editor.files : undefined}
        initialUrl={editor.url ?? null}
        autoPaste={!!editor.paste}
        onUse={fromStudio}
        onCancel={closeStudio}
      />
    )

  const room = 10 - n
  return createPortal(
    <div className="fixed inset-0 z-[85] flex bg-slate-900/75 sm:items-center sm:justify-center sm:p-3" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[96dvh] sm:max-w-[760px] sm:rounded-2xl sm:shadow-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold">{item.name}</div>
            <div className="truncate text-[12px] text-slate-500">{[item.family, item.variant, item.brand, `${item.stock ?? 0} ${item.unit} in store`, n ? `${n} picture${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" onClick={onClose} className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={19} />
          </button>
        </div>

        {/* large picture */}
        <div
          {...(dropProps as any)}
          className={cx('relative flex min-h-[280px] flex-1 items-center justify-center bg-white p-4', over && 'ring-2 ring-inset ring-primary')}
          onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touch.current == null) return
            const dx = e.changedTouches[0].clientX - touch.current
            touch.current = null
            if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1)
          }}
        >
          {pics == null ? (
            <Loader2 size={28} className="animate-spin text-slate-300" />
          ) : cur ? (
            <img key={cur.attachmentId} src={picUrl(item._id, cur.attachmentId)} alt={cur.caption || item.name} className="max-h-[58dvh] max-w-full rounded-lg object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <Package size={56} />
              <span className="text-[13px]">No picture yet{canEdit ? ' — add, paste or drop some' : ''}</span>
            </div>
          )}
          {n > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md ring-1 ring-slate-200 hover:bg-white" aria-label="Previous picture">
                <ChevronLeft size={22} />
              </button>
              <button type="button" onClick={() => go(1)} className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md ring-1 ring-slate-200 hover:bg-white" aria-label="Next picture">
                <ChevronRight size={22} />
              </button>
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/60 px-2 py-0.5 text-[11.5px] font-semibold text-white">
                {idx + 1} / {n}
              </span>
            </>
          )}
          {cur && (
            <span className="absolute left-3 top-3 flex gap-1">
              {cur.cover && (
                <span className="flex items-center gap-1 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11.5px] font-bold text-[#B45309] ring-1 ring-[#FDE68A]">
                  <Star size={11} fill="currentColor" /> Cover
                </span>
              )}
              {cur.caption && <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-[11.5px] font-semibold text-white">{cur.caption}</span>}
            </span>
          )}
        </div>

        {/* thumbnails */}
        {(n > 1 || (canEdit && n > 0)) && (
          <div className="flex gap-2 overflow-x-auto border-t border-slate-100 px-4 py-2.5">
            {pics!.map((p, i) => (
              <button key={p.attachmentId} type="button" onClick={() => setIdx(i)} className={cx('relative size-16 flex-none overflow-hidden rounded-lg bg-slate-100 ring-offset-1 transition', i === idx ? 'ring-2 ring-primary' : 'ring-1 ring-slate-200 hover:ring-slate-400')} title={p.caption || `Picture ${i + 1}`}>
                <img src={picUrl(item._id, p.attachmentId)} alt="" className="size-full object-cover" loading="lazy" />
                {p.cover && (
                  <span className="absolute left-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-[#F59E0B] text-white">
                    <Star size={9} fill="currentColor" />
                  </span>
                )}
                {p.caption && <span className="absolute inset-x-0 bottom-0 truncate bg-slate-900/60 px-0.5 text-[9.5px] font-semibold text-white">{p.caption}</span>}
              </button>
            ))}
            {canEdit && room > 0 && (
              <button type="button" onClick={() => pick.current?.click()} className="flex size-16 flex-none flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-[10.5px] font-semibold text-slate-500 hover:border-primary hover:text-primary-700">
                <ImagePlus size={18} /> Add
              </button>
            )}
          </div>
        )}

        {/* name the picture */}
        {canEdit && cur && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-4 py-2.5">
            <span className="mr-1 text-[12px] font-semibold text-slate-500">Name</span>
            {CAPTIONS.map((c) => (
              <button key={c} type="button" disabled={!!busy} onClick={() => caption(cur.attachmentId, cur.caption === c ? '' : c)} className={cx('h-8 rounded-full px-3 text-[12px] font-semibold ring-1', cur.caption === c ? 'bg-primary text-white ring-primary' : 'bg-white text-slate-600 ring-slate-300 hover:ring-slate-400')}>
                {c}
              </button>
            ))}
            {capEdit != null ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  caption(cur.attachmentId, capEdit)
                }}
              >
                <input autoFocus className="hc-input h-8 w-32 text-[12.5px]" maxLength={40} value={capEdit} onChange={(e) => setCapEdit(e.target.value)} placeholder="e.g. Seal" />
                <button type="submit" className={btnClass('p', 'sm')} disabled={!!busy}>
                  Save
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setCapEdit(CAPTIONS.includes(cur.caption) ? '' : cur.caption)} className="h-8 rounded-full px-3 text-[12px] font-semibold text-primary-700 hover:bg-primary-50">
                {cur.caption && !CAPTIONS.includes(cur.caption) ? `“${cur.caption}” ✎` : 'Other…'}
              </button>
            )}
          </div>
        )}

        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
            <button type="button" className={btnClass('p', 'sm')} onClick={() => pick.current?.click()} disabled={!!busy || room <= 0} title={room <= 0 ? 'Up to 10 pictures — remove one first' : 'Choose one or several'}>
              <ImagePlus size={15} /> Add pictures
            </button>
            <button type="button" className={btnClass('o', 'sm')} onClick={() => setEditor({ paste: true })} disabled={!!busy || room <= 0} title="Copy a picture anywhere, then paste it">
              <Clipboard size={15} /> Paste
            </button>
            {cur && (
              <button type="button" className={btnClass('o', 'sm')} onClick={() => setEditor({ url: picUrl(item._id, cur.attachmentId), replace: cur.attachmentId })} disabled={!!busy}>
                <Pencil size={15} /> Edit in studio
              </button>
            )}
            {cur && !cur.cover && (
              <button type="button" className={btnClass('o', 'sm')} onClick={setCover} disabled={!!busy}>
                {busy === 'cover' ? <Loader2 size={15} className="animate-spin" /> : <Star size={15} />} Set as cover
              </button>
            )}
            {item.imageId && item.family && siblings > 0 && (
              <button type="button" className={btnClass('o', 'sm')} onClick={forFamily} disabled={!!busy} title="Give the sizes without a picture this cover">
                {busy === 'family' ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />} Cover for other sizes
              </button>
            )}
            {cur && (
              <button type="button" className={btnClass('o', 'sm', 'ml-auto text-[#B91C1C]')} onClick={remove} disabled={!!busy}>
                {busy === 'remove' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Remove
              </button>
            )}
            <input
              ref={pick}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])].slice(0, Math.max(0, room))
                e.target.value = ''
                if ((e.target.files?.length ?? 0) > room) toast(`Only ${room} more picture${room === 1 ? '' : 's'} fit (10 per item)`, 'err')
                if (files.length) setEditor({ files })
              }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
