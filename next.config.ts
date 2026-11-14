import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['mongoose', 'bcryptjs', 'nodemailer', 'sharp', '@whiskeysockets/baileys', 'pino', 'pdf-lib', 'exceljs'],
  // hospital form templates (requisition PDF, bill submission workbook) + the logo for generated PDFs are read from
  // disk at runtime: ship them with every server function (documents are generated from many routes / after()).
  // harfbuzz-subset.wasm shrinks the fonts inside H360 bill copies (lib/forms/pdf-fonts.ts).
  outputFileTracingIncludes: {
    '/**': ['./assets/forms/**/*', './public/logo.svg', './node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
    // instant back / re-open: the browser keeps a page for 45 s (prefetched ones 2 min); RouteFreshness refreshes
    // a cached page quietly right after it shows, so it opens at once and is still up to date a moment later
    staleTimes: { dynamic: 45, static: 120 },
  },
  // there is no /admin page: the web admin home is /dashboard (people type /admin and land on a 404 after login)
  async redirects() {
    return [{ source: '/admin', destination: '/dashboard', permanent: false }]
  },
}

export default nextConfig
