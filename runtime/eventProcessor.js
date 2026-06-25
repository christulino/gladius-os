/**
 * runtime/eventProcessor.js
 * Event processor — advisory-lock singleton, per-subscriber cursor drain.
 *
 * One active processor per deployment, enforced by pg_try_advisory_lock(LOCK_KEY).
 * The lock is held on a dedicated long-lived connection; if the process crashes,
 * PG releases the lock when that connection dies.
 *
 * Drain strategy: for each registered subscriber, fetch events with id >
 * subscriber.last_processed_event_id. Call handler for matching event_types,
 * advance cursor on success. On handler throw, record last_error and stop
 * draining THIS subscriber (cursor stays put, retried next tick). Other
 * subscribers continue independently.
 */

import { pool, query } from '../db/postgres.js'
import { auditLogHandler, handlesEventType as auditHandles } from './subscribers/auditLog.js'
import { notificationsHandler, handlesEventType as notificationsHandles } from './subscribers/notifications.js'
import { searchIndexHandler, handlesEventType as searchIndexHandles } from './subscribers/searchIndex.js'

const LOCK_KEY              = 0x0F105053   // 'FlOS' — unique Gladius processor key (value frozen — changing breaks advisory lock continuity)
const SAFETY_POLL_MS        = 30_000
const BATCH_SIZE            = 100
const DEAD_LETTER_THRESHOLD = 5           // advance past an event after this many consecutive failures

// Module state
let isPrimary       = false
let lockConn        = null
let safetyPollTimer = null
let failoverTimer   = null
let drainPending    = false
let draining        = false
let rearmRequested  = false

const SUBSCRIBERS = []   // { name, handles, handler, isPaused (loaded) }

// =============================================================================
// SUBSCRIBER REGISTRY
// =============================================================================

export function registerSubscriber({ name, handles, handler }) {
  if (!name || !handles || !handler) {
    throw new Error('registerSubscriber requires { name, handles, handler }')
  }
  if (SUBSCRIBERS.find(s => s.name === name)) {
    throw new Error(`Subscriber "${name}" already registered`)
  }
  SUBSCRIBERS.push({ name, handles, handler, isPaused: false })
}

// Test-only
export function clearSubscribersForTests() {
  SUBSCRIBERS.length = 0
}

// =============================================================================
// LIFECYCLE
// =============================================================================

/**
 * Start the processor. Attempts to take the advisory lock. If another API
 * instance holds it, retries every SAFETY_POLL_MS.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forceTakeLock] - release any existing lock held by this process first (tests)
 */
export async function startProcessor({ forceTakeLock = false } = {}) {
  if (forceTakeLock && lockConn) {
    await stopProcessor()
  }
  const locked = await tryAcquireAdvisoryLock()
  if (locked) {
    await becomePrimary()
    return
  }
  // Another instance holds the lock — poll in case it dies.
  failoverTimer = setInterval(async () => {
    const got = await tryAcquireAdvisoryLock()
    if (got) {
      clearInterval(failoverTimer)
      failoverTimer = null
      await becomePrimary()
    }
  }, SAFETY_POLL_MS)
}

export async function stopProcessor() {
  if (safetyPollTimer) { clearInterval(safetyPollTimer); safetyPollTimer = null }
  if (failoverTimer)   { clearInterval(failoverTimer);   failoverTimer   = null }
  if (lockConn) {
    try { await lockConn.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]) }
    catch (err) { console.warn('[events] pg_advisory_unlock failed (continuing):', err.message) }
    try { lockConn.release() }
    catch (err) { console.warn('[events] lock connection release failed (continuing):', err.message) }
    lockConn = null
  }
  isPrimary = false
}

async function becomePrimary() {
  isPrimary = true
  await upsertSubscriberRows()
  await loadSubscriberState()
  safetyPollTimer = setInterval(drainAll, SAFETY_POLL_MS)
  await drainAll()
}

// =============================================================================
// ADVISORY LOCK
// =============================================================================

async function tryAcquireAdvisoryLock() {
  if (lockConn) return true   // already held
  const conn = await pool.connect()
  try {
    const { rows } = await conn.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY])
    if (rows[0].locked) {
      lockConn = conn
      return true
    }
    conn.release()
    return false
  } catch (err) {
    conn.release()
    throw err
  }
}

// =============================================================================
// SUBSCRIBER STATE (persisted in runtime.event_subscribers)
// =============================================================================

async function upsertSubscriberRows() {
  for (const sub of SUBSCRIBERS) {
    await query(`
      INSERT INTO runtime.event_subscribers (name)
      VALUES ($1)
      ON CONFLICT (name) DO NOTHING
    `, [sub.name])
  }
}

async function loadSubscriberState() {
  if (!SUBSCRIBERS.length) return
  const names = SUBSCRIBERS.map(s => s.name)
  const { rows } = await query(
    'SELECT name, is_paused FROM runtime.event_subscribers WHERE name = ANY($1)',
    [names]
  )
  const byName = new Map(rows.map(r => [r.name, r.is_paused]))
  for (const sub of SUBSCRIBERS) {
    sub.isPaused = byName.get(sub.name) ?? false
  }
}

// =============================================================================
// DRAIN
// =============================================================================

export function nudge() {
  if (!isPrimary) return
  if (drainPending) return
  drainPending = true
  setImmediate(async () => {
    drainPending = false
    await drainAll()
  })
}

/**
 * Test-only synchronous drain. Requires the processor to already be primary —
 * call startProcessor({ forceTakeLock: true }) first in tests.
 */
export async function drainNow() {
  if (!isPrimary) {
    throw new Error('drainNow requires processor to be primary — call startProcessor first')
  }
  await drainAll()
}

async function drainAll() {
  if (!isPrimary) return
  if (draining) {
    rearmRequested = true
    return
  }
  draining = true
  try {
    // Ensure a row exists for each registered subscriber — covers subscribers
    // registered after becomePrimary() ran. INSERT ... ON CONFLICT DO NOTHING
    // is cheap and idempotent.
    await upsertSubscriberRows()
    // Refresh pause state from DB each tick — cheap and keeps admin toggles live
    await loadSubscriberState()
    for (const sub of SUBSCRIBERS) {
      if (sub.isPaused) continue
      await drainOne(sub)
    }
  } finally {
    draining = false
    if (rearmRequested) {
      rearmRequested = false
      setImmediate(() => drainAll())
    }
  }
}

async function drainOne(sub) {
  // Fetch cursor from DB (authoritative — another process may have reset it via admin)
  const { rows: [state] } = await query(
    'SELECT last_processed_event_id, failure_count FROM runtime.event_subscribers WHERE name = $1',
    [sub.name]
  )
  if (!state) return

  let cursor = Number(state.last_processed_event_id)
  // Seed from persisted count so we don't restart the retry window across ticks.
  let consecutiveFailures = Number(state.failure_count ?? 0)

  while (true) {
    const { rows: events } = await query(`
      SELECT id, event_type, entity_id, entity_uri, actor_id, occurred_at, payload
      FROM runtime.events
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2
    `, [cursor, BATCH_SIZE])

    if (!events.length) return

    for (const event of events) {
      const handles = sub.handles(event.event_type)

      if (!handles) {
        cursor = Number(event.id)
        await advanceCursorSkipped(sub.name, cursor)
        continue
      }

      try {
        await sub.handler(event)
        cursor = Number(event.id)
        await advanceCursor(sub.name, cursor)
        consecutiveFailures = 0
      } catch (err) {
        consecutiveFailures++
        console.warn(`[events] subscriber "${sub.name}" failed on event ${event.id} (attempt ${consecutiveFailures}): ${err.message}`)
        await recordFailure(sub.name, event.id, err)
        if (consecutiveFailures >= DEAD_LETTER_THRESHOLD) {
          console.error(`[events] subscriber "${sub.name}" dead-lettering event ${event.id} after ${consecutiveFailures} consecutive failures — ${err.message}`)
          cursor = Number(event.id)
          await advanceCursorDeadLetter(sub.name, cursor)
          consecutiveFailures = 0
          // fall through — for loop continues to next event
        } else {
          return   // cursor not advanced; next tick retries this event
        }
      }
    }
  }
}

async function advanceCursor(name, cursor) {
  await query(`
    UPDATE runtime.event_subscribers
    SET last_processed_event_id = $2,
        failure_count = 0,
        last_error = NULL,
        last_error_at = NULL,
        last_success_at = NOW(),
        events_processed_total = events_processed_total + 1,
        updated_at = NOW()
    WHERE name = $1
  `, [name, cursor])
}

/** Advance cursor for an event the subscriber does not handle.
 *  Does NOT bump events_processed_total (that counts events the subscriber actually handled). */
async function advanceCursorSkipped(name, cursor) {
  await query(`
    UPDATE runtime.event_subscribers
    SET last_processed_event_id = $2,
        updated_at = NOW()
    WHERE name = $1
  `, [name, cursor])
}

/** Advance cursor past a poison event after DEAD_LETTER_THRESHOLD consecutive failures.
 *  Preserves last_error/last_error_at for admin visibility; resets failure_count. */
async function advanceCursorDeadLetter(name, cursor) {
  await query(`
    UPDATE runtime.event_subscribers
    SET last_processed_event_id = $2,
        failure_count = 0,
        updated_at = NOW()
    WHERE name = $1
  `, [name, cursor])
}

async function recordFailure(name, eventId, err) {
  await query(`
    UPDATE runtime.event_subscribers
    SET last_error = $2,
        last_error_at = NOW(),
        failure_count = failure_count + 1,
        updated_at = NOW()
    WHERE name = $1
  `, [name, `event ${eventId}: ${err.message}`])
}

export function isProcessorPrimary() { return isPrimary }

export default {
  registerSubscriber,
  startProcessor,
  stopProcessor,
  drainNow,
  nudge,
  clearSubscribersForTests,
}

// =============================================================================
// BUILT-IN SUBSCRIBERS — registered on first import
// =============================================================================

registerSubscriber({
  name:    'audit-log',
  handles: auditHandles,
  handler: auditLogHandler,
})

registerSubscriber({
  name:    'notifications',
  handles: notificationsHandles,
  handler: notificationsHandler,
})

registerSubscriber({
  name:    'search-index',
  handles: searchIndexHandles,
  handler: searchIndexHandler,
})
