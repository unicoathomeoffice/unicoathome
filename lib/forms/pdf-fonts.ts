import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFRef } from 'pdf-lib'

// Shrinks PDFs that embed whole TrueType fonts (H360's bill copy carries all of IBM Plex Sans: ~90 KB) by subsetting
// each Type0 / Identity-H font to the glyphs the pages actually draw — glyph ids are kept (retain-gids), so the page
// content stays valid — and dropping hinting. Uses HarfBuzz's subsetter (WebAssembly, no native code). Best effort:
// anything unexpected returns the original bytes.

type Hb = { [k: string]: any; memory: WebAssembly.Memory }
let hb: Promise<Hb> | null = null
function harfbuzz() {
  hb ??= fs
    .readFile(path.join(process.cwd(), 'node_modules', 'harfbuzzjs', 'dist', 'harfbuzz-subset.wasm'))
    .then((bin) => WebAssembly.instantiate(bin, {}))
    .then((r) => r.instance.exports as unknown as Hb)
  return hb.catch((e) => {
    hb = null
    throw e
  })
}

const NO_HINTING = 1
const RETAIN_GIDS = 2
const NOTDEF_OUTLINE = 64

async function subsetFont(font: Uint8Array, gids: Iterable<number>) {
  const e = await harfbuzz()
  const ptr = e.malloc(font.length)
  try {
    new Uint8Array(e.memory.buffer).set(font, ptr)
    const blob = e.hb_blob_create(ptr, font.length, 2 /* writable */, 0, 0)
    const face = e.hb_face_create(blob, 0)
    e.hb_blob_destroy(blob)
    const input = e.hb_subset_input_create_or_fail()
    const set = e.hb_subset_input_glyph_set(input)
    for (const g of gids) e.hb_set_add(set, g)
    e.hb_subset_input_set_flags(input, NO_HINTING | RETAIN_GIDS | NOTDEF_OUTLINE)
    const out = e.hb_subset_or_fail(face, input)
    e.hb_subset_input_destroy(input)
    if (!out) return null
    const ob = e.hb_face_reference_blob(out)
    const len = e.hb_blob_get_length(ob)
    const off = e.hb_blob_get_data(ob, 0)
    const res = new Uint8Array(e.memory.buffer).slice(off, off + len)
    e.hb_blob_destroy(ob)
    return res
  } finally {
    e.free(ptr)
  }
}

const raw = (s: PDFRawStream) => Buffer.from(decodePDFRawStream(s).decode())
// a font switch "/F1 9 Tf", a hex string "<0041004B>", or a literal string "(\000A\000B)" — both carry 2-byte codes
const TOKENS = /(\/[^\s/[\]<>()]+)\s+[-\d.]+\s+Tf|<([0-9a-fA-F\s]*)>|\(((?:\\[\s\S]|[^\\)])*)\)/g
const ESC: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }
/** Bytes of a PDF literal string body (escapes and \ddd octal resolved). */
function literalBytes(body: string) {
  const out: number[] = []
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') {
      out.push(body.charCodeAt(i) & 0xff)
      continue
    }
    const nx = body[++i]
    if (nx === undefined) break
    if (nx in ESC) out.push(ESC[nx])
    else if (/[0-7]/.test(nx)) {
      let oct = nx
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[++i]
      out.push(parseInt(oct, 8) & 0xff)
    } else if (nx === '\r' || nx === '\n') {
      if (nx === '\r' && body[i + 1] === '\n') i++ // line continuation
    } else out.push(nx.charCodeAt(0) & 0xff)
  }
  return out
}

/** Glyph ids drawn with the font `ref` (Identity-H: every 2-byte code is the glyph id) across all pages. */
function usedGlyphs(doc: PDFDocument, ref: PDFRef) {
  const gids = new Set<number>([0])
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'))
    if (!(fonts instanceof PDFDict)) continue
    const names = fonts.keys().filter((k) => fonts.get(k)?.toString() === ref.toString()).map((k) => k.toString())
    if (!names.length) continue
    const c = page.node.Contents()
    const parts = (c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c]).filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    let cur = ''
    for (const t of parts.map((s) => raw(s).toString('latin1')).join('\n').matchAll(TOKENS)) {
      if (t[1]) cur = t[1]
      else if (t[2] != null && names.includes(cur)) {
        const hex = t[2].replace(/\s/g, '')
        for (let i = 0; i + 4 <= hex.length; i += 4) gids.add(parseInt(hex.slice(i, i + 4), 16))
      } else if (t[3] != null && names.includes(cur)) {
        const b = literalBytes(t[3])
        for (let i = 0; i + 1 < b.length; i += 2) gids.add((b[i] << 8) | b[i + 1])
      }
    }
  }
  return gids
}

/** Subset the embedded Type0 fonts of a PDF and re-save it compactly. Returns the original when nothing is gained. */
export async function shrinkPdfFonts(pdf: Buffer): Promise<Buffer> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false })
    const ctx = doc.context
    let changed = false
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Subtype'))?.toString() !== '/Type0') continue
      if (obj.get(PDFName.of('Encoding'))?.toString() !== '/Identity-H') continue
      const kids = ctx.lookup(obj.get(PDFName.of('DescendantFonts')))
      const desc = kids instanceof PDFArray ? ctx.lookup(kids.get(0)) : null
      if (!(desc instanceof PDFDict)) continue
      // CID → glyph id: Identity, or a table (2 bytes per CID). Glyph ids are kept, so the table stays valid as it is.
      const map = desc.get(PDFName.of('CIDToGIDMap'))
      const table = map && map.toString() !== '/Identity' ? ctx.lookup(map) : null
      if (map && map.toString() !== '/Identity' && !(table instanceof PDFRawStream)) continue
      const tbl = table instanceof PDFRawStream ? raw(table) : null
      const fd = ctx.lookup(desc.get(PDFName.of('FontDescriptor')))
      const ffRef = fd instanceof PDFDict ? (fd.get(PDFName.of('FontFile2')) as PDFRef | undefined) : undefined
      const ff = ffRef ? ctx.lookup(ffRef) : null
      if (!ffRef || !(ff instanceof PDFRawStream)) continue
      const cids = usedGlyphs(doc, ref)
      if (cids.size < 2) continue
      const gids = new Set<number>([0])
      for (const cid of cids) gids.add(tbl ? (2 * cid + 1 < tbl.length ? (tbl[2 * cid] << 8) | tbl[2 * cid + 1] : 0) : cid)
      const font = raw(ff)
      const small = await subsetFont(font, gids)
      if (!small || small.length >= font.length) continue
      ctx.assign(ffRef, PDFRawStream.of(ctx.obj({ Filter: 'FlateDecode', Length1: small.length }), zlib.deflateSync(small, { level: 9 })))
      changed = true
    }
    const out = Buffer.from(await doc.save({ useObjectStreams: true }))
    return changed || out.length < pdf.length ? (out.length < pdf.length ? out : pdf) : pdf
  } catch (e) {
    console.error('[pdf] font subsetting skipped', e)
    return pdf
  }
}
