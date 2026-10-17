import 'server-only'
import { cache } from 'react'
import { db } from './db'
import { Notification } from './models'

/** Unread notification count for the signed-in user — one query per request even though the layout, the page
 *  frame (AdminPage / MScreen tab bar) and the bell all ask for it. */
export const unreadCount = cache(async (userId: string): Promise<number> => {
  await db()
  return Notification.countDocuments({ userId, readAt: null })
})
