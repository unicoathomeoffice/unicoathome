// Render one design screen to PNG so it can be viewed while implementing it.
//   node ui/tools/screen.mjs W04            → ui/tools/out/W04.png (+ prints the screen's description and text)
//   node ui/tools/screen.mjs M08-e
//   node ui/tools/screen.mjs web4:1c        → a whole option block (for screens without a label, e.g. email templates)
// Files keys: mobile, web1..web5
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const designDir = path.resolve(here, '../design')
const outDir = path.join(here, 'out')
fs.mkdirSync(outDir, { recursive: true })

const FILES = {
  mobile: 'Unico HomeCare Mobile.dc.html',
  web1: 'Unico HomeCare Web 1 - Operations.dc.html',
  web2: 'Unico HomeCare Web 2 - Patients - Staff.dc.html',
  web3: 'Unico HomeCare Web 3 - Messages- Reports - Settings.dc.html',
  web4: 'Unico HomeCare Web 4 - Email - Notifications.dc.html',
  web5: 'Unico HomeCare Web 5 - Administration.dc.html',
}
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))

const arg = process.argv[2]
if (!arg) {
  console.log('usage: node ui/tools/screen.mjs <W04|M08-e|web4:1c>')
  process.exit(1)
}

function balancedDiv(html, start) {
  // start = index of '<div' ; returns end index after matching </div>
  const re = /<div\b|<\/div>/g
  re.lastIndex = start
  let depth = 0
  let m
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return m.index + 6
  }
  return html.length
}

let found = null
for (const [key, file] of Object.entries(FILES)) {
  const html = fs.readFileSync(path.join(designDir, file), 'utf8')
  const head = (html.match(/<helmet[^>]*>([\s\S]*?)<\/helmet>/) || [])[1] ?? ''
  if (arg.includes(':')) {
    const [k, opt] = arg.split(':')
    if (k !== key) continue
    const i = html.indexOf(`<div class="dv-opt" id="${opt}"`)
    if (i < 0) continue
    found = { key, head, block: html.slice(i, balancedDiv(html, i)), mobile: false, whole: true }
    break
  }
  const at = html.indexOf(`data-screen-label="${arg}"`)
  if (at < 0) continue
  const start = html.lastIndexOf('<div', at)
  const optStart = html.lastIndexOf('<div class="dv-opt"', at)
  const label = html.slice(optStart, html.indexOf('</div>', html.indexOf('dv-olabel', optStart)) + 6)
  found = { key, head, block: html.slice(start, balancedDiv(html, start)), label, mobile: key === 'mobile' }
  break
}
if (!found) {
  console.error(`Screen ${arg} not found`)
  process.exit(1)
}

const text = (s) =>
  s
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' | ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '·')
    .trim()
if (found.label) console.log('DESCRIPTION:', text(found.label))
console.log('\nTEXT:', text(found.block).slice(0, 6000))

const w = found.mobile ? 390 : found.whole ? 1540 : 1440
const h = found.mobile ? 844 : found.whole ? 2600 : 900
const body = found.mobile ? `<div style="width:390px;height:844px;overflow:hidden">${found.block}</div>` : found.block
const doc = `<!doctype html><html><head><meta charset="utf-8"><base href="file:///${designDir.replace(/\\/g, '/')}/">${found.head}<style>body{margin:0;background:#fff}</style></head><body>${body}</body></html>`
const safe = arg.replace(/[^\w-]/g, '_')
const htmlOut = path.join(outDir, `${safe}.html`)
fs.writeFileSync(htmlOut, doc)
if (!CHROME) {
  console.log('\nNo Chrome/Edge found; open', htmlOut)
  process.exit(0)
}
const png = path.join(outDir, `${safe}.png`)
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, '--virtual-time-budget=3000', `--screenshot=${png}`, `file:///${htmlOut.replace(/\\/g, '/')}`], { stdio: 'ignore' })
console.log('\nPNG:', png)
