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
    cached.promise = mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 15000, maxPoolSize: 10 })
  }
  try {
    cached.conn = await cached.promise
  } catch (e) {
    cached.promise = null
    throw e
  }
  return cached.conn
}

/** Convert lean Mongo documents (ObjectIds, Dates, Buffers) into plain JSON for client components. */
export function plain<T>(doc: T): any {
  return JSON.parse(JSON.stringify(doc))
}
