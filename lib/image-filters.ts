// Photo studio pipeline for store item pictures (browser canvas, no libraries). One settings object describes the whole
// edit, so undo / redo, filter thumbnails and "apply to all pictures" are cheap: the pixels are rendered from it.
//   white balance → tone (exposure, brightness, contrast, highlights, shadows) → colour (saturation, vibrance, warmth,
//   tint, mono, fade) → detail (sharpen, clarity, denoise) → background (white / colour / gradient, brush) → auto levels
//   → studio (centre on a square, shadow, vignette, rounded corners, watermark)

export type Adjust = {
  exposure: number // -100..100
  brightness: number
  contrast: number
  highlights: number
  shadows: number
  saturation: number
  vibrance: number
  warmth: number
  tint: number
  sharpness: number // 0..100
  clarity: number // -100..100
  denoise: number // 0..100
  vignette: number // 0..100
  fade: number // 0..100
}
export type Stroke = { x: number; y: number; r: number; bg: boolean } // 0..1 of the cropped picture
export type Settings = {
  preset: PresetKey
  intensity: number // 0..100
  adjust: Adjust
  wb: boolean // auto white balance
  bg: { mode: 'keep' | 'white' | 'color' | 'gradient'; color: string; strength: number; tolerance: number; strokes: Stroke[] }
  studio: { pad: boolean; margin: number; shadow: boolean; rounded: boolean; watermark: boolean }
}

export const ZERO: Adjust = { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, vibrance: 0, warmth: 0, tint: 0, sharpness: 0, clarity: 0, denoise: 0, vignette: 0, fade: 0 }

type Preset = { label: string; adjust?: Partial<Adjust>; clean?: boolean; levels?: boolean; mono?: boolean; swatch: string }
export const PRESETS = {
  original: { label: 'Original', swatch: '#94a3b8' },
  auto: { label: 'Auto', levels: true, adjust: { vibrance: 15, sharpness: 20 }, swatch: '#0ea5e9' },
  clean: { label: 'Clean white', clean: true, levels: true, adjust: { sharpness: 25 }, swatch: '#e2e8f0' },
  pop: { label: 'Product pop', clean: true, levels: true, adjust: { vibrance: 40, clarity: 35, contrast: 12, sharpness: 30 }, swatch: '#f97316' },
  bright: { label: 'Bright', adjust: { exposure: 22, shadows: 25, contrast: 5 }, swatch: '#fde047' },
  vivid: { label: 'Vivid', adjust: { saturation: 30, vibrance: 25, contrast: 15 }, swatch: '#ec4899' },
  crisp: { label: 'Crisp', adjust: { contrast: 30, sharpness: 55, clarity: 30 }, swatch: '#14b8a6' },
  clinical: { label: 'Clinical', clean: true, adjust: { warmth: -18, exposure: 10, saturation: -12, sharpness: 20 }, swatch: '#60a5fa' },
  warm: { label: 'Warm', adjust: { warmth: 32, vibrance: 10 }, swatch: '#fb923c' },
  cool: { label: 'Cool', adjust: { warmth: -32, tint: -6 }, swatch: '#38bdf8' },
  soft: { label: 'Soft', adjust: { contrast: -15, highlights: -12, denoise: 45, fade: 12 }, swatch: '#f9a8d4' },
  mono: { label: 'Mono', mono: true, adjust: { contrast: 18 }, swatch: '#334155' },
  vintage: { label: 'Vintage', adjust: { fade: 30, warmth: 26, saturation: -22, vignette: 35 }, swatch: '#a16207' },
} satisfies Record<string, Preset>
export type PresetKey = keyof typeof PRESETS

export const DEFAULTS: Settings = {
  preset: 'clean',
  intensity: 100,
  adjust: { ...ZERO },
  wb: false,
  bg: { mode: 'white', color: '#ffffff', strength: 100, tolerance: 50, strokes: [] },
  studio: { pad: false, margin: 8, shadow: false, rounded: false, watermark: false },
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** user sliders + the preset's own moves × intensity */
function effective(s: Settings): { a: Adjust; p: Preset; k: number } {
  const p: Preset = PRESETS[s.preset] ?? PRESETS.original
  const k = s.intensity / 100
  const a = { ...s.adjust }
  for (const [key, v] of Object.entries(p.adjust ?? {})) (a as any)[key] += (v as number) * k
  return { a, p, k }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let acc = 0
    const row = y * w
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** Background mask (1 = background): the light plain area connected to the edges, within `tolerance`. */
export function backgroundMask(d: Uint8ClampedArray, w: number, h: number, tolerance: number): { mask: Float32Array; plain: boolean; bg: [number, number, number] } {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    rs.push(d[i]), gs.push(d[i + 1]), bs.push(d[i + 2])
  }
  for (let x = 0; x < w; x += 2) for (let k = 0; k < band; k++) (push(x, k), push(x, h - 1 - k))
  for (let y = 0; y < h; y += 2) for (let k = 0; k < band; k++) (push(k, y), push(w - 1 - k, y))
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]
  const bg: [number, number, number] = [med([...rs]), med([...gs]), med([...bs])]
  const bgLum = lumOf(bg[0], bg[1], bg[2])
  let spread = 0
  for (let i = 0; i < rs.length; i++) spread += Math.abs(lumOf(rs[i], gs[i], bs[i]) - bgLum)
  spread /= rs.length
  const mask = new Float32Array(w * h)
  // a plain background (any colour) can be replaced; busy backgrounds are left alone
  const plain = spread < 18 + tolerance * 0.25
  if (!plain) return { mask, plain, bg }
  const T2 = 30 + tolerance * 0.9
  const T1 = T2 * 0.55
  const dist = (p: number) => {
    const i = p * 4
    return Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2])
  }
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const seed = (p: number) => {
    if (!seen[p] && dist(p) < T2) (seen[p] = 1, stack.push(p))
  }
  for (let x = 0; x < w; x++) (seed(x), seed((h - 1) * w + x))
  for (let y = 0; y < h; y++) (seed(y * w), seed(y * w + w - 1))
  while (stack.length) {
    const p = stack.pop()!
    const dd = dist(p)
    mask[p] = dd <= T1 ? 1 : (T2 - dd) / (T2 - T1)
    const x = p % w
    if (x > 0) seed(p - 1)
    if (x < w - 1) seed(p + 1)
    if (p >= w) seed(p - w)
    if (p < w * (h - 1)) seed(p + w)
  }
  // soften the edge a little so the item doesn't look cut out
  const soft = boxBlur(mask, w, h, 1)
  for (let p = 0; p < mask.length; p++) mask[p] = Math.min(mask[p], soft[p] * 1.15)
  return { mask, plain, bg }
}

function hexRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]
}

/**
 * Render `src` (already cropped / rotated, at the wanted size) with the settings into a new canvas.
 * `small`: preview / thumbnail quality (skips the most expensive passes).
 */
export function render(src: HTMLCanvasElement, s: Settings, opts: { small?: boolean } = {}): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const work = document.createElement('canvas')
  work.width = w
  work.height = h
  const ctx = work.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const { a, p, k } = effective(s)

  // 1. white balance from the background / brightest pixels
  if (s.wb) {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < d.length; i += 16) {
      const l = lumOf(d[i], d[i + 1], d[i + 2])
      if (l > 180) (r += d[i], g += d[i + 1], b += d[i + 2], n++)
    }
    if (n > 20) {
      const avg = (r + g + b) / (3 * n)
      const fr = avg / (r / n)
      const fg = avg / (g / n)
      const fb = avg / (b / n)
      for (let i = 0; i < d.length; i += 4) (d[i] = clamp(d[i] * fr), (d[i + 1] = clamp(d[i + 1] * fg)), (d[i + 2] = clamp(d[i + 2] * fb)))
    }
  }

  // 2. tone curve (LUT) + highlights / shadows
  const lut = new Uint8ClampedArray(256)
  const ex = Math.pow(2, a.exposure / 100)
  const ct = (259 * (a.contrast * 1.28 + 255)) / (255 * (259 - a.contrast * 1.28))
  const fade = a.fade * 0.6
  for (let v = 0; v < 256; v++) {
    let x = v * ex + a.brightness * 1.1
    x = ct * (x - 128) + 128
    x = fade + (x * (255 - fade)) / 255
    lut[v] = clamp(x)
  }
  const hi = a.highlights / 100
  const sh = a.shadows / 100
  // 3. colour
  const sat = 1 + a.saturation / 100
  const vib = a.vibrance / 100
  const warm = a.warmth * 0.35
  const tint = a.tint * 0.3
  const mono = !!p.mono && k > 0
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]]
    let g = lut[d[i + 1]]
    let b = lut[d[i + 2]]
    const l = lumOf(r, g, b) / 255
    if (hi && l > 0.5) {
      const f = 1 + hi * (l - 0.5) * 0.9
      r *= f
      g *= f
      b *= f
    }
    if (sh && l < 0.5) {
      const add = sh * (0.5 - l) * 90
      r += add
      g += add
      b += add
    }
    r += warm + tint * 0.5
    g -= tint
    b += -warm + tint * 0.5
    const L = lumOf(r, g, b)
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const curSat = mx ? (mx - mn) / mx : 0
    const f = sat + vib * (1 - curSat)
    r = L + (r - L) * f
    g = L + (g - L) * f
    b = L + (b - L) * f
    if (mono) {
      const m = lumOf(r, g, b)
      r = r + (m - r) * k
      g = g + (m - g) * k
      b = b + (m - b) * k
    }
    d[i] = clamp(r)
    d[i + 1] = clamp(g)
    d[i + 2] = clamp(b)
  }

  // 4. detail: denoise, clarity, sharpen (on luminance-ish per channel)
  const detail = (amountSharp: number, amountClarity: number, amountDenoise: number) => {
    if (!amountSharp && !amountClarity && !amountDenoise) return
    for (let c = 0; c < 3; c++) {
      const ch = new Float32Array(w * h)
      for (let p2 = 0; p2 < w * h; p2++) ch[p2] = d[p2 * 4 + c]
      const b1 = boxBlur(ch, w, h, 1)
      const bBig = amountClarity && !opts.small ? boxBlur(ch, w, h, Math.max(3, Math.round(Math.min(w, h) / 60))) : null
      for (let p2 = 0; p2 < w * h; p2++) {
        let v = ch[p2]
        if (amountDenoise) {
          const diff = Math.abs(v - b1[p2])
          const t = diff < 14 ? amountDenoise : amountDenoise * 0.25 // smooth flat areas, keep edges
          v = v + (b1[p2] - v) * t
        }
        if (bBig) v = v + (v - bBig[p2]) * amountClarity
        if (amountSharp) v = v + (v - b1[p2]) * amountSharp
        d[p2 * 4 + c] = clamp(v)
      }
    }
  }
  detail((a.sharpness / 100) * 1.4, (a.clarity / 100) * 0.6, (a.denoise / 100) * 0.7)

  // 5. background: white / colour / gradient over the detected plain background (+ brush strokes)
  let mask: Float32Array | null = null
  const wantBg = s.bg.mode !== 'keep' || !!p.clean || s.studio.pad || s.studio.shadow
  if (wantBg) {
    mask = backgroundMask(d, w, h, s.bg.tolerance).mask
    for (const st of s.bg.strokes) {
      const cx = st.x * w
      const cy = st.y * h
      const rr = st.r * Math.max(w, h)
      const x0 = Math.max(0, Math.floor(cx - rr))
      const x1 = Math.min(w - 1, Math.ceil(cx + rr))
      const y0 = Math.max(0, Math.floor(cy - rr))
      const y1 = Math.min(h - 1, Math.ceil(cy + rr))
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const dd = Math.hypot(x - cx, y - cy)
          if (dd > rr) continue
          const f = Math.min(1, (rr - dd) / (rr * 0.35))
          const q = y * w + x
          mask[q] = st.bg ? Math.max(mask[q], f) : Math.min(mask[q], 1 - f)
        }
    }
  }
  const mode = s.bg.mode === 'keep' && p.clean ? 'white' : s.bg.mode
  const fill = (x: number, y: number): [number, number, number] => {
    if (mode === 'gradient') {
      const t = y / h
      return [255 - 22 * t, 255 - 20 * t, 255 - 16 * t]
    }
    if (mode === 'color') return hexRgb(s.bg.color)
    return [255, 255, 255]
  }
  if (mask && mode !== 'keep') {
    const strength = (s.bg.strength / 100) * (p.clean && s.bg.mode === 'keep' ? k : 1)
    for (let q = 0; q < w * h; q++) {
      const m = mask[q] * strength
      if (!m) continue
      const i = q * 4
      const [fr, fg, fb] = fill(q % w, (q / w) | 0)
      d[i] = d[i] + (fr - d[i]) * m
      d[i + 1] = d[i + 1] + (fg - d[i + 1]) * m
      d[i + 2] = d[i + 2] + (fb - d[i + 2]) * m
    }
  }

  // 6. auto levels on the item's own pixels (1 % – 99 %), gentle (70 %)
  if (p.levels && k > 0) {
    const hist = new Uint32Array(256)
    let n = 0
    for (let q = 0; q < w * h; q++) {
      if (mask && mask[q] > 0.5) continue
      const i = q * 4
      hist[Math.round(lumOf(d[i], d[i + 1], d[i + 2]))]++
      n++
    }
    if (n > 50) {
      let lo = 0
      let hi2 = 255
      let acc = 0
      for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n * 0.01) { lo = v; break }
      acc = 0
      for (let v = 255; v >= 0; v--) if ((acc += hist[v]) >= n * 0.01) { hi2 = v; break }
      if (hi2 - lo > 40 && hi2 - lo < 235) {
        const st = 255 / (hi2 - lo)
        const amt = 0.7 * k
        for (let q = 0; q < w * h; q++) {
          if (mask && mask[q] > 0.9) continue
          const i = q * 4
          for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + ((d[i + c] - lo) * st - d[i + c]) * amt)
        }
      }
    }
  }

  // 7. vignette
  if (a.vignette > 0) {
    const vg = a.vignette / 100
    const R = Math.hypot(w / 2, h / 2)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = Math.hypot(x - w / 2, y - h / 2) / R
        const f = 1 - vg * Math.max(0, t - 0.45) * 1.4
        const i = (y * w + x) * 4
        d[i] *= f
        d[i + 1] *= f
        d[i + 2] *= f
      }
  }
  ctx.putImageData(img, 0, 0)

  // 8. studio: centre on a square with margin, soft shadow, rounded corners, watermark
  let out = work
  if (s.studio.pad || s.studio.shadow) {
    // the item's box = where the background is not
    let x0 = w
    let y0 = h
    let x1 = 0
    let y1 = 0
    if (mask)
      for (let q = 0; q < w * h; q++)
        if (mask[q] < 0.5) {
          const x = q % w
          const y = (q / w) | 0
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 <= x0 || y1 <= y0) [x0, y0, x1, y1] = [0, 0, w - 1, h - 1]
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    // item with a transparent background (so the shadow and new background show through)
    const item = document.createElement('canvas')
    item.width = bw
    item.height = bh
    const ic = item.getContext('2d')!
    const part = ctx.getImageData(x0, y0, bw, bh)
    if (mask)
      for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++) part.data[(y * bw + x) * 4 + 3] = Math.round(255 * (1 - mask[(y + y0) * w + x + x0]))
    ic.putImageData(part, 0, 0)
    const side = s.studio.pad ? Math.round(Math.max(bw, bh) * (1 + (2 * s.studio.margin) / 100)) : 0
    const W = s.studio.pad ? side : w
    const H = s.studio.pad ? side : h
    out = document.createElement('canvas')
    out.width = W
    out.height = H
    const oc = out.getContext('2d')!
    if (mode === 'gradient') {
      const gr = oc.createLinearGradient(0, 0, 0, H)
      gr.addColorStop(0, '#ffffff')
      gr.addColorStop(1, '#e9ebef')
      oc.fillStyle = gr
    } else oc.fillStyle = mode === 'color' ? s.bg.color : mode === 'keep' ? `rgb(${backgroundMask(d, w, h, 50).bg.join(',')})` : '#ffffff'
    oc.fillRect(0, 0, W, H)
    const dx = s.studio.pad ? Math.round((W - bw) / 2) : x0
    const dy = s.studio.pad ? Math.round((H - bh) / 2) : y0
    if (s.studio.shadow) {
      const cx = dx + bw / 2
      const cy = dy + bh - bh * 0.02
      const rx = bw * 0.48
      const ry = Math.max(4, bh * 0.07)
      oc.save()
      oc.translate(cx, cy)
      oc.scale(1, ry / rx)
      const gr = oc.createRadialGradient(0, 0, 0, 0, 0, rx)
      gr.addColorStop(0, 'rgba(15,23,42,0.28)')
      gr.addColorStop(1, 'rgba(15,23,42,0)')
      oc.fillStyle = gr
      oc.beginPath()
      oc.arc(0, 0, rx, 0, Math.PI * 2)
      oc.fill()
      oc.restore()
    }
    oc.drawImage(item, dx, dy)
  }
  if (s.studio.rounded || s.studio.watermark) {
    const W = out.width
    const H = out.height
    const fin = document.createElement('canvas')
    fin.width = W
    fin.height = H
    const fc = fin.getContext('2d')!
    fc.fillStyle = '#ffffff'
    fc.fillRect(0, 0, W, H)
    if (s.studio.rounded) {
      const r = Math.min(W, H) * 0.06
      fc.beginPath()
      fc.roundRect(0, 0, W, H, r)
      fc.clip()
    }
    fc.drawImage(out, 0, 0)
    if (s.studio.watermark) {
      const fs = Math.max(10, Math.round(Math.min(W, H) * 0.035))
      fc.font = `600 ${fs}px system-ui, sans-serif`
      fc.fillStyle = 'rgba(15,23,42,0.35)'
      fc.textAlign = 'right'
      fc.fillText('Unico HomeCare', W - fs * 0.8, H - fs * 0.8)
    }
    out = fin
  }
  return out
}

/** Draw the rotated, cropped part of an image into a canvas no larger than `max` px. */
export function cropTo(source: HTMLCanvasElement, crop: { x: number; y: number; w: number; h: number } | null, max: number) {
  const c = crop ?? { x: 0, y: 0, w: source.width, h: source.height }
  const k = Math.min(1, max / Math.max(c.w, c.h))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(c.w * k))
  out.height = Math.max(1, Math.round(c.h * k))
  const x = out.getContext('2d')!
  x.fillStyle = '#fff'
  x.fillRect(0, 0, out.width, out.height)
  x.imageSmoothingQuality = 'high'
  // the box may reach past the photo (a tall item in a square crop): draw only the overlap, the rest stays white
  const sx = Math.max(0, c.x)
  const sy = Math.max(0, c.y)
  const ex = Math.min(source.width, c.x + c.w)
  const ey = Math.min(source.height, c.y + c.h)
  if (ex > sx && ey > sy) x.drawImage(source, sx, sy, ex - sx, ey - sy, (sx - c.x) * k, (sy - c.y) * k, (ex - sx) * k, (ey - sy) * k)
  return out
}

/** An upright canvas of an image (rotation 0/90/180/270), big photos scaled to ≤ `max` px. */
export function upright(img: HTMLImageElement, rot: number, max = 2400) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const bw = Math.round(img.naturalWidth * k)
  const bh = Math.round(img.naturalHeight * k)
  const turn = rot % 180 !== 0
  const c = document.createElement('canvas')
  c.width = turn ? bh : bw
  c.height = turn ? bw : bh
  const x = c.getContext('2d')!
  x.fillStyle = '#fff'
  x.fillRect(0, 0, c.width, c.height)
  x.translate(c.width / 2, c.height / 2)
  x.rotate((rot * Math.PI) / 180)
  x.drawImage(img, -bw / 2, -bh / 2, bw, bh)
  return c
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('Could not read this picture'))
    im.src = src
  })
}

/** Apply settings to a whole file without the editor (the "apply to all remaining pictures" path). */
export async function processFile(file: File, s: Settings, opts: { rot?: number; square?: boolean } = {}): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const im = await loadImage(url)
    const up = upright(im, opts.rot ?? 0)
    const side = Math.min(up.width, up.height)
    const crop = opts.square ? { x: (up.width - side) / 2, y: (up.height - side) / 2, w: side, h: side } : null
    const out = render(cropTo(up, crop, 1600), { ...s, bg: { ...s.bg, strokes: [] } })
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/webp', 0.95))
    if (!blob) throw new Error('Could not make the picture')
    return new File([blob], 'item.webp', { type: 'image/webp' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
