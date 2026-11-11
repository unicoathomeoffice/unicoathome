'use client'
// Picture editor for store items (canvas only): crop (square or free), rotate, paste a copied image, and auto-clean —
// a light plain background is turned pure white and the photo's light / contrast is evened out, so items look clear
// on the store cards. The server then stores it as AVIF (app/api/v1/equipment/[id]/image).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clipboard, Crop, ImagePlus, Loader2, RotateCcw, RotateCw, Sparkles, X } from 'lucide-react'
import { btnClass } from '@/components/ui'
import { useToast } from '@/components/client'
import { readClipboardFiles, usePasteFiles } from '@/components/client/paste'
import { cx } from '@/lib/format'

type Rect = { x: number; y: number; w: number; h: number }
const OUT_MAX = 1000 // result size (the server fits it in 1000 px too)

// ---------------------------------------------------------------- auto-clean
/** Light plain background → white (only the part connected to the edges), then auto levels and a light sharpen. */
export function autoClean(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  // 1. the background colour = median of a band along the edges
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    rs.push(d[i])
    gs.push(d[i + 1])
    bs.push(d[i + 2])
  }
  for (let x = 0; x < w; x += 2) for (let k = 0; k < band; k++) (push(x, k), push(x, h - 1 - k))
  for (let y = 0; y < h; y += 2) for (let k = 0; k < band; k++) (push(k, y), push(w - 1 - k, y))
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]
  const bg = [med([...rs]), med([...gs]), med([...bs])]
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
  const bgLum = lum(bg[0], bg[1], bg[2])
  const bgSat = Math.max(...bg) - Math.min(...bg)
  let spread = 0
  for (let i = 0; i < rs.length; i++) spread += Math.abs(lum(rs[i], gs[i], bs[i]) - bgLum)
  spread /= rs.length
  const plainLight = bgLum > 150 && bgSat < 45 && spread < 26 // only then is whitening safe
  const mask = new Float32Array(w * h) // 1 = background
  if (plainLight) {
    const T1 = 34
    const T2 = 62
    const dist = (i: number) => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) * 0.85 + Math.max(0, bgLum - lum(d[i], d[i + 1], d[i + 2])) * 0.15
    // flood fill from the edges through pixels close to the background colour
    const seen = new Uint8Array(w * h)
    const stack: number[] = []
    const seed = (x: number, y: number) => {
      const p = y * w + x
      if (!seen[p] && dist(p * 4) < T2) (seen[p] = 1, stack.push(p))
    }
    for (let x = 0; x < w; x++) (seed(x, 0), seed(x, h - 1))
    for (let y = 0; y < h; y++) (seed(0, y), seed(w - 1, y))
    while (stack.length) {
      const p = stack.pop()!
      const dd = dist(p * 4)
      mask[p] = dd <= T1 ? 1 : (T2 - dd) / (T2 - T1)
      const x = p % w
      const y = (p - x) / w
      if (x > 0) seed(x - 1, y)
      if (x < w - 1) seed(x + 1, y)
      if (y > 0) seed(x, y - 1)
      if (y < h - 1) seed(x, y + 1)
    }
  }
  // 2. auto levels from the item's own pixels (1 % – 99 %)
  const hist = new Uint32Array(256)
  let n = 0
  for (let p = 0; p < w * h; p++) {
    if (mask[p] > 0.5) continue
    const i = p * 4
    hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++
    n++
  }
  let lo = 0
  let hi = 255
  if (n > 50) {
    let acc = 0
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n * 0.01) { lo = v; break }
    acc = 0
    for (let v = 255; v >= 0; v--) if ((acc += hist[v]) >= n * 0.01) { hi = v; break }
  }
  const stretch = hi - lo > 40 && hi - lo < 235 ? 255 / (hi - lo) : 1
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    for (let c = 0; c < 3; c++) {
      let v = stretch !== 1 ? d[i + c] + ((d[i + c] - lo) * stretch - d[i + c]) * 0.7 : d[i + c] // 70 %: clearer, not harsh
      v = v + (255 - v) * mask[p] // background → white
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
    d[i + 3] = 255
  }
  // 3. light sharpen (unsharp, 3×3)
  const src = new Uint8ClampedArray(d)
  const a = 0.35
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const blur = (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]) / 4
        d[i + c] = src[i + c] + a * (src[i + c] - blur)
      }
    }
  ctx.putImageData(img, 0, 0)
  return { whitened: plainLight }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('Could not read this picture'))
    im.src = src
  })
}

// ---------------------------------------------------------------- editor
export function ImageEditor({ initial, initialUrl, title = 'Picture', autoPaste = false, onUse, onCancel }: { initial?: File | null; initialUrl?: string | null; title?: string; autoPaste?: boolean; onUse: (f: File) => void | Promise<void>; onCancel: () => void }) {
  const toast = useToast()
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null) // the photo, upright (after rotation)
  const [base, setBase] = useState<HTMLImageElement | null>(null)
  const [rot, setRot] = useState(0)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [square, setSquare] = useState(true)
  const [clean, setClean] = useState(true)
  const [before, setBefore] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const out = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [view, setView] = useState({ w: 480, h: 360 })

  const take = useCallback(
    async (f: File | string) => {
      try {
        const url = typeof f === 'string' ? f : URL.createObjectURL(f)
        const im = await loadImage(url)
        setBase(im)
        setRot(0)
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [toast],
  )
  useEffect(() => {
    if (initial) take(initial)
    else if (initialUrl) take(initialUrl)
  }, [initial, initialUrl, take])
  const { over, dropProps } = usePasteFiles((files) => files[0] && take(files[0]), { accept: ['image/*'] })
  useEffect(() => {
    if (autoPaste) void paste()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // upright canvas for the current rotation; the crop starts as the largest centred square
  useEffect(() => {
    if (!base) return
    const c = document.createElement('canvas')
    const turn = rot % 180 !== 0
    const k = Math.min(1, 2400 / Math.max(base.naturalWidth, base.naturalHeight)) // big phone photos: work at ≤2400 px
    const bw = Math.round(base.naturalWidth * k)
    const bh = Math.round(base.naturalHeight * k)
    c.width = turn ? bh : bw
    c.height = turn ? bw : bh
    const x = c.getContext('2d')!
    x.fillStyle = '#fff'
    x.fillRect(0, 0, c.width, c.height)
    x.translate(c.width / 2, c.height / 2)
    x.rotate((rot * Math.PI) / 180)
    x.drawImage(base, -bw / 2, -bh / 2, bw, bh)
    setSrc(c)
    const s = Math.min(c.width, c.height)
    setCrop(square ? { x: (c.width - s) / 2, y: (c.height - s) / 2, w: s, h: s } : { x: 0, y: 0, w: c.width, h: c.height })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, rot])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: Math.min(420, Math.max(240, window.innerHeight * 0.45)) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // result: the crop, scaled to ≤1000 px, auto-cleaned (debounced while dragging)
  useEffect(() => {
    if (!src || !crop || !out.current) return
    const t = setTimeout(() => {
      const k = Math.min(1, OUT_MAX / Math.max(crop.w, crop.h))
      const c = out.current!
      c.width = Math.max(1, Math.round(crop.w * k))
      c.height = Math.max(1, Math.round(crop.h * k))
      const x = c.getContext('2d', { willReadFrequently: true })!
      x.fillStyle = '#fff'
      x.fillRect(0, 0, c.width, c.height)
      x.imageSmoothingQuality = 'high'
      x.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height)
      if (clean && !before) {
        const r = autoClean(x, c.width, c.height)
        setNote(r.whitened ? 'Background turned white · light and contrast evened out' : 'Background is not plain and light — left as it is · light and contrast evened out')
      } else setNote(null)
    }, 90)
    return () => clearTimeout(t)
  }, [src, crop, clean, before])

  const scale = src ? Math.min(view.w / src.width, view.h / src.height) : 1
  const preview = useMemo(() => (src ? src.toDataURL('image/jpeg', 0.82) : ''), [src])
  const dragging = useRef<null | { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; r: Rect }>(null)
  function down(mode: 'move' | 'nw' | 'ne' | 'sw' | 'se', e: React.PointerEvent) {
    if (!crop) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragging.current = { mode, sx: e.clientX, sy: e.clientY, r: { ...crop } }
  }
  function move(e: React.PointerEvent) {
    const g = dragging.current
    if (!g || !src) return
    const dx = (e.clientX - g.sx) / scale
    const dy = (e.clientY - g.sy) / scale
    const W = src.width
    const H = src.height
    const min = Math.max(24, Math.min(W, H) * 0.08)
    let { x, y, w, h } = g.r
    if (g.mode === 'move') {
      x = Math.min(Math.max(0, x + dx), W - w)
      y = Math.min(Math.max(0, y + dy), H - h)
    } else {
      const west = g.mode.includes('w')
      const north = g.mode.includes('n')
      // the opposite corner stays where it is
      const ax = west ? x + w : x
      const ay = north ? y + h : y
      let nw = Math.max(min, w + (west ? -dx : dx))
      let nh = Math.max(min, h + (north ? -dy : dy))
      const roomW = west ? ax : W - ax
      const roomH = north ? ay : H - ay
      if (square) nw = nh = Math.min(Math.max(nw, nh), roomW, roomH)
      else (nw = Math.min(nw, roomW), (nh = Math.min(nh, roomH)))
      x = west ? ax - nw : ax
      y = north ? ay - nh : ay
      w = nw
      h = nh
    }
    setCrop({ x, y, w, h })
  }
  const up = () => (dragging.current = null)

  async function paste() {
    try {
      const files = await readClipboardFiles(['image/*'])
      if (files === 'denied') return toast('The browser blocked the clipboard — press Ctrl+V instead', 'err')
      if (!files.length) return toast('Nothing to paste — copy a picture first', 'err')
      take(files[0])
    } catch {
      toast('The browser blocked the clipboard — press Ctrl+V instead', 'err')
    }
  }
  async function use() {
    if (!out.current || !src) return
    setBusy(true)
    try {
      const blob = await new Promise<Blob | null>((r) => out.current!.toBlob(r, 'image/webp', 0.94))
      if (!blob) throw new Error('Could not make the picture')
      await onUse(new File([blob], 'item.webp', { type: 'image/webp' }))
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/60 p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[96dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl bg-white shadow-drawer">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Crop size={18} className="text-primary-700" />
          <div className="min-w-0 flex-1 truncate text-[15px] font-bold">{title}</div>
          <button type="button" onClick={onCancel} className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="grid flex-1 gap-3 overflow-y-auto p-4 md:grid-cols-[1fr_220px]">
          <div ref={stage} {...(dropProps as any)} className={cx('relative flex min-h-[240px] items-center justify-center rounded-xl bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] [background-size:18px_18px]', over && 'ring-2 ring-primary')}>
            {src && crop ? (
              <div className="relative select-none touch-none" style={{ width: src.width * scale, height: src.height * scale }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                <img src={preview} alt="" className="pointer-events-none absolute inset-0 size-full" draggable={false} />
                {/* dim outside the crop */}
                <div className="pointer-events-none absolute inset-0 bg-black/45" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${crop.x * scale}px ${crop.y * scale}px,${crop.x * scale}px ${(crop.y + crop.h) * scale}px,${(crop.x + crop.w) * scale}px ${(crop.y + crop.h) * scale}px,${(crop.x + crop.w) * scale}px ${crop.y * scale}px,${crop.x * scale}px ${crop.y * scale}px)` }} />
                <div className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }} onPointerDown={(e) => down('move', e)}>
                  {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
                    <span key={k} onPointerDown={(e) => down(k, e)} className={cx('absolute size-5 rounded-full border-2 border-white bg-primary shadow', k[0] === 'n' ? '-top-2.5' : '-bottom-2.5', k[1] === 'w' ? '-left-2.5' : '-right-2.5', k === 'nw' || k === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize')} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 p-6 text-center text-[13px] text-slate-500">
                <ImagePlus size={30} className="text-slate-400" />
                Choose a photo, paste a copied picture (Ctrl+V) or drop one here
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-slate-500">Result</div>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
              <canvas ref={out} className={cx('max-h-full max-w-full', !src && 'hidden')} />
              {!src && <span className="text-[12px] text-slate-400">No picture yet</span>}
            </div>
            {note && <div className="text-[11.5px] leading-[15px] text-slate-500">{note}</div>}
            <label className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[12.5px]">
              <span className="flex items-center gap-1.5 font-semibold">
                <Sparkles size={14} className="text-[#B45309]" /> Auto-clean
              </span>
              <input type="checkbox" className="size-4 accent-[#0090CA]" checked={clean} onChange={(e) => setClean(e.target.checked)} />
            </label>
            {clean && (
              <button type="button" onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)} className="text-left text-[12px] font-semibold text-primary-700">
                Hold to see the original
              </button>
            )}
            <label className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[12.5px]">
              <span className="font-semibold">Square crop</span>
              <input
                type="checkbox"
                className="size-4 accent-[#0090CA]"
                checked={square}
                onChange={(e) => {
                  setSquare(e.target.checked)
                  if (src && e.target.checked && crop) {
                    const s = Math.min(crop.w, crop.h)
                    setCrop({ ...crop, w: s, h: s })
                  }
                }}
              />
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" disabled={!base} className={btnClass('o', 'sm')} onClick={() => setRot((r) => (r + 270) % 360)} title="Rotate left">
                <RotateCcw size={14} />
              </button>
              <button type="button" disabled={!base} className={btnClass('o', 'sm')} onClick={() => setRot((r) => (r + 90) % 360)} title="Rotate right">
                <RotateCw size={14} />
              </button>
            </div>
            <button type="button" className={btnClass('o', 'sm')} onClick={() => src && setCrop({ x: 0, y: 0, w: src.width, h: src.height })} disabled={!src || square}>
              Whole photo
            </button>
            <button type="button" className={btnClass('o', 'sm')} onClick={paste}>
              <Clipboard size={14} /> Paste image
            </button>
            <button type="button" className={btnClass('o', 'sm')} onClick={() => pick.current?.click()}>
              <ImagePlus size={14} /> Choose / camera
            </button>
            <input
              ref={pick}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) take(f)
              }}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" className={btnClass('o')} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={btnClass('p')} disabled={!src || busy} onClick={use}>
            {busy && <Loader2 size={16} className="animate-spin" />} Use picture
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
