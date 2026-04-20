/**
 * runtime/jobs/notificationRetention.js
 * Daily: delete read notifications older than NOTIFICATION_RETENTION_DAYS.
 * Guarded by its own advisory lock.
 */

import { query } from '../../db/postgres.js'

const LOCK_KEY = 252727381
let timer = null

export async function startRetentionJob() {
  if (timer) return
  timer = setInterval(runOnce, 24 * 60 * 60_000)
  setTimeout(runOnce, 60_000)
}

export function stopRetentionJob() {
  if (timer) { clearInterval(timer); timer = null }
}

async function runOnce() {
  const days = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 90)
  if (!days) return
  const { rows: lock } = await query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])
  if (!lock[0].ok) return
  try {
    const { rowCount } = await query(
      `DELETE FROM runtime.notifications
       WHERE read_at IS NOT NULL AND read_at < now() - ($1 || ' days')::interval`,
      [days]
    )
    console.log(`[retention] purged ${rowCount} read notifications older than ${days}d`)
  } finally {
    await query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
  }
}
