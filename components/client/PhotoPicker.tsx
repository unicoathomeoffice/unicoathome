'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, Trash2, X, ZoomIn } from 'lucide-react'
import { api } from './api'
import { useToast } from './toast'
import { Avatar } from '@/components/ui'
import { cx } from '@/lib/format'

const STAGE = 280
const OUT = 512

/**
 * Profile photo with "change / remove": pick or take a photo, drag and zoom it inside the circle, upload a square JPEG
 * to `endpoint` (e.g. /users/me/photo, /users/:id/photo, /patient/me/photo, /patients/:id/photo).
 */
export function PhotoPicker({ endpoint, photo, name, size = 72, tone = 'blue', canRemove = true, className }: { endpoint: string; photo?: string | null; name?: string | null; size?: number; tone?: 'blue' | 'teal' | 'navy' | 'slate' | 'amber' | 'violet' | 'green'; canRemove?: boolean; className?: string }) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(f?: File) {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast('Choose a photo', 'err')
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' })
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * s)
      c.height = Math.round(bmp.height * s)
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
      setSrc(c)
    } catch {
      toast('That photo could not be opened — try a JPG or PNG', 'err')
    }
  }

  async function upload(blob: Blob) {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
      await api(endpoint, { form })
      toast('Photo updated', 'ok')
      setSrc(null)
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Could not save the photo', 'err')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Remove the photo? Initials will show instead.')) return
    setBusy(true)
    try {
      await api(endpoint, { method: 'DELETE' })
      toast('Photo removed', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Could not remove the photo', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cx('flex flex-col items-center gap-1.5', className)}>
      <button type="button" onClick={() => input.current?.click()} className="group relative rounded-full focus-visible:outline-2 focus-visible:outline-primary" aria-label={photo ? 'Change photo' : 'Add a photo'} disabled={busy}>
        <Avatar name={name} photo={photo} size={size} tone={tone} />
        <span className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full bg-primary text-white shadow ring-2 ring-white">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
        </span>
      </button>
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        <button type="button" onClick={() => input.current?.click()} className="text-primary-700 hover:underline" disabled={busy}>
          {photo ? 'Change photo' : 'Add photo'}
        </button>
        {photo && canRemove && (
          <button type="button" onClick={remove} className="inline-flex items-center gap-0.5 text-slate-500 hover:text-[#B91C1C]" disabled={busy}>
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      {src && <Cropper src={src} busy={busy} onCancel={() => setSrc(null)} onDone={upload} />}
    </div>
  )
}

/** Circle crop: drag to move, slider / wheel / pinch to zoom. The photo always covers the circle. */
function Cropper({ src, busy, onCancel, onDone }: { src: HTMLCanvasElement; busy: boolean; onCancel: () => void; onDone: (b: Blob) => void }) {
  const base = STAGE / Math.min(src.width, src.height)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState(() => ({ x: (STAGE - src.width * base) / 2, y: (STAGE - src.height * base) / 2 }))
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const url = useRef<string>('')
  const [img, setImg] = useState('')

  useEffect(() => {
    src.toBlob((b) => {
      if (!b) return
      url.current = URL.createObjectURL(b)
      setImg(url.current)
    }, 'image/jpeg', 0.92)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
      if (url.current) URL.revokeObjectURL(url.current)
    }
  }, [src])

  const scale = base * zoom
  const clamp = (p: { x: number; y: number }, s = scale) => ({
    x: Math.min(0, Math.max(STAGE - src.width * s, p.x)),
    y: Math.min(0, Math.max(STAGE - src.height * s, p.y)),
  })
  /** zoom around the circle's centre */
  function zoomTo(z: number) {
    const nz = Math.min(4, Math.max(1, z))
    const cx0 = (STAGE / 2 - pos.x) / scale
    const cy0 = (STAGE / 2 - pos.y) / scale
    const ns = base * nz
    setZoom(nz)
    setPos(clamp({ x: STAGE / 2 - cx0 * ns, y: STAGE / 2 - cy0 * ns }, ns))
  }

  function save() {
    const c = document.createElement('canvas')
    c.width = OUT
    c.height = OUT
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(src, -pos.x / scale, -pos.y / scale, STAGE / scale, STAGE / scale, 0, 0, OUT, OUT)
    c.toBlob((b) => b && onDone(b), 'image/jpeg', 0.9)
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/70 p-4" role="dialog" aria-modal="true" aria-label="Crop photo">
      <div className="w-full max-w-[360px] rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[16px] font-bold">Move and zoom</div>
          <button type="button" onClick={onCancel} className="flex size-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>
        <div
          className="relative mx-auto touch-none select-none overflow-hidden rounded-xl bg-slate-900"
          style={{ width: STAGE, height: STAGE }}
          onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()]
              pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }
              drag.current = null
            } else drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId)) return
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (pinch.current && pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()]
              zoomTo((pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d)
            } else if (drag.current) {
              setPos(clamp({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }))
            }
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId)
            if (pointers.current.size < 2) pinch.current = null
            drag.current = null
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId)
            pinch.current = null
            drag.current = null
          }}
        >
          {img && <img src={img} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: pos.x, top: pos.y, width: src.width * scale, height: src.height * scale }} />}
          {/* dim everything outside the circle */}
          <svg className="pointer-events-none absolute inset-0" width={STAGE} height={STAGE} aria-hidden="true">
            <path d={`M0 0H${STAGE}V${STAGE}H0Z M${STAGE / 2} 0a${STAGE / 2} ${STAGE / 2} 0 1 0 0.01 0Z`} fill="rgba(15,23,42,0.55)" fillRule="evenodd" />
            <circle cx={STAGE / 2} cy={STAGE / 2} r={STAGE / 2 - 1} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={2} />
          </svg>
        </div>
        <label className="mt-3 flex items-center gap-2 text-slate-500">
          <ZoomIn size={16} />
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} className="flex-1 accent-[#0090CA]" aria-label="Zoom" />
        </label>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-xl border-[1.5px] border-slate-300 text-[14px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-bold text-white hover:bg-primary-700 disabled:opacity-60">
            {busy && <Loader2 size={16} className="animate-spin" />} Save photo
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
