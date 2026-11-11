'use client'
// Photo studio for store item pictures: crop & rotate, colourful live filter previews with intensity, light / colour /
// detail sliders, background (white, colour, gradient, brush), studio look (centred square, shadow, rounded corners,
// watermark), before ↔ after split, undo / redo. Full-screen with bottom tool tabs on phones. Several pictures can be
// done in a row ("Picture 2 of 5") and the same look applied to all the rest in one tap. The server stores AVIF.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Brush, Clipboard, Crop as CropIcon, ImagePlus, Layers, Loader2, Palette, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Sparkles, SplitSquareHorizontal, Undo2, Wand2, X } from 'lucide-react'
import { btnClass } from '@/components/ui'
import { useToast } from '@/components/client'
import { readClipboardFiles, usePasteFiles } from '@/components/client/paste'
import { cx } from '@/lib/format'
import { cropTo, DEFAULTS, loadImage, PRESETS, processFile, render, upright, ZERO, type Adjust, type PresetKey, type Settings } from '@/lib/image-filters'

type Rect = { x: number; y: number; w: number; h: number }
type Tab = 'crop' | 'filters' | 'adjust' | 'background' | 'studio'
const TABS: [Tab, string, typeof CropIcon][] = [
  ['crop', 'Crop', CropIcon],
  ['filters', 'Filters', Sparkles],
  ['adjust', 'Adjust', SlidersHorizontal],
  ['background', 'Background', Palette],
  ['studio', 'Studio', Layers],
]
const BG_COLORS = ['#ffffff', '#f1f5f9', '#e0f2fe', '#dcfce7', '#fef3c7', '#fce7f3', '#1f3864']
const LOOK_KEY = 'hc:photo-look' // the last look is remembered on this device for the next picture
const fresh = (): Settings => ({ ...DEFAULTS, adjust: { ...ZERO }, bg: { ...DEFAULTS.bg, strokes: [] }, studio: { ...DEFAULTS.studio } })

function savedLook(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null')
    if (v?.adjust && v.preset in PRESETS) return { ...fresh(), ...v, adjust: { ...ZERO, ...v.adjust }, bg: { ...DEFAULTS.bg, ...v.bg, strokes: [] }, studio: { ...DEFAULTS.studio, ...v.studio } }
  } catch {}
  return fresh()
}

function Slider({ label, value, min = -100, max = 100, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label className="block" onDoubleClick={() => onChange(min < 0 ? 0 : min)} title="Double-click to reset">
      <span className="flex items-center justify-between text-[12.5px]">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className={cx('tabular-nums', value ? 'font-bold text-primary-700' : 'text-slate-400')}>{value > 0 && min < 0 ? `+${Math.round(value)}` : Math.round(value)}</span>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 h-2 w-full cursor-pointer accent-[#0090CA]" />
    </label>
  )
}

function Switch({ on, label, sub, onChange }: { on: boolean; label: string; sub?: string; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
      <span>
        <span className="block text-[13px] font-semibold">{label}</span>
        {sub && <span className="block text-[11.5px] text-slate-500">{sub}</span>}
      </span>
      <input type="checkbox" className="size-5 shrink-0 accent-[#0090CA]" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const Group = ({ children }: { children: React.ReactNode }) => <div className="pt-1 text-[11px] font-bold uppercase tracking-[.06em] text-slate-400">{children}</div>

export function ImageEditor({
  initial,
  initialUrl,
  title = 'Picture',
  autoPaste = false,
  queue,
  onUse,
  onCancel,
}: {
  initial?: File | null
  initialUrl?: string | null
  title?: string
  autoPaste?: boolean
  /** several pictures in a row: "Picture 2 of 5", Skip, and "same look for all remaining" */
  queue?: File[]
  onUse: (f: File) => void | Promise<void>
  onCancel: () => void
}) {
  const toast = useToast()
  const [qi, setQi] = useState(0)
  const [base, setBase] = useState<HTMLImageElement | null>(null)
  const [rot, setRot] = useState(0)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [square, setSquare] = useState(true)
  const [tab, setTab] = useState<Tab>('filters')
  const [s, setS] = useState<Settings>(fresh)
  const sRef = useRef(s)
  sRef.current = s
  const past = useRef<Settings[]>([])
  const future = useRef<Settings[]>([])
  const lastPush = useRef(0)
  const [split, setSplit] = useState<number | null>(null) // before / after divider 0..1
  const [brush, setBrush] = useState<null | { bg: boolean; size: number }>(null)
  const [busy, setBusy] = useState<null | 'use' | 'all'>(null)
  const stage = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [box, setBox] = useState({ w: 520, h: 420 })

  useEffect(() => setS(savedLook()), [])

  /** change the settings with undo history (a slider drag within 600 ms is one step) */
  const update = useCallback((fn: (x: Settings) => Settings) => {
    const cur = sRef.current
    if (Date.now() - lastPush.current > 600) past.current = [...past.current.slice(-60), cur]
    lastPush.current = Date.now()
    future.current = []
    setS(fn(cur))
  }, [])
  const adj = (k: keyof Adjust, v: number) => update((x) => ({ ...x, adjust: { ...x.adjust, [k]: v } }))
  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(s)
    lastPush.current = 0
    setS(prev)
  }
  const redo = () => {
    const nx = future.current.pop()
    if (!nx) return
    past.current.push(s)
    lastPush.current = 0
    setS(nx)
  }

  const take = useCallback(
    async (f: File | string) => {
      try {
        const url = typeof f === 'string' ? f : URL.createObjectURL(f)
        setBase(await loadImage(url))
        setRot(0)
        setSplit(null)
        setS((x) => ({ ...x, bg: { ...x.bg, strokes: [] } }))
      } catch (e: any) {
        toast(e.message, 'err')
      }
    },
    [toast],
  )
  useEffect(() => {
    if (queue?.length) take(queue[0])
    else if (initial) take(initial)
    else if (initialUrl) take(initialUrl)
    if (autoPaste) void paste()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { over, dropProps } = usePasteFiles((files) => files[0] && take(files[0]), { accept: ['image/*'] })

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: Math.max(160, el.clientWidth - 24), h: Math.max(160, el.clientHeight - 24) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') (e.preventDefault(), e.shiftKey ? redo() : undo())
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') (e.preventDefault(), redo())
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // the upright photo for the rotation; the crop starts as the largest centred square
  const src = useMemo(() => (base ? upright(base, rot) : null), [base, rot])
  useEffect(() => {
    if (!src) return
    const side = Math.min(src.width, src.height)
    setCrop(square ? { x: (src.width - side) / 2, y: (src.height - side) / 2, w: side, h: side } : { x: 0, y: 0, w: src.width, h: src.height })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])
  // preview source: the crop (re-made only when the crop changes, not on every slider move)
  const [settledCrop, setSettledCrop] = useState<Rect | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setSettledCrop(crop), 120)
    return () => clearTimeout(t)
  }, [crop])
  // sized to the screen (≤ 560 px; ~360 px on a phone) so sliders stay smooth on slower phones
  const previewPx = Math.min(560, Math.max(320, box.w, box.h))
  const previewSrc = useMemo(() => (src && settledCrop ? cropTo(src, settledCrop, previewPx) : null), [src, settledCrop, previewPx])
  const original = useMemo(() => (previewSrc && split != null ? previewSrc.toDataURL('image/jpeg', 0.85) : ''), [previewSrc, split])

  // live preview — while brushing, without the studio square so strokes land where you paint
  const look = useMemo(() => (brush ? { ...s, studio: { ...s.studio, pad: false, shadow: false, rounded: false, watermark: false } } : s), [s, brush])
  const [shown, setShown] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!previewSrc || tab === 'crop') return
    const raf = requestAnimationFrame(() => {
      const c = view.current
      if (!c) return
      const out = render(previewSrc, look, { small: true })
      c.width = out.width
      c.height = out.height
      c.getContext('2d')!.drawImage(out, 0, 0)
      setShown((p) => (p?.w === out.width && p?.h === out.height ? p : { w: out.width, h: out.height }))
    })
    return () => cancelAnimationFrame(raf)
  }, [previewSrc, look, tab])

  // colourful filter thumbnails of this very photo
  const thumbs = useMemo(() => {
    const out: Partial<Record<PresetKey, string>> = {}
    if (!previewSrc || tab !== 'filters') return out
    const small = cropTo(previewSrc, null, 96)
    for (const k of Object.keys(PRESETS) as PresetKey[]) out[k] = render(small, { ...fresh(), preset: k, bg: { ...fresh().bg, mode: s.bg.mode, color: s.bg.color, tolerance: s.bg.tolerance } }, { small: true }).toDataURL('image/jpeg', 0.8)
    return out
  }, [previewSrc, tab, s.bg.mode, s.bg.color, s.bg.tolerance])

  // ---------------------------------------------------------------- crop box
  const cropScale = src ? Math.min(box.w / src.width, box.h / src.height) : 1
  const cropUrl = useMemo(() => (src && tab === 'crop' ? src.toDataURL('image/jpeg', 0.82) : ''), [src, tab])
  const drag = useRef<null | { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; sx: number; sy: number; r: Rect }>(null)
  function down(mode: 'move' | 'nw' | 'ne' | 'sw' | 'se', e: React.PointerEvent) {
    if (!crop) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r: { ...crop } }
  }
  function moveCrop(e: React.PointerEvent) {
    const g = drag.current
    if (!g || !src) return
    const dx = (e.clientX - g.sx) / cropScale
    const dy = (e.clientY - g.sy) / cropScale
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
      const ax = west ? x + w : x // the opposite corner stays put
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

  // ---------------------------------------------------------------- brush (paint to background / restore the item)
  const painting = useRef(false)
  function paint(e: React.PointerEvent) {
    if (!brush || !view.current) return
    const r = view.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    if (x < 0 || y < 0 || x > 1 || y > 1) return
    const stroke = { x, y, r: brush.size / 400, bg: brush.bg }
    update((cur) => ({ ...cur, bg: { ...cur.bg, mode: cur.bg.mode === 'keep' ? 'white' : cur.bg.mode, strokes: [...cur.bg.strokes, stroke].slice(-500) } }))
  }

  // ---------------------------------------------------------------- actions
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
  const remember = () => {
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify({ ...s, bg: { ...s.bg, strokes: [] } }))
    } catch {}
  }
  async function exportFile(): Promise<File> {
    const out = render(cropTo(src!, crop, 1600), s)
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/webp', 0.95))
    if (!blob) throw new Error('Could not make the picture')
    return new File([blob], 'item.webp', { type: 'image/webp' })
  }
  const total = queue?.length ?? 1
  const more = !!queue && qi + 1 < queue.length
  async function next() {
    if (queue && qi + 1 < queue.length) {
      setQi(qi + 1)
      await take(queue[qi + 1])
    } else onCancel()
  }
  async function use() {
    if (!src) return
    setBusy('use')
    try {
      remember()
      await onUse(await exportFile())
      if (queue?.length) await next()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function useAll() {
    if (!queue || !src) return
    setBusy('all')
    try {
      remember()
      await onUse(await exportFile())
      for (let i = qi + 1; i < queue.length; i++) {
        setQi(i)
        await onUse(await processFile(queue[i], s, { rot, square }))
      }
      toast(`${queue.length - qi} pictures saved with the same look`, 'ok')
      onCancel()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  // ---------------------------------------------------------------- tool panels
  const panel = (
    <div className="flex flex-col gap-3">
      {tab === 'crop' && (
        <>
          <Switch
            on={square}
            label="Square crop"
            sub="The same shape on every card"
            onChange={(v) => {
              setSquare(v)
              if (v && crop) {
                const side = Math.min(crop.w, crop.h)
                setCrop({ ...crop, w: side, h: side })
              }
            }}
          />
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" className={btnClass('o', 'sm')} disabled={!src} onClick={() => setRot((r) => (r + 270) % 360)} title="Rotate left">
              <RotateCcw size={15} /> Left
            </button>
            <button type="button" className={btnClass('o', 'sm')} disabled={!src} onClick={() => setRot((r) => (r + 90) % 360)} title="Rotate right">
              <RotateCw size={15} /> Right
            </button>
            <button type="button" className={btnClass('o', 'sm')} disabled={!src || square} onClick={() => src && setCrop({ x: 0, y: 0, w: src.width, h: src.height })}>
              Whole
            </button>
          </div>
          <div className="text-[12px] text-slate-500">Drag the box to move it, the round handles to resize it.</div>
        </>
      )}
      {tab === 'filters' && (
        <>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-3">
            {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => update((x) => ({ ...x, preset: k, intensity: x.preset === k ? x.intensity : 100 }))}
                className={cx('group flex flex-col items-center gap-1 rounded-xl p-1 transition', s.preset === k ? 'bg-primary-50 ring-2 ring-primary' : 'hover:bg-slate-50')}
              >
                <span className="relative block aspect-square w-full overflow-hidden rounded-lg ring-1 ring-slate-200" style={{ background: PRESETS[k].swatch }}>
                  {thumbs[k] && <img src={thumbs[k]} alt="" className="size-full object-cover transition group-hover:scale-105" />}
                  <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: PRESETS[k].swatch }} />
                </span>
                <span className={cx('truncate text-[11.5px] font-semibold', s.preset === k ? 'text-primary-700' : 'text-slate-600')}>{PRESETS[k].label}</span>
              </button>
            ))}
          </div>
          {s.preset !== 'original' && <Slider label={`${PRESETS[s.preset].label} · intensity %`} value={s.intensity} min={0} max={100} onChange={(v) => update((x) => ({ ...x, intensity: v }))} />}
        </>
      )}
      {tab === 'adjust' && (
        <>
          <button type="button" className={btnClass(s.wb ? 'p' : 'o', 'sm')} onClick={() => update((x) => ({ ...x, wb: !x.wb }))}>
            <Wand2 size={14} /> Auto white balance{s.wb ? ' · on' : ''}
          </button>
          <Group>Light</Group>
          <Slider label="Exposure" value={s.adjust.exposure} onChange={(v) => adj('exposure', v)} />
          <Slider label="Brightness" value={s.adjust.brightness} onChange={(v) => adj('brightness', v)} />
          <Slider label="Contrast" value={s.adjust.contrast} onChange={(v) => adj('contrast', v)} />
          <Slider label="Highlights" value={s.adjust.highlights} onChange={(v) => adj('highlights', v)} />
          <Slider label="Shadows" value={s.adjust.shadows} onChange={(v) => adj('shadows', v)} />
          <Group>Colour</Group>
          <Slider label="Saturation" value={s.adjust.saturation} onChange={(v) => adj('saturation', v)} />
          <Slider label="Vibrance" value={s.adjust.vibrance} onChange={(v) => adj('vibrance', v)} />
          <Slider label="Warmth" value={s.adjust.warmth} onChange={(v) => adj('warmth', v)} />
          <Slider label="Tint" value={s.adjust.tint} onChange={(v) => adj('tint', v)} />
          <Slider label="Fade" value={s.adjust.fade} min={0} onChange={(v) => adj('fade', v)} />
          <Group>Detail</Group>
          <Slider label="Sharpness" value={s.adjust.sharpness} min={0} onChange={(v) => adj('sharpness', v)} />
          <Slider label="Clarity" value={s.adjust.clarity} onChange={(v) => adj('clarity', v)} />
          <Slider label="Smooth (denoise)" value={s.adjust.denoise} min={0} onChange={(v) => adj('denoise', v)} />
          <Slider label="Vignette" value={s.adjust.vignette} min={0} onChange={(v) => adj('vignette', v)} />
          <button type="button" className="self-start text-[12px] font-semibold text-slate-500 hover:underline" onClick={() => update((x) => ({ ...x, adjust: { ...ZERO }, wb: false }))}>
            Reset all sliders
          </button>
        </>
      )}
      {tab === 'background' && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['keep', 'Keep as is'],
                ['white', 'Pure white'],
                ['color', 'Colour'],
                ['gradient', 'Studio gradient'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => update((x) => ({ ...x, bg: { ...x.bg, mode: k } }))} className={cx('h-10 rounded-lg border text-[12.5px] font-semibold', s.bg.mode === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700')}>
                {l}
              </button>
            ))}
          </div>
          {s.bg.mode === 'color' && (
            <div className="flex flex-wrap items-center gap-2">
              {BG_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => update((x) => ({ ...x, bg: { ...x.bg, color: c } }))} className={cx('size-8 rounded-full ring-1 ring-slate-300', s.bg.color === c && 'ring-2 ring-primary ring-offset-2')} style={{ background: c }} aria-label={`Background ${c}`} />
              ))}
              <input type="color" value={s.bg.color} onChange={(e) => update((x) => ({ ...x, bg: { ...x.bg, color: e.target.value } }))} className="h-8 w-10 cursor-pointer rounded-md" aria-label="Any colour" />
            </div>
          )}
          <Slider label="Strength %" value={s.bg.strength} min={0} max={100} onChange={(v) => update((x) => ({ ...x, bg: { ...x.bg, strength: v } }))} />
          <Slider label="Tolerance (how much counts as background)" value={s.bg.tolerance} min={5} max={100} onChange={(v) => update((x) => ({ ...x, bg: { ...x.bg, tolerance: v } }))} />
          <div className="rounded-lg bg-slate-50 p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
              <Brush size={14} /> Brush
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" onClick={() => setBrush(brush?.bg ? null : { bg: true, size: brush?.size ?? 24 })} className={btnClass(brush?.bg ? 'p' : 'o', 'sm')}>
                Erase
              </button>
              <button type="button" onClick={() => setBrush(brush && !brush.bg ? null : { bg: false, size: brush?.size ?? 24 })} className={btnClass(brush && !brush.bg ? 'p' : 'o', 'sm')}>
                Restore
              </button>
              <button type="button" disabled={!s.bg.strokes.length} onClick={() => update((x) => ({ ...x, bg: { ...x.bg, strokes: [] } }))} className={btnClass('o', 'sm')}>
                Clear
              </button>
            </div>
            {brush && (
              <div className="mt-2">
                <Slider label="Brush size" value={brush.size} min={4} max={80} onChange={(v) => setBrush({ ...brush, size: v })} />
              </div>
            )}
            <div className="mt-1.5 text-[11.5px] text-slate-500">{brush ? (brush.bg ? 'Paint over spots that should be background.' : 'Paint over parts of the item that were wiped.') : 'Fix spots the automatic background missed.'}</div>
          </div>
        </>
      )}
      {tab === 'studio' && (
        <>
          <Switch on={s.studio.pad} label="Centre on a square" sub="The item in the middle, the same margin on every picture" onChange={(v) => update((x) => ({ ...x, studio: { ...x.studio, pad: v } }))} />
          {s.studio.pad && <Slider label="Margin %" value={s.studio.margin} min={0} max={30} onChange={(v) => update((x) => ({ ...x, studio: { ...x.studio, margin: v } }))} />}
          <Switch on={s.studio.shadow} label="Soft product shadow" sub="A light contact shadow under the item" onChange={(v) => update((x) => ({ ...x, studio: { ...x.studio, shadow: v } }))} />
          <Switch on={s.studio.rounded} label="Rounded corners" onChange={(v) => update((x) => ({ ...x, studio: { ...x.studio, rounded: v } }))} />
          <Switch on={s.studio.watermark} label="Unico HomeCare watermark" sub="Small text in the corner" onChange={(v) => update((x) => ({ ...x, studio: { ...x.studio, watermark: v } }))} />
        </>
      )}
    </div>
  )

  const fitShown = shown ? Math.min(box.w / shown.w, box.h / shown.h, 1.6) : 1

  // ---------------------------------------------------------------- layout
  return createPortal(
    <div className="fixed inset-0 z-[90] flex bg-slate-900/70 md:items-center md:justify-center md:p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-white md:h-[min(860px,96dvh)] md:max-w-[1120px] md:rounded-2xl md:shadow-drawer">
        {/* top bar */}
        <div className="flex items-center gap-1 border-b border-slate-100 px-2.5 py-2">
          <button type="button" onClick={onCancel} className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={19} />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-[14.5px] font-bold">{title}</div>
            <div className="truncate text-[11.5px] font-semibold text-primary-700">
              {total > 1 ? `Picture ${qi + 1} of ${total} · ` : ''}
              {PRESETS[s.preset].label}
              {s.bg.mode !== 'keep' ? ` · ${s.bg.mode === 'color' ? 'colour' : s.bg.mode} background` : ''}
            </div>
          </div>
          <button type="button" onClick={undo} disabled={!past.current.length} className="flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30" title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 size={18} />
          </button>
          <button type="button" onClick={redo} disabled={!future.current.length} className="flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30" title="Redo (Ctrl+Y)" aria-label="Redo">
            <Redo2 size={18} />
          </button>
          <button
            type="button"
            onClick={() => (setSplit(split == null ? 0.5 : null), setBrush(null))}
            disabled={tab === 'crop' || !src}
            className={cx('flex size-10 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30', split != null ? 'bg-primary-50 text-primary-700' : 'text-slate-600')}
            title="Before ↔ after"
            aria-label="Compare before and after"
          >
            <SplitSquareHorizontal size={18} />
          </button>
          <button type="button" onClick={() => update(fresh)} className="h-10 rounded-lg px-2 text-[12.5px] font-semibold text-slate-500 hover:bg-slate-100">
            Reset
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[1fr_340px]">
          {/* canvas */}
          <div
            ref={stage}
            {...(dropProps as any)}
            className={cx('relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] [background-size:18px_18px]', over && 'ring-2 ring-inset ring-primary')}
          >
            {!src ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center text-[13px] text-slate-500">
                <ImagePlus size={34} className="text-slate-400" />
                Choose a photo, paste a copied picture (Ctrl+V) or drop one here
                <div className="flex gap-2">
                  <button type="button" className={btnClass('p', 'sm')} onClick={() => pick.current?.click()}>
                    <ImagePlus size={14} /> Choose / camera
                  </button>
                  <button type="button" className={btnClass('o', 'sm')} onClick={paste}>
                    <Clipboard size={14} /> Paste
                  </button>
                </div>
              </div>
            ) : tab === 'crop' && crop ? (
              <div className="relative touch-none select-none" style={{ width: src.width * cropScale, height: src.height * cropScale }} onPointerMove={moveCrop} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
                <img src={cropUrl} alt="" className="pointer-events-none absolute inset-0 size-full" draggable={false} />
                <div
                  className="pointer-events-none absolute inset-0 bg-black/45"
                  style={{
                    clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${crop.x * cropScale}px ${crop.y * cropScale}px,${crop.x * cropScale}px ${(crop.y + crop.h) * cropScale}px,${(crop.x + crop.w) * cropScale}px ${(crop.y + crop.h) * cropScale}px,${(crop.x + crop.w) * cropScale}px ${crop.y * cropScale}px,${crop.x * cropScale}px ${crop.y * cropScale}px)`,
                  }}
                />
                <div className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left: crop.x * cropScale, top: crop.y * cropScale, width: crop.w * cropScale, height: crop.h * cropScale }} onPointerDown={(e) => down('move', e)}>
                  <span className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }, (_, i) => (
                      <span key={i} className="border border-white/25" />
                    ))}
                  </span>
                  {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
                    <span
                      key={k}
                      onPointerDown={(e) => down(k, e)}
                      className={cx('absolute size-7 rounded-full border-2 border-white bg-primary shadow md:size-6', k[0] === 'n' ? '-top-3.5 md:-top-3' : '-bottom-3.5 md:-bottom-3', k[1] === 'w' ? '-left-3.5 md:-left-3' : '-right-3.5 md:-right-3', k === 'nw' || k === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div
                className={cx('relative touch-none select-none', brush && 'cursor-crosshair', split != null && !brush && 'cursor-ew-resize')}
                style={shown ? { width: shown.w * fitShown, height: shown.h * fitShown } : undefined}
                onPointerDown={(e) => {
                  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                  painting.current = true
                  if (brush) paint(e)
                }}
                onPointerMove={(e) => {
                  if (!painting.current) return
                  if (brush) paint(e)
                  else if (split != null) {
                    const r = e.currentTarget.getBoundingClientRect()
                    setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
                  }
                }}
                onPointerUp={() => (painting.current = false)}
                onPointerCancel={() => (painting.current = false)}
              >
                <canvas ref={view} className="block size-full rounded-md shadow-sm" />
                {split != null && !brush && original && (
                  <>
                    <img src={original} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full rounded-md object-contain" style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }} />
                    <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]" style={{ left: `${split * 100}%` }}>
                      <span className="absolute left-1/2 top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[13px] font-bold text-slate-600 shadow">⇆</span>
                    </div>
                    <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white">Before</span>
                    <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white">After</span>
                  </>
                )}
                {brush && <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white">{brush.bg ? 'Erase to background' : 'Restore item'}</span>}
              </div>
            )}
          </div>

          {/* tools: side panel on desktop; on phones a scrolling panel above the bottom tool tabs */}
          <div className="flex max-h-[44dvh] min-h-0 flex-col border-t border-slate-100 md:max-h-none md:border-l md:border-t-0">
            <div className="order-2 grid shrink-0 grid-cols-5 border-t border-slate-100 bg-white md:order-1 md:border-b md:border-t-0">
              {TABS.map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setTab(k)
                    if (k !== 'background') setBrush(null)
                    if (k === 'crop') setSplit(null)
                  }}
                  className={cx('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition md:h-12', tab === k ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800')}
                >
                  <Icon size={18} />
                  {label}
                  <span className={cx('h-0.5 w-6 rounded-full', tab === k ? 'bg-primary' : 'bg-transparent')} />
                </button>
              ))}
            </div>
            <div className="order-1 min-h-0 flex-1 overflow-y-auto p-3 md:order-2">{panel}</div>
          </div>
        </div>

        {/* bottom actions */}
        <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5">
          <button type="button" className={btnClass('ghost', 'sm')} onClick={() => pick.current?.click()} disabled={!!busy}>
            <ImagePlus size={14} /> <span className="hidden sm:inline">Other photo</span>
          </button>
          <button type="button" className={btnClass('ghost', 'sm', 'hidden sm:inline-flex')} onClick={paste} disabled={!!busy}>
            <Clipboard size={14} /> Paste
          </button>
          <span className="ml-auto flex items-center gap-2">
            {more && (
              <>
                <button type="button" className={btnClass('o', 'md')} disabled={!!busy} onClick={next}>
                  Skip
                </button>
                <button type="button" className={btnClass('o', 'md')} disabled={!src || !!busy} onClick={useAll} title="Use this look for this picture and every remaining one">
                  {busy === 'all' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} <span className="hidden sm:inline">Same look for</span> all {total - qi}
                </button>
              </>
            )}
            <button type="button" className={btnClass('p', 'md')} disabled={!src || !!busy} onClick={use}>
              {busy === 'use' && <Loader2 size={16} className="animate-spin" />} {more ? 'Use & next' : 'Use picture'}
            </button>
          </span>
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
    </div>,
    document.body,
  )
}
