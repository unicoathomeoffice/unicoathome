// Page geometry for the document scanner: corner quads, perspective warp, rotation. Pure browser JS (canvas).

export type Pt = { x: number; y: number }
/** Page corners in source-image pixels, clockwise from top-left: [tl, tr, br, bl]. */
export type Quad = [Pt, Pt, Pt, Pt]

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!

/** Decode a photo (EXIF orientation applied) into a canvas whose long side is at most `max` px. */
export async function loadSource(file: Blob, max = 2400): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = canvas(bmp.width * s, bmp.height * s)
  const g = ctx2d(c)
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close?.()
  return c
}

export const fullQuad = (w: number, h: number): Quad => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
]

/** Put four arbitrary points in [tl, tr, br, bl] order. */
export function orderQuad(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  // atan2 order runs from the left side clockwise (screen coords): rotate so the point nearest the top-left comes first
  let start = 0
  for (let i = 1; i < 4; i++) if (byAngle[i].x + byAngle[i].y < byAngle[start].x + byAngle[start].y) start = i
  return [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]) as Quad
}

export const quadArea = (q: Quad) => Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2

/** A detected quad is believable when it covers 15–98 % of the photo, is convex and has no extreme angles. */
export function plausible(q: Quad, w: number, h: number) {
  const a = quadArea(q) / (w * h)
  if (a < 0.15 || a > 0.985) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const p = q[i]
    const n = q[(i + 1) % 4]
    const m = q[(i + 3) % 4]
    const v1 = { x: m.x - p.x, y: m.y - p.y }
    const v2 = { x: n.x - p.x, y: n.y - p.y }
    const cross = v1.x * v2.y - v1.y * v2.x
    const s = Math.sign(cross)
    if (!s || (sign && s !== sign)) return false
    sign = s
    const ang = (Math.acos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)) * 180) / Math.PI
    if (ang < 40 || ang > 140) return false
  }
  return true
}

/** Rotate a canvas 90° clockwise (and the quad with it). */
export function rotateCw(src: HTMLCanvasElement, q: Quad): { src: HTMLCanvasElement; quad: Quad } {
  const c = canvas(src.height, src.width)
  const g = ctx2d(c)
  g.translate(c.width, 0)
  g.rotate(Math.PI / 2)
  g.drawImage(src, 0, 0)
  const r = (p: Pt): Pt => ({ x: src.height - p.y, y: p.x })
  return { src: c, quad: [r(q[3]), r(q[0]), r(q[1]), r(q[2])] }
}

/** Solve the 8 homography coefficients mapping (u,v) → (x,y) for four point pairs. */
function homography(from: Pt[], to: Pt[]) {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i]
    const { x, y } = to[i]
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x])
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y])
  }
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    const d = A[c][c] || 1e-12
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / d
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  return A.map((row, i) => row[8] / (row[i] || 1e-12))
}

/** Flatten the page inside `q` into an upright rectangle (perspective correction), long side ≤ maxSide. */
export function warp(src: HTMLCanvasElement, q: Quad, maxSide = 2000): HTMLCanvasElement {
  let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]))
  let H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]))
  const s = Math.min(1, maxSide / Math.max(W, H))
  W = Math.max(8, Math.round(W * s))
  H = Math.max(8, Math.round(H * s))
  const h = homography(fullQuad(W, H), q)
  const sw = src.width
  const sh = src.height
  const sd = ctx2d(src).getImageData(0, 0, sw, sh).data
  const out = canvas(W, H)
  const og = ctx2d(out)
  const img = og.createImageData(W, H)
  const od = img.data
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const z = h[6] * u + h[7] * v + 1
      let x = (h[0] * u + h[1] * v + h[2]) / z
      let y = (h[3] * u + h[4] * v + h[5]) / z
      x = Math.min(sw - 1.001, Math.max(0, x))
      y = Math.min(sh - 1.001, Math.max(0, y))
      const x0 = x | 0
      const y0 = y | 0
      const fx = x - x0
      const fy = y - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + sw * 4
      const i11 = i01 + 4
      const o = (v * W + u) * 4
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx
        const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx
        od[o + c] = top + (bot - top) * fy
      }
      od[o + 3] = 255
    }
  }
  og.putImageData(img, 0, 0)
  return out
}

export function toBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the page'))), type, quality))
}
