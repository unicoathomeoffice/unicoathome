'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Pt, Quad } from './geometry'

const PAD = 28
const LOUPE = 120
const ZOOM = 2.5

/** The photo with the page outline; drag any corner (a magnifier shows the exact spot under the finger). */
export function CropView({ src, quad, onChange }: { src: HTMLCanvasElement; quad: Quad; onChange: (q: Quad) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const loupe = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState<{ i: number; p: Pt } | null>(null)

  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = src.width
  const H = src.height
  const scale = size.w && size.h ? Math.min((size.w - PAD * 2) / W, (size.h - PAD * 2) / H) : 0
  const ox = (size.w - W * scale) / 2
  const oy = (size.h - H * scale) / 2
  const toView = (p: Pt) => ({ x: ox + p.x * scale, y: oy + p.y * scale })

  useEffect(() => {
    const c = view.current
    if (!c || !scale) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.imageSmoothingQuality = 'high'
    g.clearRect(0, 0, size.w, size.h)
    g.drawImage(src, ox, oy, W * scale, H * scale)
  }, [src, size, scale, ox, oy, W, H])

  useEffect(() => {
    const c = loupe.current
    if (!c || !drag) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = LOUPE * dpr
    c.height = LOUPE * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const r = LOUPE / 2 / (scale * ZOOM)
    g.fillStyle = '#0f172a'
    g.fillRect(0, 0, LOUPE, LOUPE)
    g.drawImage(src, drag.p.x - r, drag.p.y - r, r * 2, r * 2, 0, 0, LOUPE, LOUPE)
    g.strokeStyle = '#0090CA'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(LOUPE / 2, LOUPE / 2 - 14)
    g.lineTo(LOUPE / 2, LOUPE / 2 + 14)
    g.moveTo(LOUPE / 2 - 14, LOUPE / 2)
    g.lineTo(LOUPE / 2 + 14, LOUPE / 2)
    g.stroke()
  }, [drag, src, scale])

  function pointAt(e: React.PointerEvent): Pt {
    const r = box.current!.getBoundingClientRect()
    return {
      x: Math.min(W, Math.max(0, (e.clientX - r.left - ox) / scale)),
      y: Math.min(H, Math.max(0, (e.clientY - r.top - oy) / scale)),
    }
  }
  function move(e: React.PointerEvent) {
    if (!drag) return
    const p = pointAt(e)
    const q = [...quad] as Quad
    q[drag.i] = p
    onChange(q)
    setDrag({ i: drag.i, p })
  }

  const v = quad.map(toView)
  const poly = v.map((p) => `${p.x},${p.y}`).join(' ')
  // magnifier sits in the top corner away from the finger
  const loupeLeft = drag ? toView(drag.p).x > size.w / 2 : true

  return (
    <div ref={box} className="relative h-full w-full touch-none select-none overflow-hidden">
      <canvas ref={view} className="absolute inset-0 size-full" />
      {scale > 0 && (
        <svg width={size.w} height={size.h} className="absolute inset-0" onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
          <path d={`M0 0H${size.w}V${size.h}H0Z M${poly.split(' ').join(' L')}Z`} fill="rgba(15,23,42,.55)" fillRule="evenodd" />
          <polygon points={poly} fill="rgba(0,144,202,.08)" stroke="#0090CA" strokeWidth={2.5} strokeLinejoin="round" />
          {v.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={drag?.i === i ? 15 : 12} fill="rgba(255,255,255,.25)" stroke="#fff" strokeWidth={3} />
              <circle
                cx={p.x}
                cy={p.y}
                r={26}
                fill="transparent"
                className="cursor-grab"
                aria-label={['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'][i]}
                onPointerDown={(e) => {
                  e.preventDefault()
                  ;(e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture(e.pointerId)
                  setDrag({ i, p: quad[i] })
                }}
              />
            </g>
          ))}
        </svg>
      )}
      {drag && <canvas ref={loupe} style={{ width: LOUPE, height: LOUPE }} className={`pointer-events-none absolute top-3 rounded-full shadow-lg ring-4 ring-white ${loupeLeft ? 'left-3' : 'right-3'}`} />}
    </div>
  )
}
