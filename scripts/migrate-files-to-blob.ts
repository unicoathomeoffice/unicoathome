/* eslint-disable no-console */
// Move attachments stored inline in MongoDB into the private Vercel Blob store.
// Usage: npx tsx --env-file=.env.local scripts/migrate-files-to-blob.ts   (needs BLOB_READ_WRITE_TOKEN)
import mongoose from 'mongoose'
import { put } from '@vercel/blob'
import { Attachment } from '../lib/models'

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Set BLOB_READ_WRITE_TOKEN in .env.local first')
  await mongoose.connect(process.env.MONGODB_URI!)
  const cursor = Attachment.find({ $or: [{ storage: 'mongo' }, { storage: { $exists: false } }], data: { $exists: true } }).select('+data').cursor()
  let moved = 0
  for await (const a of cursor) {
    const owner = a.requestId ? `requests/${a.requestId}` : `${String(a.ownerType ?? 'user').toLowerCase()}s/${a.ownerId}`
    const name = `${a._id}-${String(a.filename ?? 'file').replace(/[^\w.\-]+/g, '_')}`
    const res = await put(`${owner}/${String(a.kind ?? 'other').toLowerCase()}/${name}`, Buffer.from(a.data), { access: 'private', contentType: a.mime, addRandomSuffix: true })
    await Attachment.updateOne({ _id: a._id }, { $set: { storage: 'blob', blobUrl: res.url }, $unset: { data: 1 } })
    moved++
    console.log('moved', a._id, a.filename)
  }
  console.log(`Done · ${moved} file(s) moved to Vercel Blob`)
  await mongoose.disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await mongoose.disconnect()
  process.exit(1)
})
