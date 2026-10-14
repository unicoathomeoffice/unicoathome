import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['mongoose', 'bcryptjs', 'nodemailer', 'sharp', '@whiskeysockets/baileys', 'pino'],
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
}

export default nextConfig
