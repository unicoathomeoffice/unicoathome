import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['mongoose', 'bcryptjs', 'nodemailer'],
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
}

export default nextConfig
