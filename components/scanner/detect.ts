// Page edge detection. `detectLite` is built in and instant; `detectCv` uses OpenCV.js once it has loaded.
import { canvas, ctx2d, fullQuad, orderQuad, plausible, type Pt, type Quad } from './geometry'

export type Detection = { quad: Quad; ok: boolean }

function small(src: HTMLCanvasElement, max: number) {
  const s = Math.min(1, max / Math.max(src.width, src.height))
  const c = canvas(src.width * s, src.height * s)
  const g = ctx2d(c)
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c.width, c.height)
  return { c, s }
}

function boxBlur(a: Float32Array, w: number, h: number, r: number) {
  const t = new Float32Array(a.length)
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      t[y * w + x] = acc / (2 * r + 1)
      acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += t[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      a[y * w + x] = acc / (2 * r + 1)
      acc += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]
    }
  }
}

/** Otsu's threshold over 0–255 values. */
export function otsu(v: ArrayLike<number>) {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < v.length; i++) hist[Math.min(255, Math.max(0, v[i] | 0))]++
  const n = v.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let t = 127
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = n - wB
    if (!wF) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      t = i
    }
  }
  return t
}

/**
 * Built-in detector (no download): blur → Otsu split → largest paper-like region → its four extreme corners.
 * Works best for a light page on a darker surface; anything doubtful returns the full photo with ok=false.
 */
export function detectLite(src: HTMLCanvasElement): Detection {
  const full = { quad: fullQuad(src.width, src.height), ok: false }
  try {
    const { c, s } = small(src, 360)
    const w = c.width
    const h = c.height
    const px = ctx2d(c).getImageData(0, 0, w, h).data
    const g = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
    boxBlur(g, w, h, 2)
    const t = otsu(g)
    let best: Detection | null = null
    let bestScore = 0
    // try the bright side first (white paper), then the dark side (dark page on a white table)
    for (const bright of [true, false]) {
      const mask = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) mask[i] = (bright ? g[i] > t : g[i] <= t) ? 1 : 0
      // one erosion pass cuts thin bridges between the page and bright clutter around it
      const er = new Uint8Array(w * h)
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        er[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - w] & mask[i + w]
      }
      const comp = largestComponent(er, w, h)
      if (!comp) continue
      const touches = +(comp.minX <= 1) + +(comp.minY <= 1) + +(comp.maxX >= w - 2) + +(comp.maxY >= h - 2)
      if (touches >= 4) continue // that is the background, not a page
      const q = orderQuad(comp.corners)
      if (!plausible(q, w, h)) continue
      const fill = comp.size / quadAreaOf(q)
      if (fill < 0.8) continue // region is not quadrilateral-shaped
      const score = comp.size * fill * (bright ? 1.15 : 1)
      if (score > bestScore) {
        bestScore = score
        best = { quad: q.map((p) => ({ x: p.x / s, y: p.y / s })) as Quad, ok: true }
      }
    }
    return best ?? full
  } catch {
    return full
  }
}

const quadAreaOf = (q: Quad) => Math.abs(q.reduce((a, p, i) => a + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2

function largestComponent(m: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let best: { size: number; minX: number; minY: number; maxX: number; maxY: number; corners: Pt[] } | null = null
  for (let start = 0; start < w * h; start++) {
    if (!m[start] || seen[start]) continue
    let sp = 0
    stack[sp++] = start
    seen[start] = 1
    let size = 0
    let minX = w, minY = h, maxX = 0, maxY = 0
    let tl = start, tr = start, br = start, bl = start
    let vTl = Infinity, vTr = -Infinity, vBr = -Infinity, vBl = -Infinity
    while (sp) {
      const i = stack[--sp]
      const x = i % w
      const y = (i / w) | 0
      size++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x + y < vTl) (vTl = x + y), (tl = i)
      if (x + y > vBr) (vBr = x + y), (br = i)
      if (x - y > vTr) (vTr = x - y), (tr = i)
      if (y - x > vBl) (vBl = y - x), (bl = i)
      if (x > 0 && m[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[sp++] = i - 1)
      if (x < w - 1 && m[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[sp++] = i + 1)
      if (y > 0 && m[i - w] && !seen[i - w]) (seen[i - w] = 1), (stack[sp++] = i - w)
      if (y < h - 1 && m[i + w] && !seen[i + w]) (seen[i + w] = 1), (stack[sp++] = i + w)
    }
    if (!best || size > best.size) {
      const pt = (i: number): Pt => ({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 })
      best = { size, minX, minY, maxX, maxY, corners: [pt(tl), pt(tr), pt(br), pt(bl)] }
    }
  }
  return best
}

/** OpenCV detector: Canny edges → largest convex 4-point contour (falls back to the min-area rectangle). */
export function detectCv(cv: any, src: HTMLCanvasElement): Detection {
  const full = { quad: fullQuad(src.width, src.height), ok: false }
  const { c, s } = small(src, 500)
  const W = c.width
  const H = c.height
  const mats: any[] = []
  const m = <T,>(x: T) => (mats.push(x), x)
  try {
    const img = m(cv.imread(c))
    const gray = m(new cv.Mat())
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    const edges = m(new cv.Mat())
    cv.Canny(gray, edges, 40, 130)
    const kernel = m(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)))
    cv.dilate(edges, edges, kernel)
    const contours = m(new cv.MatVector())
    const hier = m(new cv.Mat())
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
    let bestQuad: Quad | null = null
    let bestArea = 0
    let bigIdx = -1
    let bigArea = 0
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const area = cv.contourArea(cnt)
      if (area > bigArea) (bigArea = area), (bigIdx = i)
      if (area > 0.15 * W * H) {
        const approx = new cv.Mat()
        cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true)
        if (approx.rows === 4 && cv.isContourConvex(approx) && area > bestArea) {
          const d = approx.data32S
          const q = orderQuad([0, 1, 2, 3].map((k) => ({ x: d[k * 2], y: d[k * 2 + 1] })))
          if (plausible(q, W, H)) (bestQuad = q), (bestArea = area)
        }
        approx.delete()
      }
      cnt.delete()
    }
    if (!bestQuad && bigIdx >= 0 && bigArea > 0.2 * W * H) {
      const cnt = contours.get(bigIdx)
      const rect = cv.minAreaRect(cnt)
      const pts: Pt[] = cv.RotatedRect.points(rect)
      cnt.delete()
      const q = orderQuad(pts.map((p) => ({ x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) })))
      if (plausible(q, W, H)) bestQuad = q
    }
    if (!bestQuad) return full
    return { quad: bestQuad.map((p) => ({ x: p.x / s, y: p.y / s })) as Quad, ok: true }
  } catch {
    return full
  } finally {
    for (const x of mats) try { x.delete() } catch {}
  }
}

// ---------------------------------------------------------------- OpenCV loader
const CV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js'
let loading: Promise<{ cv: any } | null> | null = null

/** Load OpenCV.js once (≈10 MB, cached by the browser afterwards). Resolves null on failure or after `timeoutMs`. */
export function loadOpenCV(timeoutMs = 30_000): Promise<{ cv: any } | null> {
  if (loading) return loading
  loading = new Promise((resolve) => {
    let settled = false
    // resolve with a wrapper: the Emscripten module can be "thenable", which would make a Promise unwrap it forever
    const done = (cv: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(cv?.Mat ? { cv } : null)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    const w = window as any
    const ready = (c: any) => {
      if (!c) return done(null)
      if (c.Mat) return done(c) // embind classes exist only once the runtime is up
      if (typeof c.then === 'function') return void c.then((mod: any) => ready(mod), () => done(null))
      c.onRuntimeInitialized = () => done(c)
    }
    if (w.cv) return ready(w.cv) // an earlier attempt's script finished after its timeout
    const s = document.createElement('script')
    s.src = CV_URL
    s.async = true
    s.crossOrigin = 'anonymous'
    s.onload = () => ready(w.cv)
    s.onerror = () => done(null)
    document.head.appendChild(s)
  })
  loading.then((r) => {
    if (!r) loading = null // allow a retry next time the scanner opens
  })
  return loading
}
