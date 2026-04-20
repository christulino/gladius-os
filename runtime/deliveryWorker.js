/**
 * runtime/deliveryWorker.js
 * Drains runtime.notification_deliveries. One active worker per deployment
 * guarded by PG advisory lock key 252727380.
 */

import { query, getClient } from '../db/postgres.js'
import { deliverWebhook } from './channels/webhook.js'
import { deliverAgent } from './channels/agent.js'
import { deliverEmail, renderRealtimeBody } from './channels/email.js'
import { HostRateLimiter, Semaphore, checkUserChannelRate } from './rateLimiter.js'

const LOCK_KEY = 252727380
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]  // 1m, 5m, 30m, 2h, 12h
const MAX_ATTEMPTS = 5

let running = false
let timer = null
let holdingLock = false

const batchSize    = Number(process.env.DELIVERY_WORKER_BATCH_SIZE)   || 50
const concurrency  = Number(process.env.DELIVERY_WORKER_CONCURRENCY)  || 10
const pollMs       = Number(process.env.DELIVERY_WORKER_POLL_INTERVAL_MS) || 5000
const perUserMin   = Number(process.env.RATE_LIMIT_PER_USER_PER_MIN)  || 60
const perUserHour  = Number(process.env.RATE_LIMIT_PER_USER_PER_HOUR) || 600
const perHostMin   = Number(process.env.RATE_LIMIT_PER_HOST_PER_MIN)  || 30

const hostLimiter = new HostRateLimiter({ windowMs: 60_000, cap: perHostMin })
const sem         = new Semaphore(concurrency)

async function acquireLock() {
  const { rows } = await query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])
  holdingLock = rows[0].ok
  return holdingLock
}
async function releaseLock() {
  if (holdingLock) {
    await query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
    holdingLock = false
  }
}

export async function startDeliveryWorker() {
  if (running) return
  running = true
  tick()
}

export async function stopDeliveryWorker() {
  running = false
  if (timer) { clearTimeout(timer); timer = null }
  await releaseLock()
}

async function tick() {
  if (!running) return
  try {
    if (!holdingLock && !(await acquireLock())) {
      timer = setTimeout(tick, pollMs); return
    }
    await drainOnce()
  } catch (e) {
    console.error('[deliveryWorker] tick failed:', e)
  } finally {
    if (running) timer = setTimeout(tick, pollMs)
  }
}

async function drainOnce() {
  const c = await getClient()
  try {
    await c.query('BEGIN')
    const { rows } = await c.query(`
      SELECT d.id, d.notification_id, d.channel, d.attempt_count, n.user_id, n.summary,
             n.event_id, n.event_type, n.work_item_id, n.reasons
      FROM runtime.notification_deliveries d
      JOIN runtime.notifications n ON n.id = d.notification_id
      WHERE d.status = 'pending' AND d.next_attempt_at <= now()
      ORDER BY d.id
      LIMIT $1 FOR UPDATE SKIP LOCKED
    `, [batchSize])

    await Promise.all(rows.map(row =>
      sem.acquire().then(() => dispatch(c, row).finally(() => sem.release()))))
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK'); throw e
  } finally {
    c.release()
  }
}

async function dispatch(c, row) {
  const userRate = await checkUserChannelRate({
    query, userId: row.user_id, channel: row.channel,
    perMinute: perUserMin, perHour: perUserHour,
  })
  if (!userRate.allowed) return reschedule(c, row.id, userRate.retryAfterMs)

  const { rows: chs } = await c.query(
    `SELECT config FROM blueprint.user_notification_channels
     WHERE user_id = $1 AND channel = $2 AND is_enabled = true`,
    [row.user_id, row.channel]
  )
  if (!chs.length) return markFailed(c, row.id, 'channel-disabled')
  const config = chs[0].config || {}

  if (row.channel === 'webhook' || row.channel === 'agent') {
    const host = safeHost(config.url)
    if (!host) return markFailed(c, row.id, 'invalid-url')
    if (!hostLimiter.allow(host)) return reschedule(c, row.id, 60_000)
  }

  const payload = {
    notification_id: row.notification_id,
    event_id:        row.event_id,
    event_type:      row.event_type,
    work_item:       { id: row.work_item_id },
    reasons:         row.reasons,
    summary:         row.summary,
    occurred_at:     new Date().toISOString(),
  }

  let result
  if (row.channel === 'webhook') {
    result = await deliverWebhook({ url: config.url, secret: config.secret, deliveryId: row.id, body: payload })
  } else if (row.channel === 'agent') {
    result = await deliverAgent({ config, deliveryId: row.id, notificationPayload: payload })
  } else if (row.channel === 'email') {
    const { subject, text, html } = renderRealtimeBody(
      { summary: row.summary }, { id: row.work_item_id }, process.env.PUBLIC_BASE_URL || '')
    result = await deliverEmail({ to: config.email_to, subject, text, html })
  } else {
    return markFailed(c, row.id, `unknown-channel:${row.channel}`)
  }

  if (result.ok) {
    await c.query(`UPDATE runtime.notification_deliveries SET status='sent', sent_at=now() WHERE id=$1`, [row.id])
  } else {
    const nextAttempt = row.attempt_count + 1
    if (nextAttempt >= MAX_ATTEMPTS) {
      await c.query(`UPDATE runtime.notification_deliveries
        SET status='failed', attempt_count=$1, last_error=$2 WHERE id=$3`,
        [nextAttempt, result.error || `status=${result.status}`, row.id])
    } else {
      const delay = BACKOFF_MS[nextAttempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
      await c.query(`UPDATE runtime.notification_deliveries
        SET attempt_count=$1, last_error=$2, next_attempt_at=now() + ($3 || ' ms')::interval WHERE id=$4`,
        [nextAttempt, result.error || `status=${result.status}`, delay, row.id])
    }
  }
}

async function reschedule(c, id, delayMs) {
  await c.query(`UPDATE runtime.notification_deliveries
    SET next_attempt_at = now() + ($1 || ' ms')::interval WHERE id = $2`,
    [delayMs, id])
}

async function markFailed(c, id, reason) {
  await c.query(`UPDATE runtime.notification_deliveries
    SET status='failed', last_error=$1 WHERE id=$2`, [reason, id])
}

function safeHost(url) {
  try { return new URL(url).hostname } catch { return null }
}

// Exported for tests
export const __testables = { BACKOFF_MS, MAX_ATTEMPTS }

export default { startDeliveryWorker, stopDeliveryWorker }
