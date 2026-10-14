export type GmailMode = 'smtp' | 'oauth2'
export type GmailStatus = {
  mode: GmailMode
  configured: boolean
  user: string | null
  canSave: boolean
  smtp: { user: string; hasPassword: boolean }
  oauth2: { user: string; clientId: string; hasClientSecret: boolean; hasRefreshToken: boolean }
}
