// Hands-free scan for the public booking page: find the page, flatten it, Magic colour. No editor, no OpenCV
// download for patients. When the page edges are not clear it only cleans up the lighting, never crops blindly.
import { detectLite } from './detect'
import { applyFilter } from './filters'
import { loadSource, warp } from './geometry'
import { jpegFile } from './output'

export async function autoScan(file: File): Promise<{ file: File; cropped: boolean }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { file, cropped: false }
  try {
    const src = await loadSource(file, 2400)
    const det = detectLite(src)
    const page = det.ok ? warp(src, det.quad) : src
    const out = await jpegFile(applyFilter(page, 'magic'), file.name.replace(/\.\w+$/, '') + '-scan')
    return { file: out, cropped: det.ok }
  } catch {
    return { file, cropped: false }
  }
}
