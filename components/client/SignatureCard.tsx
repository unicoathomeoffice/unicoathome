'use client'
// Account page: my e-signature — draw it or upload a photo/scan (white background removed, trimmed, PNG).
// Stamped on the car requisition, gate pass and claim forms only for actions I perform.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eraser, Loader2, PenLine, Trash2, Upload } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { useScanner } from '@/components/scanner/useScanner'

/** Make near-white pixels transparent and crop to the ink, returning a PNG blob. */
async function cleanToPng(src: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.drawImage(src, 0, 0, w, h)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const light = (d[i] + d[i + 1] + d[i + 2]) / 3
      if (d[i + 3] < 20 || light > 200) d[i + 3] = 0
      else {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  if (maxX < 0) return null
  g.putImageData(img, 0, 0)
  const pad = 6
  const cw = Math.min(w, maxX - minX + pad * 2)
  const ch = Math.min(h, maxY - minY + pad * 2)
  const out = document.createElement('canvas')
  const scale = Math.min(1, 900 / cw)
  out.width = Math.round(cw * scale)
  out.height = Math.round(ch * scale)
  out.getContext('2d')!.drawImage(c, Math.max(0, minX - pad), Math.max(0, minY - pad), cw, ch, 0, 0, out.width, out.height)
  return new Promise((res) => out.toBlob((b) => res(b), 'image/png'))
}

export function SignatureCard({ signatureId, autoSignApprover, isApprover }: { signatureId: string | null; autoSignApprover: boolean; isApprover: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const pad = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [mode, setMode] = useState<'view' | 'draw'>(signatureId ? 'view' : 'draw')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const { scan, scanner } = useScanner()
  const [approve, setApprove] = useState(autoSignApprover)

  useEffect(() => {
    if (mode !== 'draw') return
    const c = pad.current!
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const g = c.getContext('2d')!
    g.scale(ratio, ratio)
    g.lineWidth = 2.4
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = '#1F3864'
    setDirty(false)
  }, [mode])

  const pos = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: React.PointerEvent) => {
    drawing.current = true
    pad.current!.setPointerCapture(e.pointerId)
    const g = pad.current!.getContext('2d')!
    const p = pos(e)
    g.beginPath()
    g.moveTo(p.x, p.y)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const g = pad.current!.getContext('2d')!
    const p = pos(e)
    g.lineTo(p.x, p.y)
    g.stroke()
    setDirty(true)
  }
  const clear = () => {
    const c = pad.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setDirty(false)
  }

  async function upload(blob: Blob) {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', new File([blob], 'signature.png', { type: 'image/png' }))
      await api('/users/me/signature', { form })
      toast('E-signature saved', 'ok')
      setMode('view')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  async function saveDrawn() {
    const c = pad.current!
    const blob = await cleanToPng(c, c.width, c.height)
    if (!blob) return toast('Draw your signature first', 'err')
    upload(blob)
  }
  async function fromFile(picked: File | undefined) {
    if (!picked) return
    if (!/^image\//.test(picked.type)) return toast('Choose a photo or scan of your signature', 'err')
    // crop to just the signature and clean the paper first; the white background is removed below
    const f = (await scan([picked], { title: 'Crop your signature', multiPage: false, filters: ['magic', 'original', 'bw'], defaultFilter: 'magic' }))?.[0]
    if (!f) return
    const bmp = await createImageBitmap(f)
    const scale = Math.min(1, 1400 / bmp.width)
    const blob = await cleanToPng(bmp, Math.round(bmp.width * scale), Math.round(bmp.height * scale))
    if (!blob) return toast('No signature found in that image', 'err')
    upload(blob)
  }
  async function remove() {
    if (!confirm('Remove your e-signature? Forms will be left for a wet signature.')) return
    setBusy(true)
    try {
      await api('/users/me/signature', { method: 'DELETE' })
      toast('E-signature removed', 'ok')
      setMode('draw')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="flex items-center gap-2">
        <PenLine size={18} className="text-primary-700" />
        <h2 className="text-base font-bold">My e-signature</h2>
      </div>
      <p className="mt-1 text-[13px] text-slate-500">Stamped on the vehicle requisition, gate pass and claim forms — only for actions you do yourself.</p>
      {mode === 'view' && signatureId ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex h-[90px] min-w-[220px] items-center justify-center rounded-lg bg-slate-50 px-4 ring-1 ring-slate-200">
            <img src={`/api/v1/attachments/${signatureId}`} alt="My signature" className="max-h-[70px] max-w-[260px] object-contain" />
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" className={btnClass('o', 'md')} onClick={() => setMode('draw')}>
              <PenLine size={16} /> Replace
            </button>
            <button type="button" className={btnClass('o', 'md', 'text-[#B91C1C]')} disabled={busy} onClick={remove}>
              <Trash2 size={16} /> Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <canvas
            ref={pad}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => (drawing.current = false)}
            onPointerLeave={() => (drawing.current = false)}
            className="h-[150px] w-full touch-none rounded-lg bg-[repeating-linear-gradient(transparent,transparent_119px,#CBD5E1_119px,#CBD5E1_120px)] ring-1 ring-slate-300"
            aria-label="Draw your signature"
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className={btnClass('p', 'md')} disabled={busy || !dirty} onClick={saveDrawn}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <PenLine size={16} />} Save signature
            </button>
            <button type="button" className={btnClass('o', 'md')} onClick={clear}>
              <Eraser size={16} /> Clear
            </button>
            <label className={cx(btnClass('o', 'md'), 'cursor-pointer')}>
              <Upload size={16} /> Upload a photo
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => (fromFile(e.target.files?.[0]), (e.target.value = ''))} />
            </label>
            {signatureId && (
              <button type="button" className={btnClass('ghost', 'md')} onClick={() => setMode('view')}>
                Cancel
              </button>
            )}
          </div>
          <div className="mt-1.5 text-[12px] text-slate-400">Sign with your finger or mouse, or upload a photo of your signature on white paper — the background is removed automatically.</div>
        </div>
      )}
      {isApprover && signatureId && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="text-[13px]">
            <b>Sign car requisitions as Dept. Head</b>
            <div className="text-[12px] text-slate-500">You are the approver in Settings → Fleet. Your signature is added to every requisition automatically.</div>
          </div>
          <Toggle
            on={approve}
            onChange={async (v) => {
              setApprove(v)
              try {
                await api('/users/me/signature', { method: 'PATCH', body: { autoSignApprover: v } })
              } catch (e: any) {
                setApprove(!v)
                toast(e.message, 'err')
              }
            }}
            label="Sign car requisitions as Dept. Head"
          />
        </div>
      )}
      {scanner}
    </section>
  )
}
