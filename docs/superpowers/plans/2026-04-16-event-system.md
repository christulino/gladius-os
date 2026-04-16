# Event System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship FlowOS's durable event system: `runtime.events` as append-only transport, `runtime.event_subscribers` as per-subscriber cursor store, `runtime.work_item_edits` as Jira-shaped field-level audit. Replace synchronous `syncToGraph()` calls and the undrained `runtime.search_index_queue` table. Wire up `neo4j-sync` and `audit-log` subscribers.

**Architecture:** Append-only event log with per-subscriber cursors (PG logical replication / Kafka pattern). Single active processor per deployment, enforced by PG advisory lock. Subscribers run independently — one failure does not block others. Events are inserted inside the caller's transaction; subscribers never block the API response.

**Tech Stack:** Node.js (ESM), Express, PostgreSQL (pg pool + advisory locks), React + Vite + shadcn/ui for admin page.

---

## Scope Adjustment from Spec

The spec listed 15 event types. While reading the current codebase to write this plan, three of them were found to have no emission site — there are no current endpoints for unlinking, editing comments, or deleting comments:

- `work_item.unlinked` — no DELETE endpoint for links exists today
- `work_item.comment_edited` — no PATCH comment endpoint
- `work_item.comment_deleted` — no DELETE comment endpoint

One event was added because its endpoint exists and the audit UI will want it:

- `exit_criteria.unacknowledged` — DELETE `/work-items/:id/exit-criteria/:criteriaId/acknowledge`

**Net v1 catalog: 13 event types.** When the missing endpoints are built in later sessions, emit calls are a one-line add. The plan does not include building those endpoints.

---

## Pre-Flight

Before executing any task below, ensure the local environment is ready:

```bash
# PostgreSQL + Neo4j running
docker-compose up -d

# Confirm schema is current
psql -h localhost -U postgres -d flowos -c "\dn"   # should list blueprint, runtime

# API server running (another terminal) — many tasks test against it
npm run dev
```

All tests in this plan are **integration tests that hit the running API on port 3000**. When a task says "run the test," assume the API server and PostgreSQL are running. If either is down, start them before running the step.

---

## File Structure

```
core/events.js                              ← emit helper, nudge hook (new)
runtime/eventProcessor.js                   ← advisory lock, drain loop, subscriber registry (new)
runtime/subscribers/
  neo4jSync.js                              ← consumes work_item.*, transition_action.* (new)
  auditLog.js                               ← consumes work_item.edited (new)
db/migrations/011_event_system.sql          ← events, event_subscribers, work_item_edits + DROP search_index_queue (new)
admin-ui/src/pages/EventSubscribers.jsx     ← admin health page (new)
tests/events-system.test.js                 ← integration tests (new)

api/server.js                               ← call startProcessor() on boot (modify)
runtime/transitions.js                      ← replace syncToGraph calls; emit transitioned + action_fired + spawn_fired (modify)
runtime/workItems.js                        ← replace search_index_queue inserts with emitEvent (modify)
runtime/exitCriteria.js                     ← emit on acknowledge/unacknowledge/waive (modify)
admin/api.js                                ← emit on edit, substate, assign/unassign, link, comment + 3 subscriber admin endpoints (modify)
admin-ui/src/App.jsx                        ← route for /admin/events (modify)
admin-ui/src/lib/api.js                     ← client calls for subscriber endpoints (modify)
```

Each file has a single responsibility. `core/events.js` is caller-facing emit. `runtime/eventProcessor.js` is the runtime machinery. Subscribers are a folder so adding `notifications.js`, `webhooks.js`, etc. later is obvious.

---

## Task 1: Migration — schema for events, subscribers, work_item_edits

**Files:**
- Create: `db/migrations/011_event_system.sql`
- Test: `tests/events-system.test.js` (bootstrap only — the real migration test is applying it)

- [ ] **Step 1.1: Write the migration file**

Create `db/migrations/011_event_system.sql`:

```sql
-- Migration 011: Event system
-- Adds runtime.events (append-only bus), runtime.event_subscribers (per-subscriber cursor),
-- and runtime.work_item_edits (Jira-shaped field audit).
-- Drops runtime.search_index_queue (retired).

-- =============================================================================
-- EVENT BUS (append-only log)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.events (
    id           BIGSERIAL    PRIMARY KEY,
    event_type   TEXT         NOT NULL,
    entity_id    INTEGER      NOT NULL,
    entity_uri   TEXT,
    actor_id     INTEGER      REFERENCES blueprint.users(id),
    occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    payload      JSONB        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type_entity
    ON runtime.events (entity_id, event_type, occurred_at);

-- =============================================================================
-- SUBSCRIBER CURSORS (per-subscriber progress + health)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.event_subscribers (
    name                     TEXT         PRIMARY KEY,
    last_processed_event_id  BIGINT       NOT NULL DEFAULT 0,
    is_paused                BOOLEAN      NOT NULL DEFAULT FALSE,
    last_error               TEXT,
    last_error_at            TIMESTAMPTZ,
    failure_count            INTEGER      NOT NULL DEFAULT 0,
    last_success_at          TIMESTAMPTZ,
    events_processed_total   BIGINT       NOT NULL DEFAULT 0,
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WORK ITEM FIELD-LEVEL EDIT AUDIT (Jira changegroup/changeitem analog)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.work_item_edits (
    id            BIGSERIAL    PRIMARY KEY,
    work_item_id  INTEGER      NOT NULL REFERENCES runtime.work_items(id) ON DELETE CASCADE,
    edited_by     INTEGER      REFERENCES blueprint.users(id),
    edited_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    edit_group_id UUID         NOT NULL DEFAULT gen_random_uuid(),
    field_key     TEXT         NOT NULL,
    field_type    TEXT         NOT NULL,
    old_value     JSONB,
    new_value     JSONB,
    UNIQUE (edit_group_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_work_item_edits_item
    ON runtime.work_item_edits (work_item_id, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_item_edits_group
    ON runtime.work_item_edits (edit_group_id);

-- pgcrypto required for gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- RETIRE LEGACY
-- =============================================================================

DROP TABLE IF EXISTS runtime.search_index_queue;
```

- [ ] **Step 1.2: Apply the migration**

Run:
```bash
psql -h localhost -U postgres -d flowos -f db/migrations/011_event_system.sql
```

Expected output: `CREATE TABLE` (3 times), `CREATE INDEX` (3 times), `CREATE EXTENSION` (or `NOTICE: extension "pgcrypto" already exists`), `DROP TABLE`.

- [ ] **Step 1.3: Verify schema**

Run:
```bash
psql -h localhost -U postgres -d flowos -c "\d runtime.events"
psql -h localhost -U postgres -d flowos -c "\d runtime.event_subscribers"
psql -h localhost -U postgres -d flowos -c "\d runtime.work_item_edits"
psql -h localhost -U postgres -d flowos -c "\dt runtime.search_index_queue"
```

Expected: first three show full schema. Last command returns "Did not find any relation named 'runtime.search_index_queue'".

- [ ] **Step 1.4: Commit**

```bash
git add db/migrations/011_event_system.sql
git commit -m "Add migration 011: event system schema

Three new tables: runtime.events (append-only bus),
runtime.event_subscribers (per-subscriber cursors), runtime.work_item_edits
(Jira-shaped field-level audit). Drops legacy runtime.search_index_queue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Emit helper (`core/events.js`)

**Files:**
- Create: `core/events.js`
- Test: `tests/events-system.test.js`

- [ ] **Step 2.1: Write the failing test**

Create `tests/events-system.test.js`:

```js
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query, getClient } from '../db/postgres.js'
import { emitEvent } from '../core/events.js'

describe('core/events.js — emitEvent', () => {
  before(async () => {
    // Isolate tests from prior events
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })

  it('inserts an event row when called inside a committed transaction', async () => {
    const client = await getClient()
    let eventId
    try {
      await client.query('BEGIN')
      eventId = await emitEvent(client, {
        eventType: 'test.emit_commits',
        entityId:  1,
        entityUri: 'flowos://system/test/1',
        actorId:   null,
        payload:   { hello: 'world' },
      })
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    assert.ok(eventId, 'emitEvent should return an id')
    const { rows } = await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].event_type, 'test.emit_commits')
    assert.equal(rows[0].payload.hello, 'world')
  })

  it('does NOT insert an event row when the transaction rolls back', async () => {
    const client = await getClient()
    let eventId
    try {
      await client.query('BEGIN')
      eventId = await emitEvent(client, {
        eventType: 'test.emit_rolls_back',
        entityId:  2,
        payload:   { rolled: 'back' },
      })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }

    const { rows } = await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])
    assert.equal(rows.length, 0, 'event row must not exist after rollback')
  })

  after(async () => {
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL. Error: `Cannot find module '../core/events.js'`.

- [ ] **Step 2.3: Write the implementation**

Create `core/events.js`:

```js
/**
 * core/events.js
 * Event emission and post-commit nudge.
 *
 * emitEvent MUST be called inside an open PostgreSQL transaction (pass the
 * client that owns BEGIN, not the pool). The event row commits with the
 * caller's transaction — no phantom events if the caller rolls back.
 *
 * nudgeAfterCommit is fire-and-forget; call it after your COMMIT succeeds.
 * It asks the processor to drain right away; if there is no in-process
 * primary, the safety-net poll picks up the event within ~30 seconds.
 */

import { nudge } from '../runtime/eventProcessor.js'

/**
 * Insert an event row. Must run inside the caller's open transaction.
 *
 * @param {pg.PoolClient} client   - PG client that owns the transaction
 * @param {Object}        options
 * @param {string}        options.eventType   - Dotted type, e.g. 'work_item.transitioned'
 * @param {number}        options.entityId    - PK of the entity that changed
 * @param {string}        [options.entityUri] - flowos:// URI, optional
 * @param {number|null}   [options.actorId]   - user id, null for system-initiated
 * @param {Object}        [options.payload]   - JSON-serializable payload
 * @returns {Promise<number>} the new event id
 */
export async function emitEvent(client, { eventType, entityId, entityUri, actorId, payload }) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('emitEvent requires a pg client (inside a transaction)')
  }
  if (!eventType || typeof eventType !== 'string') {
    throw new Error('emitEvent requires eventType (string)')
  }
  if (entityId == null) {
    throw new Error('emitEvent requires entityId')
  }

  const result = await client.query(`
    INSERT INTO runtime.events (event_type, entity_id, entity_uri, actor_id, payload)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id
  `, [
    eventType,
    entityId,
    entityUri ?? null,
    actorId ?? null,
    JSON.stringify(payload ?? {}),
  ])

  return Number(result.rows[0].id)
}

/**
 * Ask the event processor to drain now. Fire-and-forget.
 * Call this AFTER your COMMIT succeeds — not inside the transaction.
 */
export function nudgeAfterCommit() {
  setImmediate(() => nudge())
}

export default { emitEvent, nudgeAfterCommit }
```

Note: this imports `nudge` from `runtime/eventProcessor.js`, which doesn't exist yet. That's fine for Task 2's test — the test only calls `emitEvent`, not `nudgeAfterCommit`. The import will resolve once Task 3 lands.

- [ ] **Step 2.4: Add a temporary stub so the test can import this module**

Before running the test, create a minimal stub at `runtime/eventProcessor.js`:

```js
// runtime/eventProcessor.js — stub, replaced in Task 3
export function nudge() { /* no-op until Task 3 */ }
export async function startProcessor() { /* no-op until Task 3 */ }
```

- [ ] **Step 2.5: Run the test to verify it passes**

```bash
node --test tests/events-system.test.js
```

Expected: PASS, 2 tests green.

- [ ] **Step 2.6: Commit**

```bash
git add core/events.js runtime/eventProcessor.js tests/events-system.test.js
git commit -m "Add emitEvent helper with transactional invariant

emitEvent inserts into runtime.events using the caller's transaction client.
Rolled-back transactions leave no event row. nudgeAfterCommit is a
fire-and-forget post-commit hook. Temporary processor stub ships alongside
so the module graph resolves; the real processor lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Event processor (`runtime/eventProcessor.js`)

**Files:**
- Replace: `runtime/eventProcessor.js` (stub → real implementation)
- Test: `tests/events-system.test.js`

- [ ] **Step 3.1: Write failing tests**

Append to `tests/events-system.test.js`:

```js
import {
  startProcessor,
  stopProcessor,
  registerSubscriber,
  clearSubscribersForTests,
  drainNow,
} from '../runtime/eventProcessor.js'

describe('runtime/eventProcessor.js — cursor and drain', () => {
  before(async () => {
    clearSubscribersForTests()
    await query('DELETE FROM runtime.event_subscribers WHERE name LIKE $1', ['test-%'])
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })

  after(async () => {
    await stopProcessor()
    clearSubscribersForTests()
    await query('DELETE FROM runtime.event_subscribers WHERE name LIKE $1', ['test-%'])
    await query('DELETE FROM runtime.events WHERE event_type LIKE $1', ['test.%'])
  })

  it('advances subscriber cursor after successful handler', async () => {
    const seen = []
    registerSubscriber({
      name: 'test-cursor-advance',
      handles: (t) => t === 'test.cursor_a',
      handler: async (e) => { seen.push(e.id) },
    })
    await startProcessor({ forceTakeLock: true })

    // Emit 3 events outside the processor's knowledge
    const client = await getClient()
    try {
      await client.query('BEGIN')
      for (let i = 0; i < 3; i++) {
        await emitEvent(client, {
          eventType: 'test.cursor_a',
          entityId:  100 + i,
          payload:   { i },
        })
      }
      await client.query('COMMIT')
    } finally { client.release() }

    await drainNow()

    assert.equal(seen.length, 3)
    const { rows } = await query(
      'SELECT last_processed_event_id, events_processed_total FROM runtime.event_subscribers WHERE name = $1',
      ['test-cursor-advance']
    )
    assert.ok(rows[0].last_processed_event_id > 0)
    assert.equal(Number(rows[0].events_processed_total), 3)
  })

  it('leaves cursor at N-1 when handler throws on event N', async () => {
    registerSubscriber({
      name: 'test-failure',
      handles: (t) => t === 'test.fail_on_second',
      handler: async (e) => {
        if (e.payload.n === 2) throw new Error('boom')
      },
    })

    const client = await getClient()
    const emitted = []
    try {
      await client.query('BEGIN')
      for (let n = 1; n <= 3; n++) {
        const id = await emitEvent(client, {
          eventType: 'test.fail_on_second',
          entityId:  n,
          payload:   { n },
        })
        emitted.push(id)
      }
      await client.query('COMMIT')
    } finally { client.release() }

    await drainNow()

    const { rows } = await query(
      'SELECT last_processed_event_id, last_error, failure_count FROM runtime.event_subscribers WHERE name = $1',
      ['test-failure']
    )
    assert.equal(Number(rows[0].last_processed_event_id), emitted[0],
      'cursor should sit at the last successful event (first one)')
    assert.match(rows[0].last_error, /boom/)
    assert.ok(rows[0].failure_count >= 1)
  })

  it('skips past events a subscriber does not handle (advances cursor without calling handler)', async () => {
    const handled = []
    registerSubscriber({
      name: 'test-filter',
      handles: (t) => t === 'test.want_this',
      handler: async (e) => { handled.push(e.payload.label) },
    })

    const client = await getClient()
    try {
      await client.query('BEGIN')
      await emitEvent(client, { eventType: 'test.dont_want', entityId: 1, payload: { label: 'skip_me' } })
      await emitEvent(client, { eventType: 'test.want_this', entityId: 2, payload: { label: 'take_me' } })
      await emitEvent(client, { eventType: 'test.dont_want', entityId: 3, payload: { label: 'skip_me_too' } })
      await client.query('COMMIT')
    } finally { client.release() }

    await drainNow()

    assert.deepEqual(handled, ['take_me'])
    const { rows } = await query(
      'SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = $1',
      ['test-filter']
    )
    assert.ok(Number(rows[0].last_processed_event_id) > 0,
      'cursor should advance past skipped events')
  })
})
```

- [ ] **Step 3.2: Run the tests to verify they fail**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL. Errors like `registerSubscriber is not a function` — the stub does not implement these.

- [ ] **Step 3.3: Write the processor**

Replace `runtime/eventProcessor.js` contents:

```js
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

import pkg from 'pg'
import { pool, query, getClient } from '../db/postgres.js'

const { Pool } = pkg

const LOCK_KEY        = 0x0F105053   // 'FlOS' as an int — unique FlowOS processor key
const SAFETY_POLL_MS  = 30_000
const BATCH_SIZE      = 100

// Module state
let isPrimary       = false
let lockConn        = null
let safetyPollTimer = null
let failoverTimer   = null
let drainPending    = false
let draining        = false

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
    try { await lockConn.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]) } catch {}
    try { lockConn.release() } catch {}
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
  for (const sub of SUBSCRIBERS) {
    const { rows } = await query(
      'SELECT is_paused FROM runtime.event_subscribers WHERE name = $1',
      [sub.name]
    )
    sub.isPaused = rows[0]?.is_paused ?? false
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

/** Test-only synchronous drain. */
export async function drainNow() {
  if (!isPrimary) {
    // For tests running without a held lock — take it.
    await startProcessor({ forceTakeLock: false })
    if (!isPrimary) throw new Error('Could not acquire processor lock for drainNow')
  }
  await drainAll()
}

async function drainAll() {
  if (!isPrimary || draining) return
  draining = true
  try {
    // Refresh pause state from DB each tick — cheap and keeps admin toggles live
    await loadSubscriberState()
    for (const sub of SUBSCRIBERS) {
      if (sub.isPaused) continue
      await drainOne(sub)
    }
  } finally {
    draining = false
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
        await advanceCursor(sub.name, cursor)
        continue
      }

      try {
        await sub.handler(event)
        cursor = Number(event.id)
        await advanceCursor(sub.name, cursor)
      } catch (err) {
        await recordFailure(sub.name, event.id, err)
        return   // cursor not advanced; next tick retries this event
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

export default {
  registerSubscriber,
  startProcessor,
  stopProcessor,
  drainNow,
  nudge,
  clearSubscribersForTests,
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

```bash
node --test tests/events-system.test.js
```

Expected: PASS, 5 tests green (2 from Task 2 + 3 from Task 3).

- [ ] **Step 3.5: Commit**

```bash
git add runtime/eventProcessor.js tests/events-system.test.js
git commit -m "Add event processor with advisory lock and per-subscriber cursors

Processor takes a PG advisory lock at boot so only one instance drains
across an API cluster. Each subscriber advances its own cursor in
runtime.event_subscribers. Handler failures record last_error and halt
that subscriber's drain; other subscribers continue. Events a subscriber
does not handle still advance the cursor (skip-past). Safety-net poll
every 30s recovers from missed nudges.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire processor into API boot

**Files:**
- Modify: `api/server.js` (add import + startProcessor call)

- [ ] **Step 4.1: Modify `api/server.js`**

Add the import near the other runtime imports (after `import adminApiRoutes from '../admin/api.js'`):

```js
import { startProcessor } from '../runtime/eventProcessor.js'
```

Replace the `app.listen(...)` block at the bottom of the file with:

```js
app.listen(PORT, async () => {
  console.log(`[api] Flow OS running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
  console.log(`[api] Health: http://localhost:${PORT}/health`)
  try {
    await startProcessor()
    console.log('[events] Processor started')
  } catch (err) {
    console.error('[events] Processor failed to start:', err.message)
  }
})
```

- [ ] **Step 4.2: Restart the dev server**

Stop any running `npm run dev`, then:

```bash
npm run dev
```

Expected startup output:
```
[api] Flow OS running on port 3000 (development)
[api] Health: http://localhost:3000/health
[events] Processor started
```

- [ ] **Step 4.3: Verify the advisory lock is held**

```bash
psql -h localhost -U postgres -d flowos -c "SELECT locktype, objid, mode, granted FROM pg_locks WHERE locktype = 'advisory';"
```

Expected: one row with `objid = 252779603` (decimal of 0x0F105053), `mode = ExclusiveLock`, `granted = t`.

- [ ] **Step 4.4: Commit**

```bash
git add api/server.js
git commit -m "Start event processor at API boot

startProcessor() runs after app.listen. A failure to start is logged but
does not crash the server (events accumulate and will be drained when a
subsequent boot succeeds).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: neo4j-sync subscriber

**Files:**
- Create: `runtime/subscribers/neo4jSync.js`
- Modify: `runtime/eventProcessor.js` (register subscriber at module scope)

- [ ] **Step 5.1: Write failing test**

Append to `tests/events-system.test.js`:

```js
import { neo4jSyncHandler } from '../runtime/subscribers/neo4jSync.js'

describe('subscribers/neo4jSync — event-type mapping', () => {
  it('routes work_item.created to syncToGraph work_item create', async () => {
    // We just assert the handler does not throw when called with a synthetic event.
    // Full Neo4j end-to-end sync is tested in Task 14.
    await neo4jSyncHandler({
      id: 9999,
      event_type: 'work_item.created',
      entity_id: 1,
      entity_uri: 'flowos://test/work-items/abc',
      actor_id: null,
      occurred_at: new Date(),
      payload: {
        title: 'Test', work_item_type_uri: null, owner_org_uri: 'flowos://test/orgs/x',
        owner_org_slug: 'x', current_stage_uri: null, current_stage_name: null,
        current_stage_class: null, current_substate: 'active', spawn_state: 'active',
        service_class: 'standard', sla_status: 'no_sla', due_date: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  })

  it('is a no-op for unmapped event types', async () => {
    await neo4jSyncHandler({
      id: 9998,
      event_type: 'unknown.event_type',
      entity_id: 1,
      payload: {},
    })
    // should not throw
  })
})
```

- [ ] **Step 5.2: Run the test — expect failure**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL with `Cannot find module '../runtime/subscribers/neo4jSync.js'`.

- [ ] **Step 5.3: Write the subscriber**

Create `runtime/subscribers/neo4jSync.js`:

```js
/**
 * runtime/subscribers/neo4jSync.js
 * Replaces the former synchronous syncToGraph() calls in transitions.js and
 * workItems.js. Thin mapper from event type → existing graph/sync.js handlers.
 */

import { syncToGraph } from '../../graph/sync.js'

const HANDLED_PREFIXES = ['work_item.', 'transition_action.']

export function handlesEventType(eventType) {
  return HANDLED_PREFIXES.some(p => eventType.startsWith(p))
}

export async function neo4jSyncHandler(event) {
  switch (event.event_type) {

    case 'work_item.created':
      return syncToGraph('work_item', event.entity_uri, 'create', event.payload)

    case 'work_item.edited':
      // payload.current contains the up-to-date work item snapshot
      return syncToGraph('work_item', event.entity_uri, 'update',
        event.payload.current ?? event.payload)

    case 'work_item.transitioned':
      return syncToGraph('stage_transition', event.entity_uri, 'update', event.payload)

    case 'work_item.substate_changed':
      return syncToGraph('work_item', event.entity_uri, 'update', event.payload)

    case 'work_item.assigned':
      return syncToGraph('user_relationship', event.entity_uri, 'upsert', event.payload)

    case 'work_item.unassigned':
      return syncToGraph('user_relationship', event.entity_uri, 'delete', event.payload)

    case 'work_item.linked':
      // parent/child links are captured by work_item.created relationship logic in sync.js
      // for explicit relinking, re-upsert the work item
      return syncToGraph('work_item', event.entity_uri, 'update', event.payload.current ?? event.payload)

    case 'work_item.commented':
      // Comments are not currently Neo4j entities — no-op.
      return

    case 'transition_action.spawn_fired':
      return syncToGraph('work_item', event.payload.spawned_uri, 'create', event.payload.spawned)

    case 'transition_action.api_call_fired':
      // Informational — no Neo4j effect.
      return

    default:
      // Unknown work_item.* or transition_action.* event type — log and move on.
      console.warn(`[neo4j-sync] No mapping for event_type "${event.event_type}"`)
      return
  }
}

export default { neo4jSyncHandler, handlesEventType }
```

- [ ] **Step 5.4: Register the subscriber at module scope in eventProcessor.js**

Open `runtime/eventProcessor.js`. Near the top of the file (after imports, before the module-state `let` declarations), add:

```js
import { neo4jSyncHandler, handlesEventType as neo4jHandles } from './subscribers/neo4jSync.js'
```

Then at the bottom of the file (after `export default { ... }`), add:

```js
// =============================================================================
// BUILT-IN SUBSCRIBERS — registered on first import
// =============================================================================

registerSubscriber({
  name:    'neo4j-sync',
  handles: neo4jHandles,
  handler: neo4jSyncHandler,
})
```

- [ ] **Step 5.5: Run the test — expect pass**

```bash
node --test tests/events-system.test.js
```

Expected: all tests pass (7 total).

- [ ] **Step 5.6: Restart dev server + verify subscriber row exists**

```bash
# Restart npm run dev in the other terminal, then:
psql -h localhost -U postgres -d flowos -c "SELECT * FROM runtime.event_subscribers WHERE name = 'neo4j-sync';"
```

Expected: one row with `last_processed_event_id = 0`, `is_paused = false`.

- [ ] **Step 5.7: Commit**

```bash
git add runtime/subscribers/neo4jSync.js runtime/eventProcessor.js tests/events-system.test.js
git commit -m "Add neo4j-sync event subscriber

Maps work_item.* and transition_action.* events to existing syncToGraph
handlers in graph/sync.js. Registered at module scope so a single import
of eventProcessor.js wires it into the drain loop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: audit-log subscriber

**Files:**
- Create: `runtime/subscribers/auditLog.js`
- Modify: `runtime/eventProcessor.js` (register)

- [ ] **Step 6.1: Write failing test**

Append to `tests/events-system.test.js`:

```js
import { auditLogHandler, handlesEventType as auditHandles } from '../runtime/subscribers/auditLog.js'

describe('subscribers/auditLog — writes work_item_edits rows', () => {
  let workItemId

  before(async () => {
    // Need a real work item id to satisfy the FK. Use the first one in the DB.
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    assert.ok(rows.length, 'Need at least one work item in the DB (run npm run seed)')
    workItemId = rows[0].id
    await query('DELETE FROM runtime.work_item_edits WHERE work_item_id = $1', [workItemId])
  })

  it('writes one row per field change, all sharing edit_group_id', async () => {
    const groupId = '00000000-0000-0000-0000-000000000001'
    await auditLogHandler({
      id: 1,
      event_type: 'work_item.edited',
      entity_id: workItemId,
      actor_id: null,
      occurred_at: new Date(),
      payload: {
        edit_group_id: groupId,
        changes: [
          { field: 'title',    type: 'text',   old: 'Old title', new: 'New title' },
          { field: 'priority', type: 'number', old: 3,           new: 1 },
        ],
      },
    })

    const { rows } = await query(
      'SELECT field_key, edit_group_id FROM runtime.work_item_edits WHERE work_item_id = $1 ORDER BY field_key',
      [workItemId]
    )
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map(r => r.field_key).sort(), ['priority', 'title'])
    assert.equal(rows[0].edit_group_id, groupId)
    assert.equal(rows[1].edit_group_id, groupId)
  })

  it('is idempotent — reprocessing the same event does not duplicate rows', async () => {
    const groupId = '00000000-0000-0000-0000-000000000002'
    const event = {
      id: 2,
      event_type: 'work_item.edited',
      entity_id: workItemId,
      actor_id: null,
      occurred_at: new Date(),
      payload: {
        edit_group_id: groupId,
        changes: [{ field: 'description', type: 'textarea', old: null, new: 'new desc' }],
      },
    }

    await auditLogHandler(event)
    await auditLogHandler(event)   // run twice

    const { rows } = await query(
      'SELECT COUNT(*) AS n FROM runtime.work_item_edits WHERE edit_group_id = $1',
      [groupId]
    )
    assert.equal(Number(rows[0].n), 1, 'double-processing must not duplicate')
  })

  after(async () => {
    await query('DELETE FROM runtime.work_item_edits WHERE work_item_id = $1', [workItemId])
  })
})
```

- [ ] **Step 6.2: Run — expect failure**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL with module-not-found for `auditLog.js`.

- [ ] **Step 6.3: Write the subscriber**

Create `runtime/subscribers/auditLog.js`:

```js
/**
 * runtime/subscribers/auditLog.js
 * Consumes work_item.edited and writes one runtime.work_item_edits row per
 * field change, all sharing the event's edit_group_id. Idempotent via the
 * UNIQUE(edit_group_id, field_key) constraint on the audit table.
 */

import { query } from '../../db/postgres.js'

export function handlesEventType(eventType) {
  return eventType === 'work_item.edited'
}

export async function auditLogHandler(event) {
  const { edit_group_id, changes } = event.payload ?? {}
  if (!edit_group_id || !Array.isArray(changes)) {
    throw new Error('work_item.edited payload missing edit_group_id or changes[]')
  }

  for (const change of changes) {
    const { field, type, old: oldVal, new: newVal } = change
    if (!field || !type) {
      throw new Error(`change entry missing field/type: ${JSON.stringify(change)}`)
    }
    await query(`
      INSERT INTO runtime.work_item_edits
        (work_item_id, edited_by, edited_at, edit_group_id,
         field_key, field_type, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      ON CONFLICT (edit_group_id, field_key) DO NOTHING
    `, [
      event.entity_id,
      event.actor_id,
      event.occurred_at,
      edit_group_id,
      field,
      type,
      oldVal === undefined ? null : JSON.stringify(oldVal),
      newVal === undefined ? null : JSON.stringify(newVal),
    ])
  }
}

export default { auditLogHandler, handlesEventType }
```

- [ ] **Step 6.4: Register in eventProcessor.js**

Open `runtime/eventProcessor.js`. Add near the top, next to the neo4j import:

```js
import { auditLogHandler, handlesEventType as auditHandles } from './subscribers/auditLog.js'
```

At the bottom (next to the existing `registerSubscriber` call for neo4j), add:

```js
registerSubscriber({
  name:    'audit-log',
  handles: auditHandles,
  handler: auditLogHandler,
})
```

- [ ] **Step 6.5: Run the tests — expect pass**

```bash
node --test tests/events-system.test.js
```

Expected: all tests pass (9 total).

- [ ] **Step 6.6: Commit**

```bash
git add runtime/subscribers/auditLog.js runtime/eventProcessor.js tests/events-system.test.js
git commit -m "Add audit-log event subscriber

Consumes work_item.edited events and writes one runtime.work_item_edits
row per field change, grouped by edit_group_id. Idempotent via the
UNIQUE (edit_group_id, field_key) constraint — reprocessing after a
cursor stall never duplicates audit rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Replace `syncToGraph` in `runtime/transitions.js` and emit events

**Files:**
- Modify: `runtime/transitions.js`

The existing post-commit block calls `syncToGraph(...)` synchronously (lines ~278-291). We replace those with in-transaction `emitEvent(client, ...)` calls. We also add emissions for `transition_action.spawn_fired` (inside spawn action loop) and `transition_action.api_call_fired` (inside `fireApiCallAction` after it has a result).

- [ ] **Step 7.1: Change imports at top of `runtime/transitions.js`**

Replace:
```js
import { query, getClient }        from '../db/postgres.js'
import { syncToGraph }             from '../graph/sync.js'
import { evaluateExitCriteria, populateExitCriteriaStatus } from './exitCriteria.js'
import { resolveOrgCalendar, calculateWorkingTime } from '../core/calendar.js'
```

With:
```js
import { query, getClient }        from '../db/postgres.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
import { evaluateExitCriteria, populateExitCriteriaStatus } from './exitCriteria.js'
import { resolveOrgCalendar, calculateWorkingTime } from '../core/calendar.js'
```

(`syncToGraph` import is removed — transitions.js no longer calls it directly. The neo4j-sync subscriber calls it from events now.)

- [ ] **Step 7.2: Emit `work_item.transitioned` inside the transaction**

Find this block in `executeTransition` (around line 252, right after `transitionHistoryId = historyResult.rows[0].id`):

```js
    // 4. Execute spawn actions (fatal if any fail — rolls back entire transaction)
    for (const action of allSpawns) {
      const spawned = await executeSpawnAction(client, action, workItem, transitionHistoryId, now)
      spawnedWorkItems.push(spawned)
    }

    await client.query('COMMIT')
```

Before the `COMMIT`, add the transition event emission. The spawn loop already exists — we only change the body of `executeSpawnAction` (Step 7.3) to also emit and then add the transition emit here.

Replace that block with:

```js
    // 4. Execute spawn actions (fatal if any fail — rolls back entire transaction)
    for (const action of allSpawns) {
      const spawned = await executeSpawnAction(client, action, workItem, transitionHistoryId, now)
      spawnedWorkItems.push(spawned)
    }

    // 5. Emit the transition event (in-tx — rolls back with the transition)
    await emitEvent(client, {
      eventType: 'work_item.transitioned',
      entityId:  workItemId,
      entityUri: workItem.uri,
      actorId:   userId,
      payload: {
        from_stage_id:          workItem.current_stage_id,
        to_stage_id:            toStageId,
        to_stage_uri:           toStage.uri,
        to_stage_name:          toStage.name,
        to_stage_class:         toStage.stage_class,
        transition_history_id:  transitionHistoryId,
        working_time_seconds:   workingTime,
        reason:                 reason ?? null,
        initial_substate:       newSubstate,
      },
    })

    await client.query('COMMIT')
```

- [ ] **Step 7.3: Emit `transition_action.spawn_fired` inside `executeSpawnAction`**

Find `executeSpawnAction` (around line 325). Its last step currently is:

```js
  // Log the spawn action
  await client.query(`
    INSERT INTO runtime.transition_action_log (
      stage_transition_history_id, action_type,
      executed_at, was_accepted, spawned_work_item_id
    ) VALUES ($1, 'spawn', $2, true, $3)
  `, [historyId, now, spawned.id])

  return spawned
```

Replace with:

```js
  // Log the spawn action
  await client.query(`
    INSERT INTO runtime.transition_action_log (
      stage_transition_history_id, action_type,
      executed_at, was_accepted, spawned_work_item_id
    ) VALUES ($1, 'spawn', $2, true, $3)
  `, [historyId, now, spawned.id])

  // Emit spawn fired event (so neo4j-sync creates the child node)
  await emitEvent(client, {
    eventType: 'transition_action.spawn_fired',
    entityId:  workItem.id,
    entityUri: workItem.uri,
    actorId:   null,     // spawns are system-initiated within a transition
    payload: {
      transition_action_id: action.id,
      stage_transition_history_id: historyId,
      spawned_work_item_id: spawned.id,
      spawned_uri:          spawned.uri,
      spawned_type_id:      action.spawn_work_item_type_id,
      spawned:              spawned,
    },
  })

  // Emit work_item.created for the spawned item so neo4j-sync picks it up
  await emitEvent(client, {
    eventType: 'work_item.created',
    entityId:  spawned.id,
    entityUri: spawned.uri,
    actorId:   null,
    payload: {
      title:               spawned.title,
      work_item_type_uri:  null,   // handler tolerates null; graph/sync has defaults
      owner_org_uri:       spawned.owner_org_uri,
      owner_org_slug:      spawned.owner_org_slug,
      current_stage_uri:   spawned.current_stage_uri,
      current_stage_name:  spawned.current_stage_name,
      current_stage_class: spawned.current_stage_class,
      current_substate:    'active',
      spawn_state:         spawned.spawn_state,
      service_class:       'standard',
      sla_status:          'no_sla',
      due_date:            null,
      created_at:          spawned.created_at,
      updated_at:          spawned.updated_at,
    },
  })

  return spawned
```

- [ ] **Step 7.4: Replace the post-transaction `syncToGraph` block with a nudge**

Find the "POST-TRANSACTION" section (around line 272). Replace this block:

```js
  // =========================================================================
  // POST-TRANSACTION — fire and forget, never rolls back the transition
  // =========================================================================

  // Sync to Neo4j — synchronous
  try {
    await syncToGraph('stage_transition', workItem.uri, 'update', {
      to_stage_uri:   toStage.uri,
      to_stage_name:  toStage.name,
      to_stage_class: toStage.stage_class,
      sla_status:     'on_track',
    })
    // Also sync each spawned work item to Neo4j
    for (const spawned of spawnedWorkItems) {
      await syncToGraph('work_item', spawned.uri, 'create', spawned)
    }
  } catch (err) {
    console.error('[transitions] Neo4j sync failed (non-fatal):', err.message)
  }

  // Fire api_call actions — truly fire and forget
  for (const action of apiCallActions) {
    fireApiCallAction(action, workItem, transitionHistoryId)
      .catch(err => console.error(`[transitions] api_call action ${action.id} failed:`, err.message))
  }
```

With:

```js
  // =========================================================================
  // POST-TRANSACTION — fire and forget, never rolls back the transition
  // =========================================================================

  // Nudge the event processor so subscribers (neo4j-sync, audit-log) drain now
  nudgeAfterCommit()

  // Fire api_call actions — truly fire and forget.
  // Each action logs its own runtime.transition_action_log row AND emits
  // transition_action.api_call_fired after the call completes.
  for (const action of apiCallActions) {
    fireApiCallAction(action, workItem, transitionHistoryId)
      .catch(err => console.error(`[transitions] api_call action ${action.id} failed:`, err.message))
  }
```

- [ ] **Step 7.5: Update `fireApiCallAction` to emit the api_call_fired event**

Find `fireApiCallAction` (around line 434). After the existing `await query('INSERT INTO runtime.transition_action_log ...')` call, add the event emission. Replace the full function body with:

```js
async function fireApiCallAction(action, workItem, historyId) {
  const payload = interpolateTemplate(action.api_payload_template, workItem)
  const startedAt = new Date()
  let responseCode = null
  let responseBody = null
  let failed = false
  let failureReason = null

  try {
    const response = await fetch(action.api_endpoint, {
      method:  action.api_method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(action.api_headers || {}),
      },
      body: JSON.stringify(payload),
    })
    responseCode = response.status
    responseBody = await response.json().catch(() => null)
    failed = !response.ok
    if (failed) failureReason = `HTTP ${responseCode}`
  } catch (err) {
    failed = true
    failureReason = err.message
  }

  // Log the result — best effort, don't throw
  await query(`
    INSERT INTO runtime.transition_action_log (
      stage_transition_history_id, action_type,
      executed_at, api_endpoint, api_response_code,
      api_response_body, api_failed, api_failure_reason
    ) VALUES ($1, 'api_call', $2, $3, $4, $5, $6, $7)
  `, [
    historyId, startedAt,
    action.api_endpoint, responseCode,
    responseBody ? JSON.stringify(responseBody) : null,
    failed, failureReason,
  ]).catch(err => console.error('[transitions] Failed to log api_call result:', err.message))

  // Emit event — post-transaction, so use a short-lived tx of its own.
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await emitEvent(client, {
      eventType: 'transition_action.api_call_fired',
      entityId:  workItem.id,
      entityUri: workItem.uri,
      actorId:   null,
      payload: {
        transition_action_id:        action.id,
        stage_transition_history_id: historyId,
        endpoint:                    action.api_endpoint,
        method:                      action.api_method || 'POST',
        response_code:               responseCode,
        failed,
        failure_reason:              failureReason,
        started_at:                  startedAt.toISOString(),
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[transitions] Failed to emit api_call_fired event:', err.message)
  } finally {
    client.release()
  }
}
```

- [ ] **Step 7.6: Run all tests**

```bash
node --test tests/*.test.js
```

Expected: all pass. If the existing workflow-api tests use transitions, they should still pass because behavior is preserved — just the Neo4j path has moved.

- [ ] **Step 7.7: Manual smoke test**

```bash
# With API running and a seeded DB
psql -h localhost -U postgres -d flowos -c "DELETE FROM runtime.events;"

# Run a transition via the UI or curl
curl -b cookies.txt -X POST http://localhost:3000/admin/api/work-items/1/transition \
  -H 'Content-Type: application/json' \
  -d '{"to_stage_id": <a valid stage id>, "reason": "test"}'

# Verify the event landed
psql -h localhost -U postgres -d flowos \
  -c "SELECT event_type, entity_id, payload->>'transition_history_id' FROM runtime.events ORDER BY id DESC LIMIT 5;"
```

Expected: at least one `work_item.transitioned` row.

- [ ] **Step 7.8: Commit**

```bash
git add runtime/transitions.js
git commit -m "Replace syncToGraph calls in transitions with event emissions

Transition now emits work_item.transitioned + transition_action.spawn_fired
+ transition_action.api_call_fired events. The neo4j-sync subscriber picks
these up and calls graph/sync.js out-of-band. Post-commit nudgeAfterCommit
triggers an immediate drain.

Fixes latent bug: transitions were blocking on Neo4j sync despite
documentation saying it was async. Now truly non-blocking.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Replace `search_index_queue` writes in `runtime/workItems.js`

**Files:**
- Modify: `runtime/workItems.js`

- [ ] **Step 8.1: Change imports**

At the top of `runtime/workItems.js`, add:

```js
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
```

- [ ] **Step 8.2: Replace the `search_index_queue` insert in `createWorkItem`**

Find (around line 249):

```js
    // Queue Neo4j sync — async, non-blocking
    await client.query(`
      INSERT INTO runtime.search_index_queue
        (resource_type, resource_id, operation, queued_at)
      VALUES ('work_item', $1, 'index', $2)
    `, [workItem.id, now])

    await client.query('COMMIT')
```

Replace with (the identifiers `workItem`, `workItemType`, `org`, `entry_stage_name` are already in scope in this function):

```js
    // Emit work_item.created event (in-tx — rolls back with the insert)
    await emitEvent(client, {
      eventType: 'work_item.created',
      entityId:  workItem.id,
      entityUri: workItem.uri,
      actorId:   userId ?? null,
      payload: {
        title:               workItem.title,
        work_item_type_uri:  workItemType.uri ?? null,
        work_item_type_name: workItemType.name,
        owner_org_uri:       org.uri,
        owner_org_slug:      org.slug,
        current_stage_id:    workItem.current_stage_id,
        current_stage_name:  entry_stage_name,
        current_substate:    workItem.current_substate,
        spawn_state:         workItem.spawn_state,
        service_class:       'standard',
        sla_status:          'no_sla',
        due_date:            workItem.due_date,
        parent_id:           workItem.parent_id,
        created_at:          workItem.created_at,
        updated_at:          workItem.updated_at,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
```

If `workItemType.uri` is not in scope at this point, the handler tolerates `null` — it's fine to omit and let it default.

- [ ] **Step 8.3: Replace the second `search_index_queue` insert (reindex path)**

Find (around line 341):

```js
  // Queue Neo4j sync
  await query(`
    INSERT INTO runtime.search_index_queue
      (resource_type, resource_id, operation, queued_at)
    VALUES ('work_item', $1, 'reindex', $2)
  `, [workItem.id, now])

  return {
```

Replace with:

```js
  // Emit work_item.edited event so neo4j-sync reindexes.
  // This function runs in `completeWorkItem` / field-update flow — a short-lived
  // tx of its own is fine since we are outside the main transaction here.
  const evtClient = await getClient()
  try {
    await evtClient.query('BEGIN')
    await emitEvent(evtClient, {
      eventType: 'work_item.edited',
      entityId:  workItem.id,
      entityUri: workItem.uri,
      actorId:   userId ?? null,
      payload: {
        edit_group_id: randomUUID(),
        changes: [],                  // empty — this is a field-completion re-sync, not a diff
        current: workItem,
      },
    })
    await evtClient.query('COMMIT')
    nudgeAfterCommit()
  } catch (err) {
    await evtClient.query('ROLLBACK').catch(() => {})
    console.error('[workItems] Failed to emit work_item.edited after field completion:', err.message)
  } finally {
    evtClient.release()
  }

  return {
```

Add the import at the top of the file if not already present:

```js
import { randomUUID } from 'node:crypto'
```

- [ ] **Step 8.4: Update the file-level docstring**

Replace `*   - Neo4j sync is async via search_index_queue` (line 7) with:
```
 *   - Neo4j sync is async via runtime.events (neo4j-sync subscriber)
```

- [ ] **Step 8.5: Run tests**

```bash
node --test tests/*.test.js
```

Expected: all pass.

- [ ] **Step 8.6: Manual smoke test**

```bash
psql -h localhost -U postgres -d flowos -c "DELETE FROM runtime.events;"

# Create a work item via UI or API
# Then check:
psql -h localhost -U postgres -d flowos \
  -c "SELECT event_type, entity_id FROM runtime.events ORDER BY id DESC LIMIT 3;"
```

Expected: `work_item.created` row with the new work item's id.

- [ ] **Step 8.7: Commit**

```bash
git add runtime/workItems.js
git commit -m "Replace search_index_queue writes in workItems with event emissions

Work item creation now emits work_item.created in-tx. Field-completion
re-sync emits work_item.edited. The dropped search_index_queue table
was never drained — this was effectively dead code, now live plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Convert PATCH `/work-items/:id` to tx + diff emission

This is the most delicate change. The current endpoint uses a single pool query; to emit a delta-payload event, we must SELECT old values, UPDATE with new values, and emit the diff — all in one transaction.

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 9.1: Write failing test**

Append to `tests/events-system.test.js`:

```js
import { createAuthApi } from './helpers/auth.js'
const api = createAuthApi()

describe('PATCH /work-items/:id — emits work_item.edited + writes audit rows', () => {
  let workItemId
  before(async () => {
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    workItemId = rows[0].id
    await query('DELETE FROM runtime.events WHERE event_type = $1', ['work_item.edited'])
    await query('DELETE FROM runtime.work_item_edits WHERE work_item_id = $1', [workItemId])
  })

  it('emits one event and writes one audit row per changed field', async () => {
    const { status } = await api(`/work-items/${workItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Edited by test ' + Date.now(), priority: 1 }),
    })
    assert.equal(status, 200)

    // Give the processor a moment to drain
    await new Promise(r => setTimeout(r, 500))

    const { rows: events } = await query(
      `SELECT payload FROM runtime.events
       WHERE event_type = 'work_item.edited' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [workItemId]
    )
    assert.equal(events.length, 1)
    assert.ok(Array.isArray(events[0].payload.changes))
    const fields = events[0].payload.changes.map(c => c.field)
    assert.ok(fields.includes('title'))
    assert.ok(fields.includes('priority'))

    const { rows: audit } = await query(
      `SELECT field_key FROM runtime.work_item_edits
       WHERE edit_group_id = $1
       ORDER BY field_key`,
      [events[0].payload.edit_group_id]
    )
    assert.equal(audit.length, 2)
  })

  it('does not emit when the PATCH changes nothing', async () => {
    // Fetch current title
    const { data } = await api(`/work-items/${workItemId}`)
    const current = data.title

    await query('DELETE FROM runtime.events WHERE event_type = $1', ['work_item.edited'])

    const { status } = await api(`/work-items/${workItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: current }),
    })
    assert.equal(status, 200)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM runtime.events
       WHERE event_type = 'work_item.edited' AND entity_id = $1`,
      [workItemId]
    )
    assert.equal(rows[0].n, 0)
  })
})
```

- [ ] **Step 9.2: Run — expect failure**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL — current PATCH does not emit.

- [ ] **Step 9.3: Modify the PATCH handler**

In `admin/api.js`, add imports at the top if not already present:

```js
import { getClient } from '../db/postgres.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
import { randomUUID } from 'node:crypto'
```

Find the `router.patch('/work-items/:id', ...)` at line ~2143. Replace its body with:

```js
router.patch('/work-items/:id', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  if (!workItemId) return res.status(400).json({ error: 'Invalid id' })

  const { title, description, field_values, due_date, is_expedited, work_nature,
          priority, tags, estimate, estimate_unit, origin, requester_id } = req.body

  // Map request fields → (column, type, incoming value)
  const UPDATABLE = [
    { field: 'title',         type: 'text',     col: 'title',         incoming: title,         transform: v => v?.trim() },
    { field: 'description',   type: 'textarea', col: 'description',   incoming: description,   transform: v => v || null },
    { field: 'field_values',  type: 'jsonb',    col: 'field_values',  incoming: field_values,  transform: v => v,           isJson: true },
    { field: 'due_date',      type: 'date',     col: 'due_date',      incoming: due_date,      transform: v => v || null },
    { field: 'is_expedited',  type: 'boolean',  col: 'is_expedited',  incoming: is_expedited,  transform: v => !!v },
    { field: 'work_nature',   type: 'text',     col: 'work_nature',   incoming: work_nature,   transform: v => v },
    { field: 'priority',      type: 'number',   col: 'priority',      incoming: priority,      transform: v => v != null ? parseInt(v) : null },
    { field: 'tags',          type: 'text[]',   col: 'tags',          incoming: tags,          transform: v => v || [] },
    { field: 'estimate',      type: 'number',   col: 'estimate',      incoming: estimate,      transform: v => v != null ? parseFloat(v) : null },
    { field: 'estimate_unit', type: 'text',     col: 'estimate_unit', incoming: estimate_unit, transform: v => v },
    { field: 'origin',        type: 'text',     col: 'origin',        incoming: origin,        transform: v => v },
    { field: 'requester_id',  type: 'number',   col: 'requester_id',  incoming: requester_id,  transform: v => v ? parseInt(v) : null },
  ]

  const provided = UPDATABLE.filter(u => u.incoming !== undefined)
  if (!provided.length) return res.status(400).json({ error: 'No fields to update' })

  const client = await getClient()
  try {
    await client.query('BEGIN')

    // 1. Load current values for only the columns being updated
    const selectCols = provided.map(u => u.col).join(', ')
    const { rows: beforeRows } = await client.query(
      `SELECT id, uri, ${selectCols} FROM runtime.work_items WHERE id = $1 FOR UPDATE`,
      [workItemId]
    )
    if (!beforeRows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }
    const before = beforeRows[0]

    // 2. Compute diff — only fields whose value actually changed
    const changes = []
    const setFragments = []
    const vals = []
    for (const u of provided) {
      const newVal = u.transform(u.incoming)
      const oldVal = before[u.col]
      if (valuesEqual(oldVal, newVal)) continue
      changes.push({ field: u.field, type: u.type, old: oldVal, new: newVal })
      setFragments.push(`${u.col} = $${vals.length + 1}`)
      vals.push(u.isJson ? JSON.stringify(newVal) : newVal)
    }

    if (!changes.length) {
      // No-op update — commit but do not emit
      await client.query('ROLLBACK')
      client.release()
      const { rows: current } = await query('SELECT * FROM runtime.work_items WHERE id = $1', [workItemId])
      return res.json(current[0])
    }

    // 3. Apply the update
    setFragments.push('updated_at = NOW()')
    vals.push(workItemId)
    const { rows: updated } = await client.query(
      `UPDATE runtime.work_items SET ${setFragments.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )

    // 4. Emit the edit event (in-tx)
    const editGroupId = randomUUID()
    await emitEvent(client, {
      eventType: 'work_item.edited',
      entityId:  workItemId,
      entityUri: before.uri,
      actorId:   req.userId ?? null,
      payload: {
        edit_group_id: editGroupId,
        changes,
        current: updated[0],
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json(updated[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})

// Compare two values for equality, tolerating JSONB/array/date oddities.
function valuesEqual(a, b) {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Date) return a.toISOString() === new Date(b).toISOString()
  if (b instanceof Date) return new Date(a).toISOString() === b.toISOString()
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => valuesEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return String(a) === String(b)
}
```

- [ ] **Step 9.4: Run tests — expect pass**

```bash
node --test tests/events-system.test.js
```

Expected: all tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add admin/api.js
git commit -m "Convert PATCH work-items to transactional diff + event emission

Endpoint now SELECTs existing values FOR UPDATE, computes the set of
actually-changed fields, UPDATEs, and emits work_item.edited with a
changes[] delta — all in one transaction. No-op updates (new value
equals old value) do not emit. The audit-log subscriber persists the
diff to runtime.work_item_edits on the other side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Emit on substate / relationships / links / comments endpoints

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 10.1: Write failing test**

Append to `tests/events-system.test.js`:

```js
describe('Emission on people / link / comment / substate endpoints', () => {
  let workItemId, userId
  before(async () => {
    const { rows: wi } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    workItemId = wi[0].id
    const { rows: u } = await query('SELECT id FROM blueprint.users WHERE is_active = true ORDER BY id ASC LIMIT 1')
    userId = u[0].id
  })

  it('emits work_item.assigned when a relationship is created', async () => {
    await query(`DELETE FROM runtime.work_item_user_relationships
                 WHERE work_item_id = $1 AND user_id = $2 AND relationship_type = 'watching'`,
                [workItemId, userId])
    await query(`DELETE FROM runtime.events WHERE event_type = 'work_item.assigned' AND entity_id = $1`, [workItemId])

    const { status } = await api(`/work-items/${workItemId}/relationships`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, relationship_type: 'watching' }),
    })
    assert.equal(status, 201)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT payload FROM runtime.events
       WHERE event_type = 'work_item.assigned' AND entity_id = $1
       ORDER BY id DESC LIMIT 1`,
      [workItemId]
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].payload.relationship_type, 'watching')
  })

  it('emits work_item.commented when a comment is posted', async () => {
    await query(`DELETE FROM runtime.events WHERE event_type = 'work_item.commented' AND entity_id = $1`, [workItemId])

    const { status } = await api(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Event system test comment' }),
    })
    assert.equal(status, 201)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM runtime.events
       WHERE event_type = 'work_item.commented' AND entity_id = $1`,
      [workItemId]
    )
    assert.ok(rows[0].n >= 1)
  })

  it('emits work_item.substate_changed', async () => {
    await query(`DELETE FROM runtime.events WHERE event_type = 'work_item.substate_changed' AND entity_id = $1`, [workItemId])

    const { status } = await api(`/work-items/${workItemId}/substate`, {
      method: 'POST',
      body: JSON.stringify({ substate: 'active' }),
    })
    assert.equal(status, 200)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM runtime.events
       WHERE event_type = 'work_item.substate_changed' AND entity_id = $1`,
      [workItemId]
    )
    assert.ok(rows[0].n >= 1)
  })
})
```

- [ ] **Step 10.2: Run — expect failure**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL — current endpoints do not emit.

- [ ] **Step 10.3: Modify substate endpoint**

In `admin/api.js`, find `router.post('/work-items/:id/substate', ...)` around line 2174. Replace with:

```js
router.post('/work-items/:id/substate', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  const { substate } = req.body
  if (!['active', 'blocked', 'waiting'].includes(substate)) {
    return res.status(400).json({ error: 'substate must be "active", "blocked", or "waiting"' })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: before } = await client.query(
      'SELECT current_substate, uri FROM runtime.work_items WHERE id = $1 FOR UPDATE',
      [workItemId]
    )
    if (!before.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    const oldSubstate = before[0].current_substate
    if (oldSubstate === substate) {
      await client.query('ROLLBACK')
      const { rows } = await query('SELECT * FROM runtime.work_items WHERE id = $1', [workItemId])
      return res.json(rows[0])
    }

    const { rows: updated } = await client.query(`
      UPDATE runtime.work_items
      SET current_substate = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [substate, workItemId])

    await emitEvent(client, {
      eventType: 'work_item.substate_changed',
      entityId:  workItemId,
      entityUri: before[0].uri,
      actorId:   req.userId ?? null,
      payload:   { old_substate: oldSubstate, new_substate: substate },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json(updated[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})
```

- [ ] **Step 10.4: Modify POST `/work-items/:id/relationships`**

Find `router.post('/work-items/:id/relationships', ...)` at line 2356. Replace with:

```js
router.post('/work-items/:id/relationships', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  const { user_id, relationship_type } = req.body
  if (!user_id)           return res.status(400).json({ error: 'user_id is required' })
  if (!relationship_type) return res.status(400).json({ error: 'relationship_type is required' })

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wi.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    const { rows: inserted } = await client.query(`
      INSERT INTO runtime.work_item_user_relationships (work_item_id, user_id, relationship_type, assigned_at, is_active)
      VALUES ($1, $2, $3, NOW(), true)
      RETURNING *
    `, [workItemId, user_id, relationship_type])

    const { rows: userRow } = await client.query(
      'SELECT uri FROM blueprint.users WHERE id = $1', [user_id]
    )

    await emitEvent(client, {
      eventType: 'work_item.assigned',
      entityId:  workItemId,
      entityUri: wi[0].uri,
      actorId:   req.userId ?? null,
      payload: {
        user_id,
        user_uri:          userRow[0]?.uri ?? null,
        work_item_uri:     wi[0].uri,
        relationship_type,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.status(201).json(inserted[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505') return res.status(409).json({ error: 'Relationship already exists' })
    next(err)
  } finally {
    client.release()
  }
})
```

- [ ] **Step 10.5: Modify DELETE `/work-item-relationships/:id`**

Find `router.delete('/work-item-relationships/:id', ...)` at line 2373. Replace with:

```js
router.delete('/work-item-relationships/:id', async (req, res, next) => {
  const relId = parseInt(req.params.id)
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: rel } = await client.query(`
      SELECT r.id, r.work_item_id, r.user_id, r.relationship_type, wi.uri AS work_item_uri, u.uri AS user_uri
      FROM runtime.work_item_user_relationships r
      JOIN runtime.work_items wi ON wi.id = r.work_item_id
      LEFT JOIN blueprint.users u ON u.id = r.user_id
      WHERE r.id = $1
    `, [relId])
    if (!rel.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Relationship not found' })
    }
    const r = rel[0]

    await client.query(
      'UPDATE runtime.work_item_user_relationships SET is_active = false WHERE id = $1',
      [relId]
    )

    await emitEvent(client, {
      eventType: 'work_item.unassigned',
      entityId:  r.work_item_id,
      entityUri: r.work_item_uri,
      actorId:   req.userId ?? null,
      payload: {
        user_id:           r.user_id,
        user_uri:          r.user_uri,
        work_item_uri:     r.work_item_uri,
        relationship_type: r.relationship_type,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json({ deleted: r.id })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})
```

- [ ] **Step 10.6: Modify POST `/work-items/:id/links`**

Find `router.post('/work-items/:id/links', ...)` at line 2384. Replace with:

```js
router.post('/work-items/:id/links', async (req, res, next) => {
  const sourceId = parseInt(req.params.id)
  const { target_work_item_id, link_type } = req.body
  if (!target_work_item_id) return res.status(400).json({ error: 'target_work_item_id is required' })
  if (!link_type)           return res.status(400).json({ error: 'link_type is required' })

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: src } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [sourceId])
    const { rows: tgt } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [target_work_item_id])
    if (!src.length || !tgt.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    let responsePayload
    if (link_type === 'parent') {
      await client.query('UPDATE runtime.work_items SET parent_id = $1, updated_at = NOW() WHERE id = $2',
        [target_work_item_id, sourceId])
      responsePayload = { linked: true, link_type: 'parent' }
    } else if (link_type === 'child') {
      await client.query('UPDATE runtime.work_items SET parent_id = $1, updated_at = NOW() WHERE id = $2',
        [sourceId, target_work_item_id])
      responsePayload = { linked: true, link_type: 'child' }
    } else {
      const { rows: inserted } = await client.query(`
        INSERT INTO runtime.work_item_links (source_work_item_id, target_work_item_id, link_type, created_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [sourceId, target_work_item_id, link_type, req.userId ?? null])
      responsePayload = inserted[0]
    }

    await emitEvent(client, {
      eventType: 'work_item.linked',
      entityId:  sourceId,
      entityUri: src[0].uri,
      actorId:   req.userId ?? null,
      payload: {
        source_id:   sourceId,
        source_uri:  src[0].uri,
        target_id:   target_work_item_id,
        target_uri:  tgt[0].uri,
        link_type,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    const status = link_type === 'parent' || link_type === 'child' ? 200 : 201
    res.status(status).json(responsePayload)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505') return res.status(409).json({ error: 'Link already exists' })
    next(err)
  } finally {
    client.release()
  }
})
```

- [ ] **Step 10.7: Modify POST `/work-items/:id/comments`**

Find `router.post('/work-items/:id/comments', ...)` at line 2320. Replace with:

```js
router.post('/work-items/:id/comments', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  const { body, parent_comment_id } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' })

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wi.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    const uri = generateUri('system', 'comments')
    const { rows: comment } = await client.query(`
      INSERT INTO runtime.work_item_comments (uri, work_item_id, author_user_id, body, parent_comment_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [uri, workItemId, req.userId, body.trim(), parent_comment_id || null])

    await client.query('UPDATE runtime.work_items SET updated_at = NOW() WHERE id = $1', [workItemId])

    await emitEvent(client, {
      eventType: 'work_item.commented',
      entityId:  workItemId,
      entityUri: wi[0].uri,
      actorId:   req.userId ?? null,
      payload: {
        comment_id:        comment[0].id,
        comment_uri:       uri,
        parent_comment_id: parent_comment_id || null,
        body:              body.trim(),
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.status(201).json(comment[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})
```

- [ ] **Step 10.8: Run tests — expect pass**

```bash
node --test tests/events-system.test.js
```

Expected: all new tests pass.

- [ ] **Step 10.9: Commit**

```bash
git add admin/api.js
git commit -m "Emit events on substate, relationships, links, comments endpoints

Each endpoint now runs inside a transaction that writes the domain state
change and the event row together. Post-commit nudge triggers subscriber
drain. Uses FOR UPDATE locks where needed to read old values before
replacement.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Emit events on exit-criteria endpoints

**Files:**
- Modify: `runtime/exitCriteria.js` (convert acknowledge/unacknowledge/waive to accept optional tx client, emit)
- Modify: `admin/api.js` (three ack/unack/waive endpoints to use tx)

- [ ] **Step 11.1: Write failing tests**

Append to `tests/events-system.test.js`:

```js
describe('Emission on exit-criteria endpoints', () => {
  it('emits exit_criteria.acknowledged / unacknowledged / waived when invoked', async () => {
    // Find any work item with at least one manual exit criterion
    const { rows: stageItems } = await query(`
      SELECT wi.id AS work_item_id, ec.id AS ec_id
      FROM runtime.work_items wi
      JOIN blueprint.exit_criteria ec ON ec.stage_id = wi.current_stage_id
      WHERE ec.criteria_tier = 'manual' AND ec.is_active = true
      LIMIT 1
    `)
    if (!stageItems.length) {
      console.log('[skip] no manual exit criteria found in seed; skipping')
      return
    }
    const { work_item_id, ec_id } = stageItems[0]

    await query(`DELETE FROM runtime.events
                 WHERE event_type IN ('exit_criteria.acknowledged',
                                      'exit_criteria.unacknowledged',
                                      'exit_criteria.waived')
                 AND entity_id = $1`, [work_item_id])

    // Acknowledge
    let res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/acknowledge`, { method: 'POST' })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    // Unacknowledge
    res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/acknowledge`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    // Waive
    res = await api(`/work-items/${work_item_id}/exit-criteria/${ec_id}/waive`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Test waive' }),
    })
    assert.equal(res.status, 200)
    await new Promise(r => setTimeout(r, 200))

    const { rows } = await query(`
      SELECT event_type FROM runtime.events
      WHERE entity_id = $1
        AND event_type LIKE 'exit_criteria.%'
      ORDER BY id DESC LIMIT 3
    `, [work_item_id])
    const types = rows.map(r => r.event_type).sort()
    assert.deepEqual(types, [
      'exit_criteria.acknowledged',
      'exit_criteria.unacknowledged',
      'exit_criteria.waived',
    ].sort())
  })
})
```

- [ ] **Step 11.2: Run — expect failure**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL or skipped (if no manual criteria seed exists). If skipped, run the seed first: `npm run seed`.

- [ ] **Step 11.3: Update `runtime/exitCriteria.js`**

At the top of `runtime/exitCriteria.js`, add:

```js
import { getClient } from '../db/postgres.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
```

Replace `acknowledgeCriterion` (line ~312) with:

```js
export async function acknowledgeCriterion(workItemId, exitCriteriaId, userId) {
  const criterionResult = await query(
    'SELECT id, criteria_tier, name FROM blueprint.exit_criteria WHERE id = $1 AND is_active = true',
    [exitCriteriaId]
  )
  if (!criterionResult.rows.length) {
    throw new Error('Exit criterion not found')
  }
  if (criterionResult.rows[0].criteria_tier !== 'manual') {
    throw new Error('Only manual criteria can be acknowledged')
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      INSERT INTO runtime.exit_criteria_status
        (work_item_id, exit_criteria_id, stage_id, status, acknowledged_by_user_id, acknowledged_at)
      VALUES ($1, $2,
        (SELECT current_stage_id FROM runtime.work_items WHERE id = $1),
        'met', $3, NOW())
      ON CONFLICT (work_item_id, exit_criteria_id)
      DO UPDATE SET
        status = 'met',
        acknowledged_by_user_id = $3,
        acknowledged_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `, [workItemId, exitCriteriaId, userId])

    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    await emitEvent(client, {
      eventType: 'exit_criteria.acknowledged',
      entityId:  workItemId,
      entityUri: wi[0]?.uri ?? null,
      actorId:   userId,
      payload:   { exit_criteria_id: exitCriteriaId, criterion_name: criterionResult.rows[0].name, stage_id: rows[0].stage_id },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
```

Replace `unacknowledgeCriterion` with:

```js
export async function unacknowledgeCriterion(workItemId, exitCriteriaId, userId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      UPDATE runtime.exit_criteria_status
      SET status = 'pending',
          acknowledged_by_user_id = NULL,
          acknowledged_at = NULL,
          updated_at = NOW()
      WHERE work_item_id = $1 AND exit_criteria_id = $2
      RETURNING *
    `, [workItemId, exitCriteriaId])

    if (!rows.length) {
      await client.query('ROLLBACK')
      return null
    }

    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    await emitEvent(client, {
      eventType: 'exit_criteria.unacknowledged',
      entityId:  workItemId,
      entityUri: wi[0]?.uri ?? null,
      actorId:   userId ?? null,
      payload:   { exit_criteria_id: exitCriteriaId, stage_id: rows[0].stage_id },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
```

Replace `waiveCriterion` with:

```js
export async function waiveCriterion(workItemId, exitCriteriaId, userId, reason) {
  if (!reason?.trim()) {
    throw new Error('A reason is required to waive an exit criterion')
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      INSERT INTO runtime.exit_criteria_status
        (work_item_id, exit_criteria_id, stage_id, status, waived_by_user_id, waived_at, waiver_reason)
      VALUES ($1, $2,
        (SELECT current_stage_id FROM runtime.work_items WHERE id = $1),
        'waived', $3, NOW(), $4)
      ON CONFLICT (work_item_id, exit_criteria_id)
      DO UPDATE SET
        status = 'waived',
        waived_by_user_id = $3,
        waived_at = NOW(),
        waiver_reason = $4,
        updated_at = NOW()
      RETURNING *
    `, [workItemId, exitCriteriaId, userId, reason.trim()])

    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    await emitEvent(client, {
      eventType: 'exit_criteria.waived',
      entityId:  workItemId,
      entityUri: wi[0]?.uri ?? null,
      actorId:   userId,
      payload:   { exit_criteria_id: exitCriteriaId, stage_id: rows[0].stage_id, waiver_reason: reason.trim() },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 11.4: Update `admin/api.js` unacknowledge endpoint**

The acknowledge endpoint already passes `req.userId`. The unacknowledge endpoint does not. In `admin/api.js`, find line ~2271:

```js
router.delete('/work-items/:id/exit-criteria/:criteriaId/acknowledge', async (req, res, next) => {
  try {
    const result = await unacknowledgeCriterion(
      parseInt(req.params.id),
      parseInt(req.params.criteriaId)
    )
```

Change the function call to pass `req.userId`:

```js
router.delete('/work-items/:id/exit-criteria/:criteriaId/acknowledge', async (req, res, next) => {
  try {
    const result = await unacknowledgeCriterion(
      parseInt(req.params.id),
      parseInt(req.params.criteriaId),
      req.userId
    )
```

- [ ] **Step 11.5: Run tests — expect pass**

```bash
node --test tests/events-system.test.js
```

Expected: all pass.

- [ ] **Step 11.6: Commit**

```bash
git add runtime/exitCriteria.js admin/api.js
git commit -m "Emit events on exit-criteria acknowledge/unacknowledge/waive

Criterion functions now run inside a transaction, upsert the status row,
emit the event, and commit atomically. Three new event types added to
v1 catalog: exit_criteria.acknowledged, exit_criteria.unacknowledged,
exit_criteria.waived.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Admin API endpoints for subscriber health

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 12.1: Write failing tests**

Append to `tests/events-system.test.js`:

```js
describe('Admin API — event subscribers endpoints', () => {
  it('GET /event-subscribers returns registered subscribers with cursors', async () => {
    const { status, data } = await api('/event-subscribers')
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows))
    const names = data.rows.map(r => r.name)
    assert.ok(names.includes('neo4j-sync'))
    assert.ok(names.includes('audit-log'))
  })

  it('POST /event-subscribers/:name/pause toggles pause', async () => {
    const pauseRes = await api('/event-subscribers/audit-log/pause', {
      method: 'POST',
      body: JSON.stringify({ is_paused: true }),
    })
    assert.equal(pauseRes.status, 200)

    const { data } = await api('/event-subscribers')
    const sub = data.rows.find(r => r.name === 'audit-log')
    assert.equal(sub.is_paused, true)

    // Un-pause for subsequent tests
    await api('/event-subscribers/audit-log/pause', {
      method: 'POST',
      body: JSON.stringify({ is_paused: false }),
    })
  })

  it('GET /events returns recent events ordered newest-first', async () => {
    const { status, data } = await api('/events?limit=10')
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows))
    if (data.rows.length >= 2) {
      assert.ok(data.rows[0].id >= data.rows[1].id, 'should be newest-first')
    }
  })
})
```

- [ ] **Step 12.2: Run — expect failure**

```bash
node --test tests/events-system.test.js
```

Expected: FAIL — endpoints do not exist.

- [ ] **Step 12.3: Add the endpoints**

In `admin/api.js`, add these routes near the other admin endpoints (e.g. after the exit-criteria endpoints):

```js
// =============================================================================
// EVENT SUBSCRIBERS (admin / ops view)
// =============================================================================

router.get('/event-subscribers', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT name, last_processed_event_id, is_paused, last_error, last_error_at,
             failure_count, last_success_at, events_processed_total, updated_at
      FROM runtime.event_subscribers
      ORDER BY name ASC
    `)
    res.json({ rows, count: rows.length })
  } catch (err) { next(err) }
})

router.post('/event-subscribers/:name/pause', async (req, res, next) => {
  try {
    const { is_paused } = req.body
    if (typeof is_paused !== 'boolean') {
      return res.status(400).json({ error: 'is_paused (boolean) is required' })
    }
    const { rows } = await query(`
      UPDATE runtime.event_subscribers
      SET is_paused = $1, updated_at = NOW()
      WHERE name = $2
      RETURNING *
    `, [is_paused, req.params.name])
    if (!rows.length) return res.status(404).json({ error: 'Subscriber not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// Manually bump cursor past a bad event (ops recovery)
router.post('/event-subscribers/:name/skip-past/:eventId', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.eventId)
    const { rows } = await query(`
      UPDATE runtime.event_subscribers
      SET last_processed_event_id = GREATEST(last_processed_event_id, $1),
          failure_count = 0,
          last_error = NULL,
          last_error_at = NULL,
          updated_at = NOW()
      WHERE name = $2
      RETURNING *
    `, [eventId, req.params.name])
    if (!rows.length) return res.status(404).json({ error: 'Subscriber not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// Event firehose (latest N events)
router.get('/events', async (req, res, next) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit) || 100, 500)
    const typeLike = req.query.type_prefix ? `${req.query.type_prefix}%` : null
    const { rows } = await query(`
      SELECT id, event_type, entity_id, entity_uri, actor_id, occurred_at, payload
      FROM runtime.events
      ${typeLike ? 'WHERE event_type LIKE $2' : ''}
      ORDER BY id DESC
      LIMIT $1
    `, typeLike ? [limit, typeLike] : [limit])
    res.json({ rows, count: rows.length })
  } catch (err) { next(err) }
})
```

- [ ] **Step 12.4: Run tests — expect pass**

```bash
node --test tests/events-system.test.js
```

Expected: all pass.

- [ ] **Step 12.5: Commit**

```bash
git add admin/api.js
git commit -m "Add admin API endpoints for event subscriber health and firehose

GET /event-subscribers - list subscribers with cursors, failure state
POST /event-subscribers/:name/pause - pause/resume a subscriber
POST /event-subscribers/:name/skip-past/:eventId - ops recovery: bump
  cursor past a poison-pill event
GET /events - latest N events, filterable by event_type prefix

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Admin UI — EventSubscribers page

**Files:**
- Create: `admin-ui/src/pages/EventSubscribers.jsx`
- Modify: `admin-ui/src/App.jsx` (route registration)
- Modify: `admin-ui/src/lib/api.js` (client helpers)

- [ ] **Step 13.1: Add API client helpers**

The file exports a single `api` object that uses the internal `apiFetch` helper. Add these entries inside the `api` object (anywhere — conventional order is grouped by domain). Find a suitable block, e.g. after existing admin-ish methods, and insert:

```js
  // Event subscribers & events
  eventSubscribers:       ()           => apiFetch('/event-subscribers'),
  pauseEventSubscriber:   (name, isPaused) =>
    apiFetch(`/event-subscribers/${encodeURIComponent(name)}/pause`, {
      method: 'POST',
      body:   JSON.stringify({ is_paused: isPaused }),
    }),
  skipPastEvent:          (name, eventId) =>
    apiFetch(`/event-subscribers/${encodeURIComponent(name)}/skip-past/${eventId}`, {
      method: 'POST',
    }),
  recentEvents:           ({ limit = 100, typePrefix } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) })
    if (typePrefix) q.set('type_prefix', typePrefix)
    return apiFetch(`/events?${q}`)
  },
```

- [ ] **Step 13.2: Create the page**

Create `admin-ui/src/pages/EventSubscribers.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'

export default function EventSubscribers() {
  const [subs, setSubs] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')

  async function refresh() {
    const [subsRes, evRes] = await Promise.all([
      api.eventSubscribers(),
      api.recentEvents({ limit: 200, typePrefix: typeFilter || undefined }),
    ])
    setSubs(subsRes.rows)
    setEvents(evRes.rows)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)   // auto-refresh every 5s
    return () => clearInterval(timer)
  }, [typeFilter])

  async function togglePause(name, currentlyPaused) {
    await api.pauseEventSubscriber(name, !currentlyPaused)
    await refresh()
  }

  async function onSkip(name, eventId) {
    if (!confirm(`Skip past event ${eventId} for subscriber "${name}"?\n\nThe event will never be processed by this subscriber.`)) return
    await api.skipPastEvent(name, eventId)
    await refresh()
  }

  if (loading) {
    return <div className="p-6 text-xs text-muted-foreground">Loading…</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Event Subscribers</h1>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="border-b bg-black/[0.02]">
                <tr className="text-left">
                  <th className="p-2 font-medium uppercase tracking-wide">Name</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Cursor</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Processed</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Last Success</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Failures</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Last Error</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Paused</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map(s => (
                  <tr key={s.name} className="border-b hover:bg-black/[0.03]">
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">{s.last_processed_event_id}</td>
                    <td className="p-2">{s.events_processed_total}</td>
                    <td className="p-2 text-muted-foreground">{s.last_success_at ? formatRelative(s.last_success_at) : '—'}</td>
                    <td className="p-2">{s.failure_count > 0 ? <span className="text-destructive">{s.failure_count}</span> : s.failure_count}</td>
                    <td className="p-2 max-w-xs truncate" title={s.last_error || ''}>{s.last_error || '—'}</td>
                    <td className="p-2"><Switch checked={s.is_paused} onCheckedChange={() => togglePause(s.name, s.is_paused)} /></td>
                    <td className="p-2">
                      {s.failure_count > 0 && (
                        <Button size="sm" variant="outline" onClick={() => onSkip(s.name, s.last_processed_event_id + 1)}>
                          Skip next
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Recent Events</h2>
          <input
            type="text"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            placeholder="filter by event_type prefix"
            className="h-7 px-2 text-xs border rounded w-56"
          />
        </div>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="border-b bg-black/[0.02]">
                <tr className="text-left">
                  <th className="p-2 font-medium uppercase tracking-wide w-20">ID</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Type</th>
                  <th className="p-2 font-medium uppercase tracking-wide w-20">Entity</th>
                  <th className="p-2 font-medium uppercase tracking-wide w-40">When</th>
                  <th className="p-2 font-medium uppercase tracking-wide">Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} className="border-b hover:bg-black/[0.03]">
                    <td className="p-2 font-medium">{e.id}</td>
                    <td className="p-2">{e.event_type}</td>
                    <td className="p-2">{e.entity_id}</td>
                    <td className="p-2 text-muted-foreground">{formatRelative(e.occurred_at)}</td>
                    <td className="p-2 max-w-md truncate" title={JSON.stringify(e.payload)}>{JSON.stringify(e.payload)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 13.3: Register the route**

In `admin-ui/src/App.jsx`, add the import near the other `@/pages/*` imports (e.g. after the `Simulation` import around line 40):

```js
import EventSubscribers from '@/pages/EventSubscribers'
```

Then find the sidebar nav array that currently includes entries like `RawTables`, `LogViewer`, `DbConsole`, `Simulation` (the "Dev Tools" group). Add a new entry in the same array, following the existing shape — name, path, icon (use any Lucide icon already imported, e.g. `Activity` or `Radio`), and component. If the App.jsx doesn't yet import `Activity` from `lucide-react`, add that import alongside the others. The route path should be `/admin/events` and the component `<EventSubscribers />`.

Concretely: open `admin-ui/src/App.jsx`, find the existing Dev Tools entry for `RawTables` (grep for it), and add a sibling entry with the same structure pointing at EventSubscribers. The existing code is the template — copy a working sibling, change only the name/path/icon/component.

- [ ] **Step 13.4: Build and test in the browser**

```bash
cd admin-ui && npm run build && cd ..
# Visit http://localhost:3000/admin/events in the browser
# Confirm: table shows 'neo4j-sync' and 'audit-log' with cursors
# Confirm: recent events panel populates
# Confirm: pause toggle persists across refresh
# Confirm: typing in the filter box narrows event list
```

- [ ] **Step 13.5: Commit**

```bash
git add admin-ui/src/pages/EventSubscribers.jsx admin-ui/src/App.jsx admin-ui/src/lib/api.js
git commit -m "Add EventSubscribers admin UI page

Shows subscriber cursors, processed counts, failure state, and per-row
pause toggles. Recent-events firehose with event_type prefix filter.
Auto-refreshes every 5s. Placed in Dev Tools section (follows existing
sidebar pattern). Style guide compliant: text-xs body, text-sm titles,
no font-mono, no modals, hover:bg-black/[0.03].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Integration test sweep + advisory-lock and latency tests

**Files:**
- Modify: `tests/events-system.test.js`

- [ ] **Step 14.1: Add remaining coverage tests**

Append to `tests/events-system.test.js`:

```js
describe('Advisory lock — only one processor runs', () => {
  it('a second startProcessor in the same process does not take the lock twice', async () => {
    // The API server already holds the lock. A fresh call should be a no-op.
    const { rows: before } = await query(
      "SELECT COUNT(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = 252779603"
    )
    assert.equal(before[0].n, 1, 'exactly one advisory lock should be held')
  })
})

describe('API latency — emission does not block response', () => {
  it('PATCH /work-items/:id returns under 100ms even with emission', async () => {
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    const id = rows[0].id

    const t0 = performance.now()
    const { status } = await api(`/work-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'latency test ' + Date.now() }),
    })
    const elapsed = performance.now() - t0
    assert.equal(status, 200)
    assert.ok(elapsed < 200, `PATCH took ${elapsed}ms — emission should not block response`)
  })
})

describe('End-to-end — work item creation flows through event system to subscribers', () => {
  it('creating a work item produces a work_item.created event that advances neo4j-sync cursor', async () => {
    const cursorBefore = await query(
      "SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = 'neo4j-sync'"
    )
    const before = Number(cursorBefore.rows[0].last_processed_event_id)

    // Create via POST /admin/api/work-items
    const { rows: types } = await query(
      "SELECT id FROM blueprint.work_item_types WHERE is_active = true LIMIT 1"
    )
    const { rows: orgs } = await query(
      "SELECT id FROM blueprint.organizations WHERE is_active = true LIMIT 1"
    )
    const res = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Event system e2e ' + Date.now(),
        work_item_type_id: types[0].id,
        owner_org_id: orgs[0].id,
      }),
    })
    assert.equal(res.status, 201)

    // Wait up to 3s for processor to drain
    let cursorAfter = before
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 200))
      const c = await query(
        "SELECT last_processed_event_id FROM runtime.event_subscribers WHERE name = 'neo4j-sync'"
      )
      cursorAfter = Number(c.rows[0].last_processed_event_id)
      if (cursorAfter > before) break
    }
    assert.ok(cursorAfter > before, `neo4j-sync cursor did not advance (was ${before}, is ${cursorAfter})`)
  })
})
```

- [ ] **Step 14.2: Run the full test suite**

```bash
node --test tests/*.test.js
```

Expected: all pass. If any legacy test fails because of the schema / emission changes, read the failure carefully — most likely the test was relying on `search_index_queue` or other deleted plumbing; remove that assertion.

- [ ] **Step 14.3: Run eslint**

```bash
npx eslint .
```

Expected: no new lint errors introduced by this work. Fix any that appear.

- [ ] **Step 14.4: Commit**

```bash
git add tests/events-system.test.js
git commit -m "Integration tests: advisory lock, API latency, end-to-end drain

Three additional test blocks cover: exactly one advisory lock held,
PATCH latency under 200ms with emission in tx, and end-to-end work item
create → event → cursor advance on neo4j-sync subscriber.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Documentation + memory updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ARCHITECTURE.md`
- Modify: `/Users/chris/.claude/projects/-Users-chris-Documents-ai-flowos/memory/MEMORY.md`
- Modify: `/Users/chris/.claude/projects/-Users-chris-Documents-ai-flowos/memory/project_event_system.md`

- [ ] **Step 15.1: Update `CLAUDE.md` header**

Change the "Last updated" line to reflect the session this lands in:
```
> Last updated: 2026-04-16 (Session 20 — Event system shipped)
```

Under "Key Patterns" add a new bullet:
```
- **Event system:** `runtime.events` append-only log + per-subscriber cursor. Emit
  via `emitEvent(client, ...)` inside a transaction. Subscribers in `runtime/subscribers/`.
  Single active processor per deployment (PG advisory lock).
```

Under "Key Files" add:
```
| `core/events.js` | Event emission + post-commit nudge |
| `runtime/eventProcessor.js` | Advisory lock, drain loop, subscriber registry |
| `runtime/subscribers/*.js` | Event subscribers (neo4j-sync, audit-log) |
```

- [ ] **Step 15.2: Update `ARCHITECTURE.md`**

- Append migration 011 to the "Schema History" section
- Replace the `search_index_queue` reference in the Runtime Schema section with `events`, `event_subscribers`, `work_item_edits` entries
- Remove the mention of search_index_queue from the "Runtime Schema" table list
- Under "Session Log", append:

```markdown
### Session 20 (2026-04-16) — Event system
Event system shipped: runtime.events (append-only bus), runtime.event_subscribers
(per-subscriber cursors with PG advisory lock for single-processor enforcement),
runtime.work_item_edits (Jira-shaped field audit). Two subscribers wired up:
neo4j-sync (replaces syncToGraph direct calls) and audit-log (writes
work_item_edits rows). Retired runtime.search_index_queue. 13 event types
emitted from transitions, work-item CRUD, comments, people/links, substates,
and exit-criteria ack/waive. Admin UI page at /admin/events.
```

- [ ] **Step 15.3: Update the event system memory**

Replace `/Users/chris/.claude/projects/-Users-chris-Documents-ai-flowos/memory/project_event_system.md` with:

```markdown
---
name: Event System — Implemented
description: Shipped architecture for the Flow OS event system — events bus, subscriber cursors, audit table, emission patterns
type: project
---

## Event System — Shipped (Session 20, 2026-04-16)

### What's in the schema

- `runtime.events` — append-only bus. Columns: id, event_type, entity_id, entity_uri, actor_id, occurred_at, payload.
- `runtime.event_subscribers` — per-subscriber cursor + health. Name is PK.
- `runtime.work_item_edits` — Jira-shaped field audit. UNIQUE (edit_group_id, field_key) makes audit-log subscriber idempotent.
- `runtime.search_index_queue` dropped in migration 011.

### How emission works

- Always inside a transaction. `emitEvent(client, { eventType, entityId, entityUri, actorId, payload })` from `core/events.js`.
- Call `nudgeAfterCommit()` AFTER your COMMIT. It triggers the processor to drain immediately; safety-net poll every 30s covers missed nudges.
- Event type is dotted: `work_item.transitioned`. No separate entity_type column — derived from the prefix.

### Processor

- Location: `runtime/eventProcessor.js`.
- Single active processor per deployment via `pg_try_advisory_lock(0x0F105053)` on a dedicated long-lived pool connection.
- Each subscriber tracks its own `last_processed_event_id`. One subscriber's failure does not affect others. Cursor sits on the failing event until admin skips past it or the bug is fixed.
- `runtime/subscribers/` holds concrete subscribers; registered at module scope of eventProcessor.js.

### V1 subscribers

- `neo4j-sync` — consumes `work_item.*` and `transition_action.*`, maps to existing `graph/sync.js` handlers.
- `audit-log` — consumes `work_item.edited`, writes `runtime.work_item_edits` rows with ON CONFLICT dedupe.

### V1 event catalog (13 types)

work_item.created, work_item.edited, work_item.transitioned, work_item.substate_changed,
work_item.assigned, work_item.unassigned, work_item.linked, work_item.commented,
transition_action.api_call_fired, transition_action.spawn_fired,
exit_criteria.acknowledged, exit_criteria.unacknowledged, exit_criteria.waived.

### Admin surface

- `GET /admin/api/event-subscribers` — cursors + health
- `POST /admin/api/event-subscribers/:name/pause` — pause/resume
- `POST /admin/api/event-subscribers/:name/skip-past/:eventId` — ops recovery
- `GET /admin/api/events?limit=N&type_prefix=X` — firehose
- `/admin/events` UI page (EventSubscribers.jsx) — cursor table + recent events viewer

### Deferred / future

- Blueprint admin events (`workflow.edited`, `org.created`, etc.) — emit when first subscriber needs them.
- Replay / rewind operator action.
- Per-event-type retention policy (today: no cleanup; events accumulate).
- Push-based subscribers (HTTP webhooks).
- `LISTEN/NOTIFY` for cross-API-instance nudging (today: 30s safety poll covers).
- Comment edit/delete endpoints → corresponding events.
- Link unlink endpoint → `work_item.unlinked` event.
```

- [ ] **Step 15.4: Update MEMORY.md index line**

In `/Users/chris/.claude/projects/-Users-chris-Documents-ai-flowos/memory/MEMORY.md`, replace the existing "Event System (Session 10)" section with:

```markdown
## Event System (Session 20 — shipped)
- [Full design + implementation notes](project_event_system.md)
- `runtime.events` + `runtime.event_subscribers` + `runtime.work_item_edits`
- PG advisory lock keeps one processor per deployment; per-subscriber cursors
- Emit via `emitEvent(client, ...)` in-tx; `nudgeAfterCommit()` post-commit
- Two subscribers live: `neo4j-sync`, `audit-log`. `search_index_queue` retired.
- 13 event types in v1 catalog
```

- [ ] **Step 15.5: Verify docs are correct by re-reading them**

```bash
cat CLAUDE.md | head -40
cat ARCHITECTURE.md | grep -A 3 "Session 20"
```

Expected: both show the new session 20 entries, no contradictions with existing content.

- [ ] **Step 15.6: Final commit + push**

```bash
git add CLAUDE.md ARCHITECTURE.md
git commit -m "Update CLAUDE.md, ARCHITECTURE.md, and memory for session 20

Session 20 event system shipped. Updates docs to reflect new tables,
new key files, new patterns, and retirement of search_index_queue.
Memory file replaced with post-implementation state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push origin main
```

Expected: push succeeds.

---

## Success Criteria Verification

After Task 15, run through the spec's section 13 success criteria and tick each off:

1. ✅ Migration 011 applied cleanly, three new tables exist, `search_index_queue` dropped
2. ✅ `npm test` passes, including new events-system tests
3. ✅ Creating a work item emits `work_item.created`, `neo4j-sync` cursor advances
4. ✅ Editing a work item produces one `work_item_edits` row per changed field, all sharing `edit_group_id`
5. ✅ Transition with api_call action produces both `transitioned` + `api_call_fired` events, API response < 200ms
6. ✅ Starting two API instances results in exactly one advisory lock held (verify via `pg_locks`)
7. ✅ Admin UI at `/admin/events` shows subscriber health and supports pause + skip-past
8. ✅ `graph/sync.js` called only from subscribers (grep confirms no direct imports from `runtime/transitions.js` or `runtime/workItems.js`)
9. ✅ `ARCHITECTURE.md`, `CLAUDE.md`, memory updated

If any fail, investigate root cause — do NOT paper over with test changes or stubs.
