import 'server-only'
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from '@whiskeysockets/baileys'
import { WaAuth } from '../models'

// WhatsApp (Baileys) session kept in MongoDB instead of files, so every Vercel function sees the same
// paired device. Keys are tiny documents: _id = "creds" or "<type>-<id>".

const read = async (id: string) => {
  const row = await WaAuth.findById(id).lean<any>()
  return row?.value ? JSON.parse(row.value, BufferJSON.reviver) : null
}
const write = (id: string, value: unknown) => WaAuth.updateOne({ _id: id }, { $set: { value: JSON.stringify(value, BufferJSON.replacer) } }, { upsert: true })

export async function mongoAuthState() {
  const creds: AuthenticationCreds = (await read('creds')) ?? initAuthCreds()
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const out: Record<string, any> = {}
        await Promise.all(
          ids.map(async (id) => {
            let v = await read(`${type}-${id}`)
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v)
            if (v) out[id] = v
          }),
        )
        return out
      },
      set: async (data) => {
        const ops: Promise<unknown>[] = []
        for (const cat of Object.keys(data) as (keyof SignalDataTypeMap)[])
          for (const [id, v] of Object.entries(data[cat] ?? {})) ops.push(v ? write(`${cat}-${id}`, v) : WaAuth.deleteOne({ _id: `${cat}-${id}` }))
        await Promise.all(ops)
      },
    },
  }
  return {
    state,
    saveCreds: () => write('creds', creds),
    /** forget the device completely (after logout) — keeps the meta/lock rows */
    clear: () => WaAuth.deleteMany({ _id: { $nin: ['meta', 'lock'] } }),
  }
}

export async function isPaired() {
  const c = await read('creds')
  return !!c?.me?.id
}

export async function pairedPhone(): Promise<string | null> {
  const c = await read('creds')
  return c?.me?.id ? String(c.me.id).split(':')[0].split('@')[0] : null
}
