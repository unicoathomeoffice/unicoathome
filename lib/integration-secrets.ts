import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function key() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY ?? ''
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Integration encryption is not configured on this server')
  return Buffer.from(value, 'hex')
}
/** `label` binds the ciphertext to its purpose (Gmail, H360…) so one secret can't be swapped for another. */
export function encryptIntegration(value: unknown, label = 'gmail:v1') {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(label))
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}
export function decryptIntegration<T>(value: string, label = 'gmail:v1'): T {
  try {
    const [version, iv, tag, data] = value.split('.')
    if (version !== 'v1' || !iv || !tag || !data) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(label))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'))
  } catch {
    throw new Error(`Saved ${label.split(':')[0] === 'gmail' ? 'Gmail' : label.split(':')[0].toUpperCase()} credentials could not be decrypted; check the integration encryption key`)
  }
}
