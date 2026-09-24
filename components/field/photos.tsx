'use client'
// M11 Photos: kind selector, camera / gallery, compressed + time-watermarked upload with progress, retry, delete.
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Camera, ImagePlus, RotateCw, Trash2, X } from 'lucide-react'
import { api, compressImage, useToast } from '@/components/client'
import { cx, time } from '@/lib/format'
import { BottomBar, CHeader, Body, bigBtn } from './bar'

export const PHOTO_KINDS = [
  { key: 'WOUND_PHOTO', label: 'Wound' },
  { key: 'DRESSING_PHOTO', label: 'Dressing' },
  { key: 'SAMPLE_LABEL', label: 'Sample label' },
  { key: 'PHOTO', label: 'Other' },
] as const
const label = (k: string) => PHOTO_KINDS.find((x) => x.key === k)?.label ?? 'Photo'

type Tile = { _id: string; kind: string; at: string; mine: boolean }
type Up = { id: string; file: File; kind: string; name: string; pct: number; size: number; state: 'uploading' | 'failed'; err?: string; preview: string; xhr?: XMLHttpRequest }

function send(form: FormData, onPct: (p: number) => void, onXhr: (x: XMLHttpRequest) => void) {
  return new Promise<{ id: string }>((resolve, reject) => {
    const x = new XMLHttpRequest()
    onXhr(x)
    x.open('POST', '/api/v1/attachments')
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100))
    x.onload = () => {
      let data: any = null
      try {
        data = JSON.parse(x.responseText)
      } catch {}
      if (x.status >= 200 && x.status < 300) resolve(data)
      else reject(new Error(data?.error?.message ?? `Upload failed (${x.status})`))
    }
    x.onerror = () => reject(new Error('no connection'))
    x.onabort = () => reject(new Error('cancelled'))
    x.send(form)
  })
}

export function PhotoManager({ id, patient, tiles: initial, editable, backHref }: { id: string; patient: string; tiles: Tile[]; editable: boolean; backHref: string }) {
  const router = useRouter()
  const toast = useToast()
  const [kind, setKind] = useState<string>('WOUND_PHOTO')
  const [tiles, setTiles] = useState<Tile[]>(initial)
  const [ups, setUps] = useState<Up[]>([])
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)
  const setUp = (uid: string, p: Partial<Up>) => setUps((xs) => xs.map((u) => (u.id === uid ? { ...u, ...p } : u)))

  async function start(u: Up) {
    setUp(u.id, { state: 'uploading', pct: 0, err: undefined })
    try {
      const small = await compressImage(u.file)
      setUp(u.id, { size: small.size })
      const form = new FormData()
      form.append('file', small, u.name)
      form.append('kind', u.kind)
      form.append('requestId', id)
      const r = await send(
        form,
        (pct) => setUp(u.id, { pct }),
        (xhr) => setUp(u.id, { xhr }),
      )
      setUps((xs) => xs.filter((x) => x.id !== u.id))
      setTiles((ts) => [...ts, { _id: r.id, kind: u.kind, at: new Date().toISOString(), mine: true }])
      router.refresh()
    } catch (e: any) {
      if (e.message === 'cancelled') setUps((xs) => xs.filter((x) => x.id !== u.id))
      else setUp(u.id, { state: 'failed', err: e.message })
    }
  }

  function pick(files: FileList | null) {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      const hhmm = time(new Date()).replace(':', '')
      const u: Up = { id: Math.random().toString(36).slice(2), file, kind, name: `${label(kind).replace(/\s+/g, '_')}_${hhmm}.jpg`, pct: 0, size: file.size, state: 'uploading', preview: URL.createObjectURL(file) }
      setUps((xs) => [...xs, u])
      start(u)
    }
  }

  async function remove(t: Tile) {
    if (!window.confirm(`Delete this ${label(t.kind).toLowerCase()} photo taken at ${time(t.at)}?`)) return
    const prev = tiles
    setTiles((ts) => ts.filter((x) => x._id !== t._id))
    try {
      await api(`/attachments/${t._id}`, { method: 'DELETE' })
      toast('Photo deleted', 'ok')
      router.refresh()
    } catch (e: any) {
      setTiles(prev)
      toast(e.message, 'err')
    }
  }

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
  return (
    <div className="min-w-0">
      <CHeader back={backHref} title="Photos" sub={`${patient} · ${tiles.length} photo${tiles.length === 1 ? '' : 's'}`} />
      <Body>
        {editable && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {PHOTO_KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => setKind(k.key)} className={cx('h-8 flex-none rounded-full px-3 text-[13px] font-semibold', kind === k.key ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
                {k.label}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2.5">
          {tiles.map((t) => (
            <div key={t._id} className="relative aspect-square overflow-hidden rounded-[10px] bg-gradient-to-br from-slate-300 to-slate-400">
              <a href={`/api/v1/attachments/${t._id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/v1/attachments/${t._id}`} alt={`${label(t.kind)} ${time(t.at)}`} className="size-full object-cover" loading="lazy" />
              </a>
              <span className="absolute left-1.5 top-1.5 flex h-5 items-center rounded bg-slate-900/60 px-1.5 text-[10px] font-semibold text-white">{label(t.kind)}</span>
              <span className="absolute bottom-1.5 right-1.5 text-[10px] font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{time(t.at)}</span>
              {editable && t.mine && (
                <button type="button" onClick={() => remove(t)} className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-slate-900/55 text-white" aria-label="Delete photo">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {ups
            .filter((u) => u.state === 'uploading')
            .map((u) => (
              <div key={u.id} className="relative aspect-square overflow-hidden rounded-[10px] bg-slate-300">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u.preview} alt="" className="size-full object-cover opacity-70" />
                <span className="absolute left-1.5 top-1.5 flex h-5 items-center rounded bg-slate-900/60 px-1.5 text-[10px] font-semibold text-white">{label(u.kind)}</span>
                <div className="absolute inset-x-0 bottom-0 h-1 bg-white/40">
                  <div className="h-full bg-primary transition-all" style={{ width: `${u.pct}%` }} />
                </div>
              </div>
            ))}
          {editable && (
            <button type="button" onClick={() => cam.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[10px] border-2 border-dashed border-primary text-[12px] font-semibold text-primary-700">
              <Camera size={22} />
              Add photo
            </button>
          )}
        </div>
        {editable && (
          <button type="button" onClick={() => gal.current?.click()} className="flex h-11 items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-slate-300 bg-white text-[14px] font-semibold text-slate-700">
            <ImagePlus size={18} /> Choose from gallery · {label(kind)}
          </button>
        )}
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
        <input ref={gal} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />

        {ups.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-card bg-white px-4 py-3.5 shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u.preview} alt="" className="size-11 flex-none rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{u.name}</div>
              {u.state === 'failed' ? <div className="text-[12px] text-[#B91C1C]">Failed · {u.err}</div> : <div className="text-[12px] text-slate-500">Uploading · {u.pct}% · {mb(u.size)}</div>}
            </div>
            {u.state === 'failed' ? (
              <>
                <button type="button" onClick={() => start(u)} className="flex h-9 items-center gap-1 px-1 text-[13px] font-semibold text-primary-700">
                  <RotateCw size={14} /> Retry
                </button>
                <button type="button" onClick={() => setUps((xs) => xs.filter((x) => x.id !== u.id))} className="flex size-9 items-center justify-center text-slate-400" aria-label="Discard">
                  <X size={16} />
                </button>
              </>
            ) : (
              <button type="button" onClick={() => u.xhr?.abort()} className="h-9 px-1 text-[13px] font-semibold text-primary-700">
                Cancel
              </button>
            )}
          </div>
        ))}
        {!tiles.length && !ups.length && !editable && <div className="rounded-card bg-white px-4 py-6 text-center text-[13px] text-slate-500 shadow-card">No photos on this visit.</div>}
        <div className="text-center text-[12px] leading-[18px] text-slate-400">Photos are compressed on device, watermarked with the capture time; location metadata is removed.</div>
      </Body>
      <BottomBar>
        <Link href={backHref} className={bigBtn('p')}>
          Done
        </Link>
      </BottomBar>
    </div>
  )
}
