import mongoose from 'mongoose'

// Reuse one connection across hot reloads and serverless invocations.
const g = globalThis as unknown as { _mongoose?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } }
const cached = g._mongoose ?? (g._mongoose = { conn: null, promise: null })

export async function db() {
  if (cached.conn) return cached.conn
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set. Copy .env.example to .env.local and fill it in.')
  if (!cached.promise) {
    mongoose.set('strictQuery', true)
    // minPoolSize keeps one socket open between clicks on a warm instance; maxIdleTimeMS stops it being recycled.
    cached.promise = mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 8000, maxPoolSize: 10, minPoolSize: 1, maxIdleTimeMS: 10 * 60_000 })
  }
  try {
    cached.conn = await cached.promise
  } catch (e) {
    cached.promise = null
    throw e
  }
  return cached.conn
}

// Start connecting as soon as a server instance loads this module (cold start), in parallel with the rest of the
// request's work, instead of when the first query runs. Skipped during `next build`.
if (process.env.MONGODB_URI && process.env.NEXT_PHASE !== 'phase-production-build') db().catch(() => {})

/** Convert lean Mongo documents (ObjectIds, Dates, Buffers) into plain JSON for client components. */
export function plain<T>(doc: T): any {
  return JSON.parse(JSON.stringify(doc))
}
