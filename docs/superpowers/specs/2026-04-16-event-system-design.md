# FlowOS Event System — Design

**Status:** Draft, pending Chris approval
**Date:** 2026-04-16
**Session:** 20
**Owner:** Chris Tulino

---

## 1. Purpose

Replace the two ad-hoc cross-cutting mechanisms in FlowOS (synchronous `syncToGraph()` calls and the undrained `runtime.search_index_queue` table) with a single durable, multi-instance-safe event system that:

- Lets features subscribe to state changes without coupling producers to consumers
- Provides a foundation for notifications, SLA alerts, webhooks, Neo4j sync, and audit UI
- Captures complete field-level edit history in a dedicated durable table (Jira `changegroup`/`changeitem` analog)

This is a **Phase 1 foundation** item — the highest architectural leverage remaining before FlowOS ships as open source.

---

## 2. Locked Decisions

Five decisions were made during brainstorming (session 20):

| # | Decision | Rationale |
|---|---|---|
| 1 | **Events table is pure transport.** Field-level history lives in a dedicated `runtime.work_item_edits` table (Jira-shaped). | Generic JSONB events are the wrong shape for queryable audit UI. Purpose-built table matches how Jira, SNOW, and every mature system does it. |
| 2 | **Multi-instance safety via PG advisory lock.** Only one processor drains events across all API instances. | OSS users will run `docker-compose scale` / k8s. Single-instance-only is a footgun that causes duplicate notifications. Cost: ~30 LOC. |
| 3 | **Per-subscriber cursor pattern.** Each subscriber tracks its own `last_processed_event_id`. One bad subscriber does not block others. | Industry-standard for durable event streams (PG logical replication, Kafka, Kinesis). Natural retry, linear storage, clear observability. |
| 4 | **V1 event catalog = 15 event types.** Work-item lifecycle, transition side effects, exit criteria. No blueprint admin events until a subscriber needs them. | Don't emit what nobody consumes. Emission helper is one line per retrofit site. |
| 5 | **Hard cutover, no dual-write.** Replace `syncToGraph()` calls, drop `search_index_queue`, ship. | No live production data. Neo4j is unseeded. Dual-write scaffolding is churn. |

---

## 3. Architecture

### 3.1 Write Path

```
API endpoint
  └── runtime operation
        └── BEGIN tx (pg pool client)
              ├── mutate runtime.work_items / comments / etc.
              ├── INSERT INTO runtime.events            (via emitEvent helper)
              ├── INSERT INTO runtime.work_item_edits   (for edits only, synchronous)
              └── COMMIT
                      │
                      └── setImmediate → nudge primary processor
```

**Invariant:** events are inserted **inside the same transaction** as the state change they describe. If the transaction rolls back, the event row rolls back with it. No phantom events.

### 3.2 Read Path

```
Processor (one per API instance, only one holds PG advisory lock)
  └── tick (nudge OR 30s safety poll)
        └── for each registered subscriber:
              SELECT * FROM runtime.events
                WHERE id > subscriber.last_processed_event_id
                ORDER BY id ASC LIMIT 100
              for each event:
                if subscriber.handles(event.event_type):
                  run subscriber.handler(event)
                  on success: UPDATE event_subscribers.last_processed_event_id
                  on failure: UPDATE last_error, failure_count; break drain loop
                else:
                  advance cursor (skip-past)
```

### 3.3 Durable Audit Path (Independent of Event Processing)

```
runtime.work_item_edits           ← Jira changegroup/changeitem analog. Queried by audit UI.
runtime.stage_transition_history  ← Existing. Unchanged. Source of truth for transitions.
runtime.transition_action_log     ← Existing. Unchanged. Source of truth for action results.
runtime.sub_state_history         ← Existing. Unchanged. Source of truth for substate changes.
```

The audit UI reads these tables **directly**. It does not query the events table. Events are transport; audit tables are persistent record.

These tables and the events table are **written in the same transaction** for the state changes they describe. Rollback rolls back both; no drift is possible.

---

## 4. Schema

Migration `011_event_system.sql`:

```sql
-- Event bus (append-only log)
CREATE TABLE runtime.events (
    id           BIGSERIAL    PRIMARY KEY,
    event_type   TEXT         NOT NULL,
    entity_id    INTEGER      NOT NULL,
    entity_uri   TEXT,
    actor_id     INTEGER      REFERENCES blueprint.users(id),
    occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    payload      JSONB        NOT NULL
);
CREATE INDEX idx_events_type_entity ON runtime.events (entity_id, event_type, occurred_at);

-- Per-subscriber progress and health
CREATE TABLE runtime.event_subscribers (
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

-- Durable field-level edit history (Jira-shaped, one-table variant)
CREATE TABLE runtime.work_item_edits (
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
CREATE INDEX idx_work_item_edits_item  ON runtime.work_item_edits (work_item_id, edited_at DESC);
CREATE INDEX idx_work_item_edits_group ON runtime.work_item_edits (edit_group_id);

-- Retire legacy
DROP TABLE runtime.search_index_queue;
```

### Schema Notes

- **No `processed_at` on `events`** — cursor model replaces it. Events are append-only.
- **No `entity_type` column** — derived from `event_type` prefix.
- **`edit_group_id` UUID** groups multi-field edits from a single PATCH call. Unique `(edit_group_id, field_key)` makes the audit-log subscriber idempotent: rerunning never creates duplicates.
- **`event_subscribers` in runtime schema** — progress cursor is runtime state, even though subscriber identity is config-ish.

---

## 5. Emission API

### 5.1 `core/events.js`

```js
/**
 * Emit an event. MUST be called inside an open transaction (client, not pool).
 * The event row commits with the caller's transaction; nothing is visible to
 * subscribers until the transaction succeeds.
 */
export async function emitEvent(client, {
  eventType,   // e.g. 'work_item.transitioned'
  entityId,    // PK of the entity that changed
  entityUri,   // optional, for cross-instance identity
  actorId,     // user who caused this, null for system
  payload,     // JSON-serializable
}) {
  const result = await client.query(`
    INSERT INTO runtime.events (event_type, entity_id, entity_uri, actor_id, payload)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id
  `, [eventType, entityId, entityUri ?? null, actorId ?? null, JSON.stringify(payload ?? {})])
  return result.rows[0].id
}

/**
 * Call after COMMIT succeeds. Fire-and-forget.
 * Uses setImmediate so the commit round-trip finishes first.
 */
export function nudgeAfterCommit() {
  setImmediate(() => eventProcessor.nudge())
}
```

### 5.2 Caller Pattern

```js
const client = await getClient()
try {
  await client.query('BEGIN')
  // ... mutations ...
  await emitEvent(client, {
    eventType: 'work_item.transitioned',
    entityId:  workItemId,
    entityUri: workItem.uri,
    actorId:   userId,
    payload:   { fromStageId, toStageId, reason, workingTimeSeconds, transitionHistoryId },
  })
  await client.query('COMMIT')
  nudgeAfterCommit()
} catch (err) {
  await client.query('ROLLBACK')
  throw err
}
```

**Why two functions and not one:** the nudge cannot happen before commit (subscribers would see nothing on a lookup-then-process race). Keeping emit and nudge separate makes the "commit between them" contract visible at call sites.

---

## 6. Processor (`runtime/eventProcessor.js`)

### 6.1 Lifecycle

```js
const LOCK_KEY = 0x0F105053  // 'FlOS' — unique bigint for FlowOS event processor
const SAFETY_POLL_MS = 30_000
const BATCH_SIZE = 100

export async function startProcessor() {
  const locked = await tryAcquireAdvisoryLock(LOCK_KEY)
  if (locked) {
    await becomePrimary()
    return
  }
  // Another API instance holds the lock. Poll every 30s in case it dies.
  const failoverTimer = setInterval(async () => {
    const got = await tryAcquireAdvisoryLock(LOCK_KEY)
    if (got) {
      clearInterval(failoverTimer)
      await becomePrimary()
    }
  }, SAFETY_POLL_MS)
}

async function becomePrimary() {
  await upsertSubscriberRows()    // sync registered subscribers → event_subscribers table
  setInterval(drainAll, SAFETY_POLL_MS)
  drainAll()                      // initial drain on boot
}

export function nudge() {
  // Called from nudgeAfterCommit. Coalesce rapid nudges to one drain.
  if (drainPending) return
  drainPending = true
  setImmediate(() => { drainPending = false; drainAll() })
}
```

### 6.2 Drain Loop

```js
async function drainAll() {
  if (!isPrimary) return
  for (const subscriber of SUBSCRIBERS) {
    if (subscriber.isPaused) continue
    await drainOne(subscriber)
  }
}

async function drainOne(sub) {
  const { rows: events } = await query(`
    SELECT * FROM runtime.events
    WHERE id > $1 ORDER BY id ASC LIMIT $2
  `, [sub.cursor, BATCH_SIZE])

  for (const event of events) {
    if (!sub.handles(event.event_type)) {
      await advanceCursor(sub, event.id)
      continue
    }
    try {
      await sub.handler(event)
      await advanceCursor(sub, event.id)
      sub.failureCount = 0
    } catch (err) {
      await recordFailure(sub, event.id, err)
      break  // Do NOT advance. Next tick retries this event.
    }
  }
}
```

### 6.3 Advisory Lock

```js
async function tryAcquireAdvisoryLock(key) {
  // Held on a dedicated long-lived connection. Released when connection dies.
  const conn = await pool.connect()
  const { rows } = await conn.query('SELECT pg_try_advisory_lock($1) AS locked', [key])
  if (rows[0].locked) {
    lockConn = conn  // keep the connection alive for as long as we want the lock
    return true
  }
  conn.release()
  return false
}
```

Lock is released when the connection closes. On process crash, PG cleans up within seconds.

---

## 7. Subscribers

### 7.1 Registered in `runtime/eventProcessor.js`

```js
import { neo4jSyncHandler } from './subscribers/neo4jSync.js'
import { auditLogHandler }  from './subscribers/auditLog.js'

const SUBSCRIBERS = [
  {
    name: 'neo4j-sync',
    handles: (t) => t.startsWith('work_item.') || t.startsWith('transition_action.'),
    handler: neo4jSyncHandler,
  },
  {
    name: 'audit-log',
    handles: (t) => t === 'work_item.edited',
    handler: auditLogHandler,
  },
]
```

On boot, rows are upserted into `event_subscribers` — so the cursor persists across restarts but the subscriber code is version-controlled.

### 7.2 `neo4j-sync` (`runtime/subscribers/neo4jSync.js`)

Thin mapper from event type → existing `graph/sync.js` handlers. Keeps all Neo4j Cypher in one place.

```js
const TYPE_MAP = {
  'work_item.created':            (e) => syncToGraph('work_item', e.entity_uri, 'create', e.payload),
  'work_item.edited':             (e) => syncToGraph('work_item', e.entity_uri, 'update', e.payload.current),
  'work_item.transitioned':       (e) => syncToGraph('stage_transition', e.entity_uri, 'update', e.payload),
  'work_item.assigned':           (e) => syncToGraph('user_relationship', e.entity_uri, 'upsert', e.payload),
  'work_item.unassigned':         (e) => syncToGraph('user_relationship', e.entity_uri, 'delete', e.payload),
  'transition_action.spawn_fired':(e) => syncToGraph('work_item', e.payload.spawned_uri, 'create', e.payload.spawned),
}

export async function neo4jSyncHandler(event) {
  const h = TYPE_MAP[event.event_type]
  if (h) await h(event)
}
```

Neo4j failures become subscriber failures — visible in admin UI. Cursor sits until Neo4j recovers.

### 7.3 `audit-log` (`runtime/subscribers/auditLog.js`)

Consumes only `work_item.edited` events. Writes one row per field change to `runtime.work_item_edits`:

```js
export async function auditLogHandler(event) {
  const { changes, edit_group_id } = event.payload
  for (const change of changes) {
    await query(`
      INSERT INTO runtime.work_item_edits
        (work_item_id, edited_by, edited_at, edit_group_id,
         field_key, field_type, old_value, new_value)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      ON CONFLICT (edit_group_id, field_key) DO NOTHING
    `, [event.entity_id, event.actor_id, event.occurred_at, edit_group_id,
        change.field, change.type, JSON.stringify(change.old), JSON.stringify(change.new)])
  }
}
```

The unique constraint plus `ON CONFLICT DO NOTHING` makes the subscriber idempotent — reprocessing never creates duplicate audit rows.

---

## 8. Event Catalog (V1)

Fifteen event types emitted in v1. Each is driven by a concrete subscriber or a v2 subscriber whose shape is already known.

### 8.1 Work Item Lifecycle

| Event Type | Emission Site | Payload Highlights |
|---|---|---|
| `work_item.created` | `runtime/workItems.js` create | type_id, owner_org_id, entry_stage_id, title, field_values |
| `work_item.edited` | `admin/api.js` PATCH /work-items/:id | `changes: [{field, type, old, new}]`, `edit_group_id` |
| `work_item.transitioned` | `runtime/transitions.js` execute | from_stage_id, to_stage_id, reason, working_time_seconds, transition_history_id |
| `work_item.substate_changed` | `admin/api.js` substate endpoint | old_substate, new_substate |
| `work_item.assigned` | `admin/api.js` people endpoints | user_id, relationship_type |
| `work_item.unassigned` | `admin/api.js` people endpoints | user_id, relationship_type |
| `work_item.linked` | `admin/api.js` links endpoints | link_type, target_work_item_id |
| `work_item.unlinked` | `admin/api.js` links endpoints | link_type, target_work_item_id |
| `work_item.commented` | `admin/api.js` comments POST | comment_id, parent_comment_id, body |
| `work_item.comment_edited` | `admin/api.js` comments PATCH | comment_id, old_body, new_body |
| `work_item.comment_deleted` | `admin/api.js` comments DELETE | comment_id |

### 8.2 Transition Side Effects

| Event Type | Emission Site | Payload Highlights |
|---|---|---|
| `transition_action.api_call_fired` | `runtime/transitions.js` fireApiCallAction | endpoint, response_code, failed, failure_reason |
| `transition_action.spawn_fired` | `runtime/transitions.js` executeSpawnAction | spawned_work_item_id, spawned_uri, spawned_type_id |

### 8.3 Exit Criteria

| Event Type | Emission Site | Payload Highlights |
|---|---|---|
| `exit_criteria.acknowledged` | `runtime/exitCriteria.js` acknowledge | criterion_id, stage_id |
| `exit_criteria.waived` | `runtime/exitCriteria.js` waive | criterion_id, stage_id, waive_reason |

### 8.4 Emission Conventions

- **Delta payloads for edits.** `work_item.edited` carries `changes: [{field, type, old, new}]`, one entry per field mutated in that PATCH.
- **Structured payloads for actions.** Action events carry the full context needed by any subscriber — no "go look up the rest from the DB" patterns.
- **Actor is the authenticated user.** `actorId = null` only for system-initiated events (e.g., system-forced transitions via cron jobs in the future).

---

## 9. Cutover

### 9.1 Files Touched

Created:
- `core/events.js`
- `runtime/eventProcessor.js`
- `runtime/subscribers/neo4jSync.js`
- `runtime/subscribers/auditLog.js`
- `db/migrations/011_event_system.sql`
- `admin-ui/src/pages/EventSubscribers.jsx`
- `tests/events-api.test.js`

Modified:
- `runtime/transitions.js` — replace `syncToGraph()` calls with `emitEvent()`; add emissions for action fires and spawns
- `runtime/workItems.js` — replace `search_index_queue` inserts with `emitEvent()`
- `runtime/exitCriteria.js` — emit on acknowledge/waive
- `admin/api.js` — emit on edit, substate, assignments, links, comments (~10 sites)
- `api/server.js` — call `startProcessor()` during boot
- `admin-ui/src/App.jsx` — route for EventSubscribers page
- `admin-ui/src/lib/api.js` — client calls for subscriber health endpoints

Removed:
- Direct `syncToGraph()` imports from runtime callers (handlers stay; only call sites move)
- `runtime.search_index_queue` table (DROP in migration)

### 9.2 Order of Implementation

1. Migration + schema
2. `core/events.js` emit helper
3. `runtime/eventProcessor.js` with stub subscribers (proves advisory lock, cursor, drain loop)
4. `neo4jSync` subscriber — replace synchronous `syncToGraph()` calls in transitions and workItems
5. `auditLog` subscriber + `work_item_edits` writes
6. Retrofit emission sites across `admin/api.js`, `exitCriteria.js`
7. Admin UI page + API endpoints (GET /event-subscribers, POST /event-subscribers/:name/pause, POST /event-subscribers/:name/skip-past/:eventId)
8. Tests
9. Drop `search_index_queue`
10. Update `CLAUDE.md`, `ARCHITECTURE.md`, memory files

---

## 10. Admin UI (V1 Minimum)

Page at `/admin/events`, placed in Dev Tools sidebar section.

**Content:**
- Table of subscribers: name, cursor position, last_success_at, last_error_at, failure_count, pause toggle
- Per-row "Skip past event N" button (confirmation required — it's a data-loss operation for that subscriber on that event)
- Event firehose: last 200 events, newest first, filterable by `event_type` prefix

**Not in v1:**
- Replay (re-running a subscriber from an earlier cursor position)
- Per-event drill-down / payload inspector
- Subscriber config editing

Both are cheap follow-ups if operators need them.

---

## 11. Testing

Integration tests in `tests/events-api.test.js`, hitting the running API. Target ~15 tests covering:

1. **Emission transactional semantics.** Roll back a tx containing an emit; assert no event row. Commit; assert exactly one.
2. **Cursor advance.** Emit 10 events, drain once, assert cursor = 10.
3. **Event type filtering.** Emit mixed types; assert subscriber only processes matching types but cursor advances past all.
4. **Failure isolation.** Stub subscriber to throw on event N. Assert its cursor stays at N-1, `last_error` is set, `failure_count = 1`. Other subscribers complete past N.
5. **Recovery.** Fix the throwing stub, drain, assert cursor advances, `failure_count` resets.
6. **Advisory lock.** Spin up two processor instances in one test run; assert only one drains.
7. **Audit log idempotency.** Emit `work_item.edited` with 3 changes. Assert 3 rows in `work_item_edits`. Reset subscriber cursor, re-drain, assert still 3 rows (not 6).
8. **Audit log groups multi-field edits.** Emit one event with 3 field changes; assert all 3 rows share `edit_group_id`.
9. **Neo4j sync event mapping.** With Neo4j offline, emit `work_item.transitioned`. Assert subscriber fails, cursor sits, `last_error` populated.
10. **Admin pause / resume.** Pause subscriber, emit events, drain, assert cursor does not advance. Resume, drain, assert cursor advances.
11. **Admin skip-past.** Cursor stuck at N due to handler bug. POST skip-past/N. Assert cursor = N, next drain processes N+1 onward.
12. **API response time unaffected.** Measure PATCH /work-items/:id latency with subscriber stubbed slow (100ms). Assert API response < 20ms (emission is in-tx, nudge is fire-and-forget).
13. **Transition emits both `transitioned` and any `action_fired` events.** Complete a transition with an api_call action; assert 2 events in runtime.events.
14. **Spawn action emits `spawn_fired` AND `work_item.created` for the child.** Assert both exist and link via payload.
15. **`work_item.unassigned` cleans up user relationship.** End-to-end: emit unassigned, subscriber drains, Neo4j shows `is_active=false` on relationship (if Neo4j is up; otherwise just assert subscriber cursor advanced).

---

## 12. Risks & Open Questions

### Risks

1. **Subscriber code bug crashes the primary processor.** Mitigation: subscriber errors are caught and recorded per-subscriber; the processor itself never throws out of `drainOne`.
2. **Advisory lock acquired but not released.** PG auto-releases when the holding connection closes. We keep the lock on a dedicated connection, not a pool client. If the process dies, PG cleans up within a few seconds.
3. **Events table grows unbounded.** V1 accepts this. Follow-up: a retention cron removing events older than 30 days (default), configurable per-installer. Pruning is safe because `work_item_edits` holds the durable audit.
4. **Nudge from non-primary instances is lost.** If API instance B emits an event but A is primary, A won't be nudged until safety poll (30s). Acceptable latency for v1. Can add PG `LISTEN/NOTIFY` cross-instance later if needed.

### Deferred / Future

- Blueprint admin events (`workflow.edited`, `org.created`, etc.) — emit when first subscriber needs them.
- Replay / rewind operator action.
- Per-event-type retention policy.
- Push-based subscribers (HTTP webhooks) as a dedicated subscriber type.
- `LISTEN/NOTIFY` for cross-instance nudging.

---

## 13. Success Criteria

The event system is done when:

1. Migration 011 applies cleanly, creates all three tables, drops `search_index_queue`.
2. `npm test` passes, including the new ~15 events tests.
3. Creating a work item emits `work_item.created`, which the `neo4j-sync` subscriber processes (verifiable by checking `events_processed_total` in subscriber row, and Neo4j node presence when Neo4j is running).
4. Editing a work item produces one row per changed field in `runtime.work_item_edits`, all sharing an `edit_group_id`.
5. A transition with an api_call action produces two events (`transitioned`, `api_call_fired`) and does not block the HTTP response on the api_call result.
6. Starting two API instances results in exactly one processor running, as reflected by PG's `pg_locks` view and by the admin UI showing only one active processor.
7. Admin UI exposes subscriber health and a working skip-past operation.
8. `graph/sync.js` is still called *only* from within subscribers — no direct imports from `runtime/transitions.js` or `runtime/workItems.js`.
9. `ARCHITECTURE.md`, `CLAUDE.md`, and memory are updated to reflect the shipped design.
