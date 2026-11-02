import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['mongoose', 'bcryptjs', 'nodemailer', 'sharp', '@whiskeysockets/baileys', 'pino', 'pdf-lib', 'exceljs'],
  // hospital form templates (requisition PDF, bill submission workbook) + the logo for generated PDFs are read from
  // disk at runtime: ship them with every server function (documents are generated from many routes / after()).
  outputFileTracingIncludes: {
    '/**': ['./assets/forms/**/*', './public/logo.svg'],
  },
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
}

export default nextConfig
