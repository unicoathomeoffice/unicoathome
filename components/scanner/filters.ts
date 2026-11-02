// Document filters for a flattened page. Every filter except Original first evens out the lighting (shadows,
// yellow bulb light) by dividing each pixel by an estimate of the bare paper behind it.
import { canvas, ctx2d } from './geometry'
import { otsu } from './detect'

export type FilterId = 'original' | 'magic' | 'gray' | 'bw'

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'magic', label: 'Magic colour' },
  { id: 'gray', label: 'Grayscale' },
  { id: 'bw', label: 'B&W' },
]

/** Paper colour behind every pixel: shrink the page, dilate so text disappears, then blur back up. */
function background(src: HTMLCanvasElement) {
  const W = src.width
  const H = src.height
  const sw = Math.max(4, Math.round(W / 24))
  const sh = Math.max(4, Math.round(H / 24))
  const sm = canvas(sw, sh)
  const g = ctx2d(sm)
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, sw, sh)
  const img = g.getImageData(0, 0, sw, sh)
  let a = img.data
  for (let pass = 0; pass < 2; pass++) {
    const b = new Uint8ClampedArray(a)
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const o = (y * sw + x) * 4
      for (let c = 0; c < 3; c++) {
        let m = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(sw - 1, Math.max(0, x + dx))
          const yy = Math.min(sh - 1, Math.max(0, y + dy))
          const v = a[(yy * sw + xx) * 4 + c]
          if (v > m) m = v
        }
        b[o + c] = m
      }
    }
    a = b
  }
  img.data.set(a)
  g.putImageData(img, 0, 0)
  const big = canvas(W, H)
  const bg = ctx2d(big)
  bg.imageSmoothingQuality = 'high'
  bg.filter = 'blur(6px)'
  bg.drawImage(sm, 0, 0, W, H)
  return bg.getImageData(0, 0, W, H).data
}

/** Apply a filter; returns a new canvas (Original returns the input). */
export function applyFilter(src: HTMLCanvasElement, id: FilterId): HTMLCanvasElement {
  if (id === 'original') return src
  const W = src.width
  const H = src.height
  const img = ctx2d(src).getImageData(0, 0, W, H)
  const d = img.data
  const bg = background(src)
  const n = W * H
  if (id === 'magic') {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      const r = norm(d[o], bg[o])
      const g = norm(d[o + 1], bg[o + 1])
      const b = norm(d[o + 2], bg[o + 2])
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      // a little more colour (stamps, coloured ink), then a curve that keeps paper white and darkens the ink
      d[o] = curve(l + (r - l) * 1.35)
      d[o + 1] = curve(l + (g - l) * 1.35)
      d[o + 2] = curve(l + (b - l) * 1.35)
    }
  } else {
    const lum = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const o = i * 4
      lum[i] = 0.299 * norm(d[o], bg[o]) + 0.587 * norm(d[o + 1], bg[o + 1]) + 0.114 * norm(d[o + 2], bg[o + 2])
    }
    const t = id === 'bw' ? Math.min(225, Math.max(110, otsu(lum) + 12)) : 0
    for (let i = 0; i < n; i++) {
      const v = id === 'bw' ? (lum[i] < t ? 0 : 255) : curve(lum[i])
      const o = i * 4
      d[o] = d[o + 1] = d[o + 2] = v
    }
  }
  const out = canvas(W, H)
  ctx2d(out).putImageData(img, 0, 0)
  return out
}

const norm = (v: number, b: number) => Math.min(255, (v * 255) / Math.max(b, 40))

/** Levels + gamma: anything near paper-white → 255, ink pulled darker. */
function curve(v: number) {
  const x = Math.min(1, Math.max(0, (v - 25) / (238 - 25)))
  return Math.round(Math.pow(x, 1.6) * 255)
}
