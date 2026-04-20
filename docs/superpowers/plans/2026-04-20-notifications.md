# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 notifications system defined in
`docs/superpowers/specs/2026-04-20-notifications-design.md` — fanout subscriber,
delivery worker, four channels (in_app/email/webhook/agent), three-layer rate
limiting, webhook ownership challenge, admin UI surface.

**Architecture:** New event subscriber (`notifications`) runs in the existing
event processor and writes `runtime.notifications` rows + enqueues out-of-band
`runtime.notification_deliveries`. A separate delivery worker (advisory-locked)
drains the outbox with retries, rate limits, and per-user digest aggregation.
In-app delivery is served by direct query of the notifications table. UI is a
sidebar bell → right-side Sheet drawer, plus a settings page, plus card dots
on the Board.

**Tech Stack:** Node.js (ESM), Express, PostgreSQL (`pg`), nodemailer, React
18 + Vite + shadcn/ui + Tailwind. No ORM. Integration tests via `node --test`.

**Spec reference:** Every design decision, schema choice, and default value in
this plan traces to the spec. Where the plan simplifies, it does so faithfully
— do not add fields/behaviors not in the spec.

**Codebase conventions (mandatory):**
- ES modules everywhere (`import`/`export`), no `require()`
- Parameterized SQL, never string interpolation
- Two-schema discipline: `blueprint` = structural, `runtime` = instances
- New migrations are `IF NOT EXISTS` / `CREATE OR REPLACE` — idempotent
- Integration tests hit a running server on `localhost:3000`
- Frontend: `text-xs`/`text-sm` only, cartography theme, no modals (right-side
  Sheet only), no `font-mono`, Inter everywhere, functional components,
  components under 200 lines

---

## File Structure

### New files

```
db/migrations/012_notifications.sql
runtime/subscribers/notifications.js
runtime/notifications/matrix.js
runtime/notifications/summaries.js
runtime/notifications/mentions.js
runtime/notifications/ownershipChallenge.js
runtime/channels/webhook.js
runtime/channels/email.js
runtime/channels/agent.js
runtime/deliveryWorker.js
runtime/rateLimiter.js
runtime/jobs/notificationRetention.js
admin-ui/src/components/NotificationsDrawer.jsx
admin-ui/src/components/NotificationsBell.jsx
admin-ui/src/pages/SettingsNotifications.jsx
tests/notifications-fanout.test.js
tests/notifications-delivery.test.js
tests/notifications-ratelimit.test.js
tests/notifications-ownership-challenge.test.js
tests/notifications-integration.test.js
```

### Modified files

```
runtime/eventProcessor.js            # register notifications subscriber
api/server.js                        # start deliveryWorker + retention job
admin/api.js                         # add ~8 notification endpoints
admin-ui/src/lib/api.js              # add notification API client methods
admin-ui/src/components/Sidebar.jsx  # add bell icon
admin-ui/src/pages/Board.jsx         # add card-dot query / unread badge
admin-ui/src/components/WorkItemCard.jsx  # render unread dot
admin-ui/src/App.jsx                 # route for settings page
```

---

## Execution Order

Tasks are ordered so each can be merged independently. Run backend tasks 1–19
to completion (with tests passing) before starting UI tasks 20–24. Task 25 is
end-to-end integration and runs last.

---

## Task 1: Migration 012 — schema, seeds, is_agent column

**Files:**
- Create: `db/migrations/012_notifications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 012: Notifications
-- Adds notification defaults, per-user channels, overrides, notifications table,
-- delivery outbox, and is_agent flag on users.

-- =============================================================================
-- is_agent flag on users
-- =============================================================================

ALTER TABLE blueprint.users
  ADD COLUMN IF NOT EXISTS is_agent BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- Default matrix (seeded, structural)
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.notification_defaults (
  relationship_type TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (relationship_type, event_type)
);

-- Seed the matrix. See spec §Default Matrix.
INSERT INTO blueprint.notification_defaults (relationship_type, event_type, enabled)
VALUES
  ('watching',   'work_item.created',             true),
  ('watching',   'work_item.edited',              true),
  ('owns',       'work_item.transitioned',        true),
  ('working_on', 'work_item.transitioned',        true),
  ('watching',   'work_item.transitioned',        true),
  ('requester',  'work_item.transitioned',        true),
  ('owns',       'work_item.substate_changed',    true),
  ('working_on', 'work_item.substate_changed',    true),
  ('watching',   'work_item.substate_changed',    true),
  ('owns',       'work_item.assigned',            true),
  ('working_on', 'work_item.assigned',            true),
  ('reviewing',  'work_item.assigned',            true),
  ('watching',   'work_item.assigned',            true),
  ('owns',       'work_item.commented',           true),
  ('working_on', 'work_item.commented',           true),
  ('reviewing',  'work_item.commented',           true),
  ('watching',   'work_item.commented',           true),
  ('requester',  'work_item.commented',           true),
  ('mentioned',  'work_item.commented',           true),
  ('owns',       'work_item.spawned',             true),
  ('watching',   'work_item.spawned',             true),
  ('requester',  'work_item.spawned',             true),
  ('owns',       'exit_criteria.acknowledged',    true),
  ('working_on', 'exit_criteria.acknowledged',    true),
  ('reviewing',  'exit_criteria.acknowledged',    true),
  ('watching',   'exit_criteria.acknowledged',    true),
  ('owns',       'exit_criteria.unacknowledged',  true),
  ('working_on', 'exit_criteria.unacknowledged',  true),
  ('reviewing',  'exit_criteria.unacknowledged',  true),
  ('watching',   'exit_criteria.unacknowledged',  true),
  ('owns',       'exit_criteria.waived',          true),
  ('working_on', 'exit_criteria.waived',          true),
  ('reviewing',  'exit_criteria.waived',          true),
  ('watching',   'exit_criteria.waived',          true),
  ('requester',  'exit_criteria.waived',          true),
  ('owns',       'work_item.linked',              true),
  ('watching',   'work_item.linked',              true)
ON CONFLICT (relationship_type, event_type) DO NOTHING;

-- =============================================================================
-- Per-user channel config (hybrid: typed columns + config JSONB)
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.user_notification_channels (
  user_id          INTEGER     NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  channel          TEXT        NOT NULL CHECK (channel IN ('in_app','email','webhook','agent')),
  is_enabled       BOOLEAN     NOT NULL DEFAULT true,
  digest           TEXT        NOT NULL DEFAULT 'realtime'
                                 CHECK (digest IN ('realtime','hourly','daily')),
  next_digest_at   TIMESTAMPTZ,
  config           JSONB       NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, channel)
);

-- =============================================================================
-- Per-user matrix overrides (sparse)
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.user_notification_overrides (
  user_id           INTEGER NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  relationship_type TEXT    NOT NULL,
  event_type        TEXT    NOT NULL,
  enabled           BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, relationship_type, event_type)
);

-- =============================================================================
-- In-app inbox
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.notifications (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       INTEGER     NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  event_id      BIGINT      NOT NULL REFERENCES runtime.events(id) ON DELETE CASCADE,
  work_item_id  INTEGER     REFERENCES runtime.work_items(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,
  reasons       TEXT[]      NOT NULL,
  summary       TEXT        NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON runtime.notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_workitem
  ON runtime.notifications (user_id, work_item_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON runtime.notifications (user_id, id DESC);

-- =============================================================================
-- Delivery outbox
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.notification_deliveries (
  id               BIGSERIAL   PRIMARY KEY,
  notification_id  BIGINT      NOT NULL REFERENCES runtime.notifications(id) ON DELETE CASCADE,
  channel          TEXT        NOT NULL CHECK (channel IN ('email','webhook','agent')),
  status           TEXT        NOT NULL CHECK (status IN ('pending','sent','failed')) DEFAULT 'pending',
  attempt_count    INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_pending
  ON runtime.notification_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_deliveries_notification
  ON runtime.notification_deliveries (notification_id);

-- Seed the subscriber row so the processor picks it up on next boot.
INSERT INTO runtime.event_subscribers (name, last_processed_event_id)
VALUES ('notifications', COALESCE((SELECT MAX(id) FROM runtime.events), 0))
ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

Run: `psql "$DATABASE_URL" -f db/migrations/012_notifications.sql`
Expected: no errors, all `CREATE TABLE` statements succeed.

- [ ] **Step 3: Verify schema**

Run:
```bash
psql "$DATABASE_URL" -c "\dt blueprint.notification_*"
psql "$DATABASE_URL" -c "\dt runtime.notification*"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM blueprint.notification_defaults"
```
Expected: three blueprint tables exist; two runtime tables exist; seed count = 37.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/012_notifications.sql
git commit -m "notifications: migration 012 — schema, seeds, is_agent"
```

---

## Task 2: Matrix module — pure lookup + override resolution

**Files:**
- Create: `runtime/notifications/matrix.js`
- Test: `tests/notifications-fanout.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/notifications-fanout.test.js
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { loadMatrix, isEnabled } from '../runtime/notifications/matrix.js'

describe('notifications/matrix', () => {
  let testUserId
  before(async () => {
    const { rows } = await query(
      `INSERT INTO blueprint.users (email, password_hash, display_name, is_active, auth_provider)
       VALUES ('matrix-test@flowos.local', 'x', 'Matrix Test', true, 'local')
       RETURNING id`
    )
    testUserId = rows[0].id
  })
  after(async () => {
    await query('DELETE FROM blueprint.user_notification_overrides WHERE user_id = $1', [testUserId])
    await query('DELETE FROM blueprint.users WHERE id = $1', [testUserId])
  })

  it('loads defaults from blueprint.notification_defaults', async () => {
    const m = await loadMatrix(testUserId)
    assert.equal(m.isEnabled('owns', 'work_item.transitioned'), true)
    assert.equal(m.isEnabled('watching', 'work_item.edited'), true)
    assert.equal(m.isEnabled('owns', 'work_item.edited'), false)
  })

  it('overrides shadow the default', async () => {
    await query(
      `INSERT INTO blueprint.user_notification_overrides (user_id, relationship_type, event_type, enabled)
       VALUES ($1, 'watching', 'work_item.edited', false)`,
      [testUserId]
    )
    const m = await loadMatrix(testUserId)
    assert.equal(m.isEnabled('watching', 'work_item.edited'), false)
  })

  it('isEnabled is a pure function over a loaded matrix', () => {
    const m = {
      defaults:  new Map([['watching|work_item.edited', true]]),
      overrides: new Map([['watching|work_item.edited', false]]),
    }
    assert.equal(isEnabled(m, 'watching', 'work_item.edited'), false)
    assert.equal(isEnabled(m, 'owns', 'work_item.unknown'), false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/notifications-fanout.test.js`
Expected: FAIL — `loadMatrix` / `isEnabled` not exported.

- [ ] **Step 3: Implement `runtime/notifications/matrix.js`**

```js
/**
 * runtime/notifications/matrix.js
 * Loads the default role×event-type matrix and a user's sparse overrides,
 * returning a pure in-memory object plus a helper. No side effects.
 */

import { query } from '../../db/postgres.js'

function key(rel, type) { return `${rel}|${type}` }

export async function loadMatrix(userId) {
  const [{ rows: defaults }, { rows: overrides }] = await Promise.all([
    query('SELECT relationship_type, event_type, enabled FROM blueprint.notification_defaults'),
    query('SELECT relationship_type, event_type, enabled FROM blueprint.user_notification_overrides WHERE user_id = $1', [userId]),
  ])
  const matrix = {
    defaults:  new Map(defaults.map(r => [key(r.relationship_type, r.event_type), r.enabled])),
    overrides: new Map(overrides.map(r => [key(r.relationship_type, r.event_type), r.enabled])),
  }
  return {
    ...matrix,
    isEnabled: (rel, type) => isEnabled(matrix, rel, type),
  }
}

export function isEnabled(matrix, rel, type) {
  const k = key(rel, type)
  if (matrix.overrides.has(k)) return matrix.overrides.get(k)
  return matrix.defaults.get(k) ?? false
}

export default { loadMatrix, isEnabled }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/notifications-fanout.test.js`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/notifications/matrix.js tests/notifications-fanout.test.js
git commit -m "notifications: matrix lookup with per-user overrides"
```

---

## Task 3: Summary renderer

**Files:**
- Create: `runtime/notifications/summaries.js`
- Test: extend `tests/notifications-fanout.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/notifications-fanout.test.js`:

```js
import { renderSummary } from '../runtime/notifications/summaries.js'

describe('notifications/summaries', () => {
  const baseWorkItem = { id: 42, display_key: 'BUG.42', title: 'Login is broken' }

  it('renders work_item.transitioned summary', () => {
    const s = renderSummary(
      { event_type: 'work_item.transitioned', payload: { from_stage_name: 'Triage', to_stage_name: 'In Progress' } },
      baseWorkItem,
    )
    assert.match(s, /BUG\.42/)
    assert.match(s, /Triage/)
    assert.match(s, /In Progress/)
  })

  it('renders work_item.commented summary with truncated body', () => {
    const long = 'x'.repeat(200)
    const s = renderSummary(
      { event_type: 'work_item.commented', payload: { body: long, author_name: 'Chris' } },
      baseWorkItem,
    )
    assert.match(s, /Chris/)
    assert.match(s, /BUG\.42/)
    assert.ok(s.length < 180, 'summary should truncate')
  })

  it('falls back to a generic summary for unknown event types', () => {
    const s = renderSummary(
      { event_type: 'work_item.whatever', payload: {} },
      baseWorkItem,
    )
    assert.match(s, /BUG\.42/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/notifications-fanout.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `runtime/notifications/summaries.js`**

```js
/**
 * runtime/notifications/summaries.js
 * Pure function: (event, workItem) => short human-readable summary string.
 */

const MAX = 160

function truncate(s, n = 80) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

const RENDERERS = {
  'work_item.created':        (e, w) => `${w.display_key} created: ${truncate(w.title)}`,
  'work_item.edited':         (e, w) => `${w.display_key} edited`,
  'work_item.transitioned':   (e, w) => `${w.display_key} moved from ${e.payload.from_stage_name} to ${e.payload.to_stage_name}`,
  'work_item.substate_changed': (e, w) => `${w.display_key} is now ${e.payload.substate}`,
  'work_item.assigned':       (e, w) => `${w.display_key} — ${e.payload.user_name ?? 'someone'} added as ${e.payload.relationship_type}`,
  'work_item.commented':      (e, w) => `${e.payload.author_name ?? 'Someone'} commented on ${w.display_key}: ${truncate(e.payload.body, 80)}`,
  'work_item.spawned':        (e, w) => `${w.display_key} was spawned`,
  'work_item.linked':         (e, w) => `${w.display_key} linked to ${e.payload.linked_display_key ?? 'another item'}`,
  'exit_criteria.acknowledged':   (e, w) => `Exit criterion checked on ${w.display_key}: ${truncate(e.payload.criterion_label, 60)}`,
  'exit_criteria.unacknowledged': (e, w) => `Exit criterion un-checked on ${w.display_key}: ${truncate(e.payload.criterion_label, 60)}`,
  'exit_criteria.waived':         (e, w) => `Exit criterion waived on ${w.display_key}: ${truncate(e.payload.criterion_label, 60)}`,
}

export function renderSummary(event, workItem) {
  const fn = RENDERERS[event.event_type]
  const out = fn ? fn(event, workItem) : `${workItem.display_key}: ${event.event_type}`
  return out.length > MAX ? out.slice(0, MAX - 1) + '…' : out
}

export default { renderSummary }
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/notifications-fanout.test.js`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/notifications/summaries.js tests/notifications-fanout.test.js
git commit -m "notifications: summary renderer per event type"
```

---

## Task 4: Mention extraction

**Files:**
- Create: `runtime/notifications/mentions.js`
- Test: extend `tests/notifications-fanout.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { extractMentions } from '../runtime/notifications/mentions.js'

describe('notifications/mentions', () => {
  it('extracts @handles from comment text', () => {
    const ids = extractMentions('hey @alice and @bob, look at this', {
      alice: 10, bob: 11, carol: 12,
    })
    assert.deepEqual(ids.sort((a, b) => a - b), [10, 11])
  })

  it('ignores unknown handles', () => {
    const ids = extractMentions('@mystery wrote this', { alice: 10 })
    assert.deepEqual(ids, [])
  })

  it('deduplicates repeated mentions', () => {
    const ids = extractMentions('@alice @alice @alice', { alice: 10 })
    assert.deepEqual(ids, [10])
  })

  it('handles empty / null input', () => {
    assert.deepEqual(extractMentions('', {}), [])
    assert.deepEqual(extractMentions(null, {}), [])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/notifications-fanout.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `runtime/notifications/mentions.js`**

```js
/**
 * runtime/notifications/mentions.js
 * Pure function: extract user ids from @handle mentions in a body string.
 * The handle→id map is passed in — caller is responsible for populating it.
 */

const MENTION_RE = /@([A-Za-z0-9_.-]+)/g

export function extractMentions(body, handleToId) {
  if (!body || typeof body !== 'string') return []
  const out = new Set()
  let m
  while ((m = MENTION_RE.exec(body)) !== null) {
    const id = handleToId[m[1]]
    if (id) out.add(id)
  }
  return [...out]
}

export default { extractMentions }
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/notifications-fanout.test.js`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/notifications/mentions.js tests/notifications-fanout.test.js
git commit -m "notifications: @mention extraction"
```

---

## Task 5: Notifications subscriber handler

**Files:**
- Create: `runtime/subscribers/notifications.js`
- Test: extend `tests/notifications-fanout.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { query, getClient } from '../db/postgres.js'
import { emitEvent } from '../core/events.js'
import { notificationsHandler, handlesEventType as notifHandles } from '../runtime/subscribers/notifications.js'

describe('subscribers/notifications — fanout', () => {
  let ownerId, watcherId, actorId, workItemId
  before(async () => {
    const { rows: users } = await query(`
      INSERT INTO blueprint.users (email, password_hash, display_name, is_active, auth_provider)
      VALUES
        ('fanout-owner@x','x','Owner',true,'local'),
        ('fanout-watcher@x','x','Watcher',true,'local'),
        ('fanout-actor@x','x','Actor',true,'local')
      RETURNING id
    `)
    ;[ownerId, watcherId, actorId] = users.map(u => u.id)

    const { rows: wi } = await query(`SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1`)
    workItemId = wi[0].id

    await query(`
      INSERT INTO runtime.work_item_user_relationships (work_item_id, user_id, relationship_type)
      VALUES ($1,$2,'owns'), ($1,$3,'watching'), ($1,$4,'watching')
      ON CONFLICT DO NOTHING
    `, [workItemId, ownerId, watcherId, actorId])
  })

  after(async () => {
    await query(`DELETE FROM runtime.notifications WHERE user_id = ANY($1)`, [[ownerId, watcherId, actorId]])
    await query(`DELETE FROM runtime.work_item_user_relationships WHERE user_id = ANY($1)`, [[ownerId, watcherId, actorId]])
    await query(`DELETE FROM blueprint.users WHERE id = ANY($1)`, [[ownerId, watcherId, actorId]])
  })

  it('writes one notifications row per eligible recipient, excluding actor', async () => {
    const c = await getClient()
    let eventId
    try {
      await c.query('BEGIN')
      eventId = await emitEvent(c, {
        eventType: 'work_item.transitioned',
        entityId:  workItemId,
        actorId:   actorId,
        payload:   { from_stage_name: 'A', to_stage_name: 'B' },
      })
      await c.query('COMMIT')
    } finally { c.release() }

    const event = (await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])).rows[0]
    await notificationsHandler(event)

    const { rows } = await query(
      'SELECT user_id, reasons FROM runtime.notifications WHERE event_id = $1 ORDER BY user_id',
      [eventId]
    )
    const userIds = rows.map(r => r.user_id)
    assert.ok(userIds.includes(ownerId))
    assert.ok(userIds.includes(watcherId))
    assert.ok(!userIds.includes(actorId), 'actor must be suppressed')
  })

  it('collapses dedup: owner + requester -> one row with both reasons', async () => {
    await query('UPDATE runtime.work_items SET requester_id = $1 WHERE id = $2', [ownerId, workItemId])

    const c = await getClient()
    let eventId
    try {
      await c.query('BEGIN')
      eventId = await emitEvent(c, {
        eventType: 'work_item.commented',
        entityId:  workItemId,
        actorId:   actorId,
        payload:   { body: 'a thing', author_name: 'Actor' },
      })
      await c.query('COMMIT')
    } finally { c.release() }

    const event = (await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])).rows[0]
    await notificationsHandler(event)

    const { rows } = await query(
      'SELECT reasons FROM runtime.notifications WHERE event_id = $1 AND user_id = $2',
      [eventId, ownerId]
    )
    assert.equal(rows.length, 1)
    assert.ok(rows[0].reasons.includes('owns'))
    assert.ok(rows[0].reasons.includes('requester'))
  })

  it('handlesEventType covers every seeded event type', async () => {
    const { rows } = await query('SELECT DISTINCT event_type FROM blueprint.notification_defaults')
    for (const r of rows) assert.equal(notifHandles(r.event_type), true, r.event_type)
    assert.equal(notifHandles('test.random'), false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/notifications-fanout.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `runtime/subscribers/notifications.js`**

```js
/**
 * runtime/subscribers/notifications.js
 * Resolves recipients via relationships + matrix, suppresses the actor,
 * dedups, and writes notifications + deliveries atomically.
 */

import { query, getClient } from '../../db/postgres.js'
import { loadMatrix } from '../notifications/matrix.js'
import { renderSummary } from '../notifications/summaries.js'
import { extractMentions } from '../notifications/mentions.js'

const HANDLED = new Set()

export function handlesEventType(eventType) {
  return HANDLED.has(eventType)
}

async function ensureHandledLoaded() {
  if (HANDLED.size > 0) return
  const { rows } = await query('SELECT DISTINCT event_type FROM blueprint.notification_defaults')
  for (const r of rows) HANDLED.add(r.event_type)
}

async function fetchWorkItem(workItemId) {
  const { rows } = await query(
    `SELECT id, display_key, title, requester_id FROM runtime.work_items WHERE id = $1`,
    [workItemId]
  )
  return rows[0] ?? null
}

async function fetchRelationships(workItemId) {
  const { rows } = await query(
    `SELECT user_id, relationship_type FROM runtime.work_item_user_relationships WHERE work_item_id = $1`,
    [workItemId]
  )
  return rows
}

async function fetchHandleMap() {
  const { rows } = await query(`SELECT id, split_part(email, '@', 1) AS handle FROM blueprint.users WHERE is_active = true`)
  const m = {}
  for (const r of rows) m[r.handle] = r.id
  return m
}

async function fetchEnabledOutOfBandChannels(userId) {
  const { rows } = await query(
    `SELECT channel FROM blueprint.user_notification_channels
     WHERE user_id = $1 AND is_enabled = true AND channel <> 'in_app'`,
    [userId]
  )
  return rows.map(r => r.channel)
}

export async function notificationsHandler(event) {
  await ensureHandledLoaded()
  if (!HANDLED.has(event.event_type)) return

  const workItem = await fetchWorkItem(event.entity_id)
  if (!workItem) return

  const candidates = new Map()
  const addCandidate = (uid, rel) => {
    if (!uid) return
    if (!candidates.has(uid)) candidates.set(uid, new Set())
    candidates.get(uid).add(rel)
  }

  for (const r of await fetchRelationships(workItem.id)) {
    addCandidate(r.user_id, r.relationship_type)
  }
  addCandidate(workItem.requester_id, 'requester')

  if (event.event_type === 'work_item.commented') {
    const handleMap = await fetchHandleMap()
    for (const uid of extractMentions(event.payload?.body, handleMap)) {
      addCandidate(uid, 'mentioned')
    }
  }

  if (event.actor_id) candidates.delete(event.actor_id)

  const recipients = new Map()
  for (const [userId, rels] of candidates) {
    const matrix = await loadMatrix(userId)
    const kept = []
    for (const rel of rels) if (matrix.isEnabled(rel, event.event_type)) kept.push(rel)
    if (kept.length) recipients.set(userId, kept)
  }
  if (recipients.size === 0) return

  const client = await getClient()
  try {
    await client.query('BEGIN')
    for (const [userId, reasons] of recipients) {
      const summary = renderSummary(event, workItem)
      const ins = await client.query(
        `INSERT INTO runtime.notifications
           (user_id, event_id, work_item_id, event_type, reasons, summary)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, event_id) DO NOTHING
         RETURNING id`,
        [userId, event.id, workItem.id, event.event_type, reasons, summary]
      )
      if (ins.rows.length === 0) continue
      const notificationId = ins.rows[0].id

      const channels = await fetchEnabledOutOfBandChannels(userId)
      for (const ch of channels) {
        await client.query(
          `INSERT INTO runtime.notification_deliveries (notification_id, channel, status)
           VALUES ($1,$2,'pending')`,
          [notificationId, ch]
        )
      }
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export default { notificationsHandler, handlesEventType }
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/notifications-fanout.test.js`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/subscribers/notifications.js tests/notifications-fanout.test.js
git commit -m "notifications: subscriber handler with fanout, dedup, actor suppression"
```

---

## Task 6: Register subscriber with eventProcessor

**Files:**
- Modify: `runtime/eventProcessor.js`

- [ ] **Step 1: Add import and registration**

Add alongside existing subscriber imports near line 17:

```js
import { notificationsHandler, handlesEventType as notifHandles } from './subscribers/notifications.js'
```

At the bottom with existing `registerSubscriber({...})` calls:

```js
registerSubscriber({
  name:    'notifications',
  handles: notifHandles,
  handler: notificationsHandler,
})
```

- [ ] **Step 2: Restart the server and verify subscriber is listed**

Start the server (`npm run dev`), then:

```bash
curl -s http://localhost:3000/admin/api/event-subscribers | head
```
Expected: response includes `"name":"notifications"`.

- [ ] **Step 3: Commit**

```bash
git add runtime/eventProcessor.js
git commit -m "notifications: register subscriber in event processor"
```

---

## Task 7: Webhook channel module

**Files:**
- Create: `runtime/channels/webhook.js`
- Test: `tests/notifications-delivery.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/notifications-delivery.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { signBody, deliverWebhook } from '../runtime/channels/webhook.js'

describe('channels/webhook', () => {
  it('signBody produces stable sha256 HMAC hex', () => {
    const sig1 = signBody('{"a":1}', 'secret')
    const sig2 = signBody('{"a":1}', 'secret')
    assert.equal(sig1, sig2)
    assert.match(sig1, /^sha256=[0-9a-f]{64}$/)
    assert.notEqual(signBody('{"a":2}', 'secret'), sig1)
  })

  it('deliverWebhook POSTs signed body, returns {ok:true} on 2xx', async () => {
    let receivedSig, receivedBody
    const srv = createServer((req, res) => {
      let body = ''
      req.on('data', d => body += d)
      req.on('end', () => {
        receivedSig = req.headers['x-flowos-signature']
        receivedBody = body
        res.writeHead(200); res.end('ok')
      })
    })
    await new Promise(r => srv.listen(0, r))
    const port = srv.address().port
    const res = await deliverWebhook({
      url: `http://127.0.0.1:${port}/hook`,
      secret: 'shh',
      deliveryId: 42,
      body: { hello: 'world' },
      timeoutMs: 2000,
    })
    srv.close()
    assert.equal(res.ok, true)
    assert.equal(res.status, 200)
    assert.equal(receivedSig, signBody(receivedBody, 'shh'))
  })

  it('returns {ok:false, status} on 5xx', async () => {
    const srv = createServer((_req, res) => { res.writeHead(500); res.end('nope') })
    await new Promise(r => srv.listen(0, r))
    const port = srv.address().port
    const res = await deliverWebhook({
      url: `http://127.0.0.1:${port}/`, secret: 's', deliveryId: 1,
      body: {}, timeoutMs: 2000,
    })
    srv.close()
    assert.equal(res.ok, false)
    assert.equal(res.status, 500)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/notifications-delivery.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `runtime/channels/webhook.js`**

```js
/**
 * runtime/channels/webhook.js
 * HTTP POST with HMAC-SHA256 signature. Timeout via AbortController.
 */

import crypto from 'node:crypto'

export function signBody(bodyString, secret) {
  const h = crypto.createHmac('sha256', secret).update(bodyString).digest('hex')
  return `sha256=${h}`
}

export async function deliverWebhook({ url, secret, deliveryId, body, timeoutMs = 10000 }) {
  const bodyString = JSON.stringify(body)
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':          'application/json',
        'X-FlowOS-Signature':    signBody(bodyString, secret),
        'X-FlowOS-Delivery-Id':  String(deliveryId),
      },
      body: bodyString,
    })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    return { ok: false, status: 0, error: e.message || 'request-failed' }
  } finally {
    clearTimeout(t)
  }
}

export default { signBody, deliverWebhook }
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/notifications-delivery.test.js`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/channels/webhook.js tests/notifications-delivery.test.js
git commit -m "notifications: webhook channel with HMAC signing"
```

---

## Task 8: Email channel module

**Files:**
- Create: `runtime/channels/email.js`
- Modify: `package.json` (add `nodemailer`)

- [ ] **Step 1: Install dependency**

Run: `npm install nodemailer`

- [ ] **Step 2: Write `runtime/channels/email.js`**

```js
/**
 * runtime/channels/email.js
 * SMTP via nodemailer. No-op + warning when unconfigured outside production.
 */

import nodemailer from 'nodemailer'

let transport = null
let mode = 'unset'

export function initEmail() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    mode = 'smtp'
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP_HOST/SMTP_USER required in production')
  } else {
    mode = 'noop'
    console.warn('[email] SMTP not configured — deliveries will no-op (dev mode)')
  }
}

export async function deliverEmail({ to, subject, text, html }) {
  if (mode === 'unset') initEmail()
  if (mode === 'noop') return { ok: true, status: 200, noop: true }
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || 'FlowOS <no-reply@flowos.local>',
      to, subject, text, html,
    })
    return { ok: true, status: 200, messageId: info.messageId }
  } catch (e) {
    return { ok: false, status: 0, error: e.message }
  }
}

export function renderRealtimeBody(notification, workItem, baseUrl) {
  const link = `${baseUrl}/admin/work-items/${workItem.id}`
  const subject = `[FlowOS] ${notification.summary}`
  const text = `${notification.summary}\n\n${link}\n`
  const html = `<p>${notification.summary}</p><p><a href="${link}">Open in FlowOS</a></p>`
  return { subject, text, html }
}

export function renderDigestBody(notifications, baseUrl) {
  const subject = `${notifications.length} updates from FlowOS — ${new Date().toDateString()}`
  const lines = notifications.map(n => `• ${n.summary}\n  ${baseUrl}/admin/work-items/${n.work_item_id}`)
  const text = lines.join('\n\n')
  const html = '<ul>' +
    notifications.map(n => `<li>${n.summary} — <a href="${baseUrl}/admin/work-items/${n.work_item_id}">open</a></li>`).join('') +
    '</ul>'
  return { subject, text, html }
}

export default { initEmail, deliverEmail, renderRealtimeBody, renderDigestBody }
```

- [ ] **Step 3: Add rendering tests**

Append to `tests/notifications-delivery.test.js`:

```js
import { renderRealtimeBody, renderDigestBody } from '../runtime/channels/email.js'

describe('channels/email — rendering', () => {
  it('realtime body contains the summary and work item link', () => {
    const { subject, text, html } = renderRealtimeBody(
      { summary: 'BUG.1 moved to Done' },
      { id: 1 },
      'http://flowos.local',
    )
    assert.match(subject, /BUG\.1/)
    assert.match(text,    /\/admin\/work-items\/1/)
    assert.match(html,    /href="http:\/\/flowos\.local\/admin\/work-items\/1"/)
  })

  it('digest body groups multiple items', () => {
    const { subject, text } = renderDigestBody(
      [{ summary: 'one', work_item_id: 1 }, { summary: 'two', work_item_id: 2 }],
      'http://flowos.local',
    )
    assert.match(subject, /2 updates/)
    assert.match(text, /one/)
    assert.match(text, /two/)
  })
})
```

Run: `node --test tests/notifications-delivery.test.js`
Expected: 5 passing.

- [ ] **Step 4: Commit**

```bash
git add runtime/channels/email.js tests/notifications-delivery.test.js package.json package-lock.json
git commit -m "notifications: email channel with realtime + digest rendering"
```

---

## Task 9: Agent channel module

**Files:**
- Create: `runtime/channels/agent.js`

- [ ] **Step 1: Write failing test**

Append to `tests/notifications-delivery.test.js`:

```js
import { buildAgentEnvelope } from '../runtime/channels/agent.js'

describe('channels/agent — envelope', () => {
  it('wraps notification in prompt envelope using channel config', () => {
    const env = buildAgentEnvelope(
      {
        system_prompt: 'You are FlowOS Assistant',
        context_template: 'Notification for {{ work_item.display_key }}: {{ summary }}',
      },
      {
        summary: 'BUG.1 moved to Done',
        work_item: { display_key: 'BUG.1' },
      },
    )
    assert.equal(env.system_prompt, 'You are FlowOS Assistant')
    assert.match(env.instruction, /BUG\.1/)
    assert.match(env.instruction, /moved to Done/)
    assert.ok(env.context)
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `node --test tests/notifications-delivery.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `runtime/channels/agent.js`**

```js
/**
 * runtime/channels/agent.js
 * Wraps notifications in a prompt envelope and delivers via the same
 * HTTP + HMAC path as webhook. Config shape:
 *   { url, secret, system_prompt, context_template, tool_use_mode?, model?, response_handling? }
 */

import { deliverWebhook } from './webhook.js'

function render(template, vars) {
  return (template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => {
    return path.split('.').reduce((o, k) => (o == null ? '' : o[k]), vars) ?? ''
  })
}

export function buildAgentEnvelope(config, notificationPayload) {
  return {
    system_prompt: config.system_prompt,
    context:       { notification: notificationPayload },
    instruction:   render(config.context_template, notificationPayload),
  }
}

export async function deliverAgent({ config, deliveryId, notificationPayload, timeoutMs }) {
  const body = buildAgentEnvelope(config, notificationPayload)
  return deliverWebhook({
    url: config.url,
    secret: config.secret,
    deliveryId,
    body,
    timeoutMs,
  })
}

export default { buildAgentEnvelope, deliverAgent }
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/notifications-delivery.test.js`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/channels/agent.js tests/notifications-delivery.test.js
git commit -m "notifications: agent channel with prompt envelope"
```

---

## Task 10: Rate limiter module

**Files:**
- Create: `runtime/rateLimiter.js`
- Test: `tests/notifications-ratelimit.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HostRateLimiter, Semaphore } from '../runtime/rateLimiter.js'

describe('rateLimiter — per-host sliding window', () => {
  it('allows up to cap in one window, then denies', () => {
    const rl = new HostRateLimiter({ windowMs: 1000, cap: 3 })
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('a.com'), false)
  })
  it('tracks per-host independently', () => {
    const rl = new HostRateLimiter({ windowMs: 1000, cap: 1 })
    assert.equal(rl.allow('a.com'), true)
    assert.equal(rl.allow('b.com'), true)
    assert.equal(rl.allow('a.com'), false)
  })
  it('evicts after window elapses', async () => {
    const rl = new HostRateLimiter({ windowMs: 50, cap: 1 })
    rl.allow('a.com')
    await new Promise(r => setTimeout(r, 80))
    assert.equal(rl.allow('a.com'), true)
  })
})

describe('rateLimiter — semaphore', () => {
  it('limits concurrency', async () => {
    const sem = new Semaphore(2)
    let active = 0, peak = 0
    async function work() {
      await sem.acquire()
      active++; peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 20))
      active--
      sem.release()
    }
    await Promise.all([work(), work(), work(), work(), work()])
    assert.equal(peak, 2)
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `node --test tests/notifications-ratelimit.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `runtime/rateLimiter.js`**

```js
/**
 * runtime/rateLimiter.js
 * Two primitives used by the delivery worker:
 *   - HostRateLimiter: in-memory sliding window keyed by host
 *   - Semaphore: bounded concurrency
 */

export class HostRateLimiter {
  constructor({ windowMs, cap }) {
    this.windowMs = windowMs
    this.cap = cap
    this.buckets = new Map()
  }
  allow(host) {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const bucket = this.buckets.get(host) ?? []
    const kept = bucket.filter(t => t > cutoff)
    if (kept.length >= this.cap) {
      this.buckets.set(host, kept)
      return false
    }
    kept.push(now)
    this.buckets.set(host, kept)
    return true
  }
}

export class Semaphore {
  constructor(n) {
    this.capacity = n
    this.available = n
    this.waiters = []
  }
  acquire() {
    if (this.available > 0) {
      this.available--
      return Promise.resolve()
    }
    return new Promise(resolve => this.waiters.push(resolve))
  }
  release() {
    const w = this.waiters.shift()
    if (w) w()
    else this.available++
  }
}

/**
 * Per-(user, channel) send rate — computed from the deliveries table itself.
 * Returns { allowed:boolean, retryAfterMs?:number }.
 */
export async function checkUserChannelRate({ query, userId, channel, perMinute, perHour }) {
  const { rows } = await query(`
    SELECT
      count(*) FILTER (WHERE d.sent_at > now() - interval '1 minute') AS last_min,
      count(*) FILTER (WHERE d.sent_at > now() - interval '1 hour')   AS last_hour
    FROM runtime.notification_deliveries d
    JOIN runtime.notifications n ON n.id = d.notification_id
    WHERE n.user_id = $1 AND d.channel = $2
  `, [userId, channel])
  const { last_min, last_hour } = rows[0]
  if (Number(last_min)  >= perMinute) return { allowed: false, retryAfterMs: 60_000 }
  if (Number(last_hour) >= perHour)   return { allowed: false, retryAfterMs: 60 * 60_000 }
  return { allowed: true }
}

export default { HostRateLimiter, Semaphore, checkUserChannelRate }
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/notifications-ratelimit.test.js`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/rateLimiter.js tests/notifications-ratelimit.test.js
git commit -m "notifications: rate limiter primitives"
```

---

## Task 11: Ownership challenge module

**Files:**
- Create: `runtime/notifications/ownershipChallenge.js`
- Test: `tests/notifications-ownership-challenge.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { runChallenge } from '../runtime/notifications/ownershipChallenge.js'

function withServer(handler, fn) {
  return new Promise(async resolve => {
    const srv = createServer(handler)
    srv.listen(0, async () => {
      const port = srv.address().port
      const result = await fn(`http://127.0.0.1:${port}/hook`)
      srv.close(() => resolve(result))
    })
  })
}

describe('ownershipChallenge', () => {
  it('passes when endpoint echoes the token', async () => {
    const out = await withServer((req, res) => {
      let body = ''
      req.on('data', d => body += d); req.on('end', () => {
        const { token } = JSON.parse(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ token }))
      })
    }, url => runChallenge({ url, timeoutMs: 1000 }))
    assert.equal(out.ok, true)
  })

  it('fails when endpoint echoes wrong token', async () => {
    const out = await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: 'WRONG' }))
    }, url => runChallenge({ url, timeoutMs: 1000 }))
    assert.equal(out.ok, false)
    assert.match(out.reason, /token/i)
  })

  it('fails on non-2xx', async () => {
    const out = await withServer((_req, res) => { res.writeHead(500); res.end() },
      url => runChallenge({ url, timeoutMs: 1000 }))
    assert.equal(out.ok, false)
  })

  it('fails on timeout', async () => {
    const out = await withServer((_req, _res) => {},
      url => runChallenge({ url, timeoutMs: 100 }))
    assert.equal(out.ok, false)
    assert.match(out.reason, /timeout|abort/i)
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `node --test tests/notifications-ownership-challenge.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `runtime/notifications/ownershipChallenge.js`**

```js
/**
 * runtime/notifications/ownershipChallenge.js
 * POSTs { type:'flowos.verify', token } to a URL and verifies the response
 * JSON body echoes the same token. Used to gate webhook / agent channel
 * activation against the amplifier attack.
 */

import crypto from 'node:crypto'

export function generateToken() {
  return crypto.randomBytes(24).toString('hex')
}

export async function runChallenge({ url, timeoutMs = 10000, token = generateToken() }) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'flowos.verify', token }),
    })
    if (!res.ok) return { ok: false, reason: `status=${res.status}` }
    const body = await res.json().catch(() => ({}))
    if (body?.token !== token) return { ok: false, reason: 'token-mismatch' }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : (e.message || 'error') }
  } finally {
    clearTimeout(t)
  }
}

export default { generateToken, runChallenge }
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/notifications-ownership-challenge.test.js`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add runtime/notifications/ownershipChallenge.js tests/notifications-ownership-challenge.test.js
git commit -m "notifications: webhook ownership challenge"
```

---

## Task 12: Delivery worker core

**Files:**
- Create: `runtime/deliveryWorker.js`

- [ ] **Step 1: Implement the worker**

```js
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
```

- [ ] **Step 2: Add a backoff constants test**

Append to `tests/notifications-delivery.test.js`:

```js
import { __testables as workerInternals } from '../runtime/deliveryWorker.js'

describe('deliveryWorker — backoff constants', () => {
  it('BACKOFF_MS has 5 entries escalating monotonically', () => {
    const b = workerInternals.BACKOFF_MS
    assert.equal(b.length, 5)
    for (let i = 1; i < b.length; i++) assert.ok(b[i] > b[i - 1])
  })
  it('MAX_ATTEMPTS equals BACKOFF_MS length', () => {
    assert.equal(workerInternals.MAX_ATTEMPTS, workerInternals.BACKOFF_MS.length)
  })
})
```

Run: `node --test tests/notifications-delivery.test.js`
Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add runtime/deliveryWorker.js tests/notifications-delivery.test.js
git commit -m "notifications: delivery worker with retry, rate limits, concurrency"
```

---

## Task 13: Digest tick loop

**Files:**
- Modify: `runtime/deliveryWorker.js`

- [ ] **Step 1: Add digest-tick logic**

Append near the bottom of `runtime/deliveryWorker.js`:

```js
let digestTimer = null

export async function startDigestTick() {
  if (digestTimer) return
  digestTimer = setInterval(runDigestTick, 60_000)
}

export async function stopDigestTick() {
  if (digestTimer) { clearInterval(digestTimer); digestTimer = null }
}

async function runDigestTick() {
  try {
    const { rows: users } = await query(`
      SELECT user_id, config
      FROM blueprint.user_notification_channels
      WHERE channel = 'email' AND is_enabled = true
        AND digest IN ('hourly','daily')
        AND (next_digest_at IS NULL OR next_digest_at <= now())
    `)
    for (const u of users) await flushDigestForUser(u)
  } catch (e) {
    console.error('[deliveryWorker] digest tick failed:', e)
  }
}

async function flushDigestForUser(u) {
  const c = await getClient()
  try {
    await c.query('BEGIN')
    const { rows: pending } = await c.query(`
      SELECT d.id, n.summary, n.work_item_id
      FROM runtime.notification_deliveries d
      JOIN runtime.notifications n ON n.id = d.notification_id
      WHERE d.status = 'pending' AND d.channel = 'email' AND n.user_id = $1
      FOR UPDATE SKIP LOCKED
    `, [u.user_id])
    if (!pending.length) {
      await bumpNextDigest(c, u); await c.query('COMMIT'); return
    }
    const { renderDigestBody } = await import('./channels/email.js')
    const { subject, text, html } = renderDigestBody(pending, process.env.PUBLIC_BASE_URL || '')
    const res = await deliverEmail({ to: u.config.email_to, subject, text, html })
    if (res.ok) {
      await c.query(`UPDATE runtime.notification_deliveries SET status='sent', sent_at=now()
                     WHERE id = ANY($1)`, [pending.map(p => p.id)])
    }
    await bumpNextDigest(c, u)
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK'); throw e
  } finally { c.release() }
}

async function bumpNextDigest(c, u) {
  const { rows } = await c.query(
    `SELECT digest FROM blueprint.user_notification_channels WHERE user_id=$1 AND channel='email'`,
    [u.user_id]
  )
  const d = rows[0]?.digest || 'realtime'
  const expr = d === 'hourly' ? `now() + interval '1 hour'`
             : d === 'daily'  ? `now() + interval '1 day'`
             : `NULL`
  await c.query(`UPDATE blueprint.user_notification_channels
                 SET next_digest_at = ${expr}
                 WHERE user_id = $1 AND channel = 'email'`, [u.user_id])
}
```

- [ ] **Step 2: Commit**

```bash
git add runtime/deliveryWorker.js
git commit -m "notifications: digest tick for hourly/daily email"
```

---

## Task 14: Wire worker into server startup

**Files:**
- Modify: `api/server.js`

- [ ] **Step 1: Add startup wiring**

Add near where the event processor is started:

```js
import { startDeliveryWorker, startDigestTick, stopDeliveryWorker, stopDigestTick } from '../runtime/deliveryWorker.js'
import { initEmail } from '../runtime/channels/email.js'

initEmail()
await startDeliveryWorker()
await startDigestTick()

process.on('SIGTERM', async () => { await stopDeliveryWorker(); await stopDigestTick() })
process.on('SIGINT',  async () => { await stopDeliveryWorker(); await stopDigestTick() })
```

- [ ] **Step 2: Restart server, verify worker holds the advisory lock**

Restart server, then:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pg_locks WHERE locktype='advisory' AND objid=252727380"
```
Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add api/server.js
git commit -m "notifications: start delivery worker + digest tick on boot"
```

---

## Task 15: API — GET /notifications

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 1: Add endpoint**

Near other authenticated GET endpoints in `admin/api.js`:

```js
router.get('/notifications', requireAuth, async (req, res) => {
  const userId     = req.user.id
  const cursor     = req.query.cursor ? Number(req.query.cursor) : null
  const unreadOnly = req.query.unread_only === 'true'
  const limit      = Math.min(Number(req.query.limit) || 50, 200)

  const params = [userId]
  let where = 'WHERE user_id = $1'
  if (cursor)     { params.push(cursor); where += ` AND id < $${params.length}` }
  if (unreadOnly) { where += ' AND read_at IS NULL' }
  params.push(limit)

  const { rows } = await query(`
    SELECT id, event_id, work_item_id, event_type, reasons, summary, read_at, created_at
    FROM runtime.notifications
    ${where}
    ORDER BY id DESC
    LIMIT $${params.length}
  `, params)

  const next_cursor = rows.length === limit ? rows[rows.length - 1].id : null

  const { rows: counts } = await query(
    `SELECT COUNT(*)::int AS n FROM runtime.notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  )
  res.json({ rows, next_cursor, unread_count: counts[0].n })
})
```

- [ ] **Step 2: Manual smoke test**

```bash
curl -s -b cookies.txt 'http://localhost:3000/admin/api/notifications?limit=5' | head
```
Expected: JSON with `rows`, `next_cursor`, `unread_count`.

- [ ] **Step 3: Commit**

```bash
git add admin/api.js
git commit -m "notifications: GET /notifications inbox endpoint"
```

---

## Task 16: API — PATCH /notifications/:id/read + POST /mark-read

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 1: Add endpoints**

```js
router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  const { rowCount } = await query(
    `UPDATE runtime.notifications SET read_at = now()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [req.params.id, req.user.id]
  )
  res.json({ updated: rowCount })
})

router.post('/notifications/mark-read', requireAuth, async (req, res) => {
  const { ids, work_item_id, event_type, older_than } = req.body || {}
  const params = [req.user.id]
  const conds = ['user_id = $1', 'read_at IS NULL']
  if (Array.isArray(ids) && ids.length) {
    params.push(ids); conds.push(`id = ANY($${params.length})`)
  }
  if (work_item_id) {
    params.push(work_item_id); conds.push(`work_item_id = $${params.length}`)
  }
  if (event_type) {
    params.push(event_type); conds.push(`event_type = $${params.length}`)
  }
  if (older_than) {
    params.push(older_than); conds.push(`created_at < $${params.length}`)
  }
  const { rowCount } = await query(
    `UPDATE runtime.notifications SET read_at = now() WHERE ${conds.join(' AND ')}`,
    params,
  )
  res.json({ updated: rowCount })
})
```

- [ ] **Step 2: Commit**

```bash
git add admin/api.js
git commit -m "notifications: mark-read endpoints (single + filtered bulk)"
```

---

## Task 17: API — GET/PUT /notification-preferences

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 1: Add endpoints**

```js
router.get('/notification-preferences', requireAuth, async (req, res) => {
  const uid = req.user.id
  const [defaults, overrides, channels] = await Promise.all([
    query('SELECT * FROM blueprint.notification_defaults'),
    query('SELECT * FROM blueprint.user_notification_overrides WHERE user_id = $1', [uid]),
    query('SELECT channel, is_enabled, digest, next_digest_at, config FROM blueprint.user_notification_channels WHERE user_id = $1', [uid]),
  ])
  res.json({
    defaults: defaults.rows,
    overrides: overrides.rows,
    channels:  channels.rows,
  })
})

router.put('/notification-preferences', requireAuth, async (req, res) => {
  const uid = req.user.id
  const { overrides, channels } = req.body || {}

  const client = await getClient()
  try {
    await client.query('BEGIN')
    if (Array.isArray(overrides)) {
      await client.query('DELETE FROM blueprint.user_notification_overrides WHERE user_id = $1', [uid])
      for (const o of overrides) {
        await client.query(
          `INSERT INTO blueprint.user_notification_overrides (user_id, relationship_type, event_type, enabled)
           VALUES ($1,$2,$3,$4)`,
          [uid, o.relationship_type, o.event_type, !!o.enabled]
        )
      }
    }
    if (Array.isArray(channels)) {
      for (const ch of channels) {
        const { rows: existing } = await client.query(
          `SELECT config FROM blueprint.user_notification_channels WHERE user_id=$1 AND channel=$2`,
          [uid, ch.channel]
        )
        const urlChanged = (ch.channel === 'webhook' || ch.channel === 'agent')
                        && ch.config?.url
                        && ch.config.url !== existing[0]?.config?.url
        const isEnabled = urlChanged ? false : !!ch.is_enabled
        await client.query(
          `INSERT INTO blueprint.user_notification_channels
             (user_id, channel, is_enabled, digest, config)
           VALUES ($1,$2,$3,$4,$5::jsonb)
           ON CONFLICT (user_id, channel) DO UPDATE
           SET is_enabled = EXCLUDED.is_enabled,
               digest     = EXCLUDED.digest,
               config     = EXCLUDED.config`,
          [uid, ch.channel, isEnabled, ch.digest || 'realtime', JSON.stringify(ch.config || {})]
        )
        if (urlChanged) {
          const { runChallenge } = await import('../runtime/notifications/ownershipChallenge.js')
          ;(async () => {
            const result = await runChallenge({ url: ch.config.url })
            if (result.ok) {
              await query(`UPDATE blueprint.user_notification_channels
                           SET is_enabled = true WHERE user_id=$1 AND channel=$2`, [uid, ch.channel])
            }
          })().catch(e => console.error('[challenge]', e))
        }
      }
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally { client.release() }
})
```

- [ ] **Step 2: Commit**

```bash
git add admin/api.js
git commit -m "notifications: preferences endpoints with ownership challenge on URL change"
```

---

## Task 18: API — admin delivery endpoints

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 1: Add admin-only endpoints**

```js
router.get('/notification-deliveries', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin-only' })
  const status = req.query.status || 'failed'
  const { rows } = await query(
    `SELECT d.*, n.user_id, n.summary
     FROM runtime.notification_deliveries d
     JOIN runtime.notifications n ON n.id = d.notification_id
     WHERE d.status = $1
     ORDER BY d.id DESC LIMIT 200`,
    [status]
  )
  res.json({ rows })
})

router.post('/notification-deliveries/:id/retry', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin-only' })
  const { rowCount } = await query(
    `UPDATE runtime.notification_deliveries
     SET status='pending', attempt_count=0, next_attempt_at=now(), last_error=NULL
     WHERE id=$1`,
    [req.params.id]
  )
  res.json({ updated: rowCount })
})
```

- [ ] **Step 2: Commit**

```bash
git add admin/api.js
git commit -m "notifications: admin delivery inspect + retry endpoints"
```

---

## Task 19: Retention job

**Files:**
- Create: `runtime/jobs/notificationRetention.js`
- Modify: `api/server.js`

- [ ] **Step 1: Implement**

```js
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
```

- [ ] **Step 2: Wire into server startup**

In `api/server.js` next to other worker starts:

```js
import { startRetentionJob, stopRetentionJob } from '../runtime/jobs/notificationRetention.js'
await startRetentionJob()
// mirror stop in SIGTERM/SIGINT handlers
```

- [ ] **Step 3: Commit**

```bash
git add runtime/jobs/notificationRetention.js api/server.js
git commit -m "notifications: 90-day retention job for read rows"
```

---

## Task 20: Admin UI — API client additions

**Files:**
- Modify: `admin-ui/src/lib/api.js`

- [ ] **Step 1: Add client methods**

```js
export const notificationsApi = {
  list: ({ cursor, unread_only, limit } = {}) => {
    const qs = new URLSearchParams()
    if (cursor)      qs.set('cursor', cursor)
    if (unread_only) qs.set('unread_only', unread_only)
    if (limit)       qs.set('limit', limit)
    return apiFetch(`/notifications?${qs.toString()}`)
  },
  markRead: (id) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
  markReadBulk: (filter) => apiFetch(`/notifications/mark-read`, { method: 'POST', body: JSON.stringify(filter) }),
  getPrefs: () => apiFetch('/notification-preferences'),
  putPrefs: (body) => apiFetch('/notification-preferences', { method: 'PUT', body: JSON.stringify(body) }),
  listFailedDeliveries: () => apiFetch('/notification-deliveries?status=failed'),
  retryDelivery: (id) => apiFetch(`/notification-deliveries/${id}/retry`, { method: 'POST' }),
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-ui/src/lib/api.js
git commit -m "notifications: admin-ui API client methods"
```

---

## Task 21: Admin UI — Bell icon + unread badge

**Files:**
- Create: `admin-ui/src/components/NotificationsBell.jsx`
- Modify: `admin-ui/src/components/Sidebar.jsx`

- [ ] **Step 1: Implement bell**

```jsx
import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { notificationsApi } from '../lib/api'

export default function NotificationsBell({ onClick }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const { unread_count } = await notificationsApi.list({ limit: 1 })
        if (alive) setCount(unread_count || 0)
      } catch {}
    }
    poll()
    const t = setInterval(poll, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return (
    <button onClick={onClick}
      className="relative p-2 rounded hover:bg-black/[0.03] text-xs"
      aria-label="Notifications">
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1
                         rounded-full bg-[hsl(var(--destructive))] text-white text-[10px]
                         flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Mount in Sidebar**

In `Sidebar.jsx`, add drawer open state + mount:

```jsx
import NotificationsBell from './NotificationsBell'
import NotificationsDrawer from './NotificationsDrawer'

// Inside the component:
const [drawerOpen, setDrawerOpen] = useState(false)

// In the sidebar header area:
<NotificationsBell onClick={() => setDrawerOpen(true)} />
<NotificationsDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
```

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/components/NotificationsBell.jsx admin-ui/src/components/Sidebar.jsx
git commit -m "notifications: sidebar bell with unread count poller"
```

---

## Task 22: Admin UI — NotificationsDrawer

**Files:**
- Create: `admin-ui/src/components/NotificationsDrawer.jsx`

- [ ] **Step 1: Implement drawer**

```jsx
import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Button } from './ui/button'
import { notificationsApi } from '../lib/api'
import { useNavigate } from 'react-router-dom'

function groupByDay(rows) {
  const today = new Date(); today.setHours(0,0,0,0)
  const yday  = new Date(today); yday.setDate(today.getDate() - 1)
  const g = { Today: [], Yesterday: [], Earlier: [] }
  for (const r of rows) {
    const d = new Date(r.created_at)
    if (d >= today) g.Today.push(r)
    else if (d >= yday) g.Yesterday.push(r)
    else g.Earlier.push(r)
  }
  return g
}

export default function NotificationsDrawer({ open, onOpenChange }) {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('unread')
  const nav = useNavigate()

  async function load() {
    const res = await notificationsApi.list({ unread_only: filter === 'unread' ? 'true' : undefined, limit: 50 })
    setRows(res.rows || [])
  }
  useEffect(() => { if (open) load() }, [open, filter])

  async function markAll() {
    await notificationsApi.markReadBulk({})
    load()
  }
  async function openItem(row) {
    await notificationsApi.markRead(row.id)
    onOpenChange(false)
    nav(`/admin/work-items/${row.work_item_id}`)
  }

  const groups = groupByDay(rows)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} overlay={false}>
      <SheetContent side="right" className="w-[420px]">
        <SheetHeader className="flex flex-row items-center justify-between">
          <SheetTitle className="text-sm">Notifications</SheetTitle>
          <Button onClick={markAll} variant="ghost" className="text-xs">Mark all read</Button>
        </SheetHeader>

        <div className="flex gap-2 mt-3 text-xs">
          {['unread','all'].map(k => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-2 py-1 rounded ${filter===k?'bg-black/[0.05]':'hover:bg-black/[0.03]'}`}>
              {k === 'unread' ? 'Unread' : 'All'}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto">
          {Object.entries(groups).map(([label, items]) => items.length === 0 ? null : (
            <section key={label}>
              <div className="text-xs uppercase tracking-wide font-medium text-muted-foreground mb-1">{label}</div>
              {items.map(row => (
                <button key={row.id} onClick={() => openItem(row)}
                  className={`w-full text-left px-2 py-2 rounded hover:bg-black/[0.03]
                              ${!row.read_at ? 'font-medium border-l-2 border-[hsl(var(--primary))]' : ''}`}>
                  <div className="text-sm">{row.summary}</div>
                  <div className="text-xs text-muted-foreground flex gap-1 mt-0.5">
                    {row.reasons.map(r => <span key={r} className="px-1 bg-black/[0.04] rounded">{r}</span>)}
                    <span className="ml-auto">{new Date(row.created_at).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </section>
          ))}
          {rows.length === 0 && (
            <div className="text-xs text-muted-foreground">Nothing here.</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-ui/src/components/NotificationsDrawer.jsx
git commit -m "notifications: drawer with filter, grouping, mark-read on open"
```

---

## Task 23: Admin UI — Card dots on the board

**Files:**
- Modify: `admin/api.js` (board endpoint)
- Modify: `admin-ui/src/components/WorkItemCard.jsx`
- Modify: `admin-ui/src/components/WorkItemDetail.jsx`

- [ ] **Step 1: Extend board query with per-card unread count**

In the existing board SQL in `admin/api.js`, add to the SELECT list (the query
already threads the current user id through a LATERAL join; thread it again):

```sql
, COALESCE((SELECT COUNT(*) FROM runtime.notifications n
            WHERE n.user_id = $<current_user_param_idx>
              AND n.work_item_id = wi.id AND n.read_at IS NULL), 0)
   AS unread_count
```

- [ ] **Step 2: Render a dot on `WorkItemCard` when unread_count > 0**

In `WorkItemCard.jsx`, inside the card root element:

```jsx
{unread_count > 0 && (
  <span title={`${unread_count} new since you last opened this`}
        className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[hsl(var(--primary))]" />
)}
```

- [ ] **Step 3: Mark-read on detail drawer open**

In `WorkItemDetail.jsx`, when the drawer opens for id X:

```jsx
useEffect(() => {
  if (open && workItemId) {
    notificationsApi.markReadBulk({ work_item_id: workItemId }).catch(() => {})
  }
}, [open, workItemId])
```

- [ ] **Step 4: Commit**

```bash
git add admin/api.js admin-ui/src/components/WorkItemCard.jsx admin-ui/src/components/WorkItemDetail.jsx
git commit -m "notifications: card dots on board + auto-mark-read on open"
```

---

## Task 24: Admin UI — Settings page

**Files:**
- Create: `admin-ui/src/pages/SettingsNotifications.jsx`
- Modify: `admin-ui/src/App.jsx`
- Modify: `admin-ui/src/components/Sidebar.jsx`

- [ ] **Step 1: Implement settings page**

```jsx
import { useEffect, useState } from 'react'
import { notificationsApi } from '../lib/api'

export default function SettingsNotifications() {
  const [prefs, setPrefs] = useState(null)
  async function load() { setPrefs(await notificationsApi.getPrefs()) }
  useEffect(() => { load() }, [])

  if (!prefs) return <div className="p-4 text-xs">Loading…</div>

  const channels = ['in_app','email','webhook','agent'].map(
    c => prefs.channels.find(x => x.channel === c) || { channel: c, is_enabled: false, digest: 'realtime', config: {} }
  )

  async function saveChannel(channel, patch) {
    const merged = { ...channels.find(c => c.channel === channel), ...patch }
    await notificationsApi.putPrefs({ channels: [merged] })
    load()
  }

  async function toggleMatrix(rel, type, enabled) {
    const existing = prefs.overrides.filter(o => !(o.relationship_type === rel && o.event_type === type))
    const defaultEnabled = prefs.defaults.find(d => d.relationship_type === rel && d.event_type === type)?.enabled
    const next = enabled === defaultEnabled
      ? existing
      : [...existing, { relationship_type: rel, event_type: type, enabled }]
    await notificationsApi.putPrefs({ overrides: next })
    load()
  }

  const relationships = ['owns','working_on','reviewing','watching','requester','mentioned']
  const eventTypes = [...new Set(prefs.defaults.map(d => d.event_type))].sort()

  return (
    <div className="p-6 max-w-4xl space-y-6 text-sm">
      <h1 className="text-sm font-medium">Notification Settings</h1>

      <section>
        <h2 className="text-xs uppercase tracking-wide font-medium mb-2">Channels</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {channels.map(ch => (
            <div key={ch.channel} className="p-3 rounded border border-black/10 bg-white/50">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase">{ch.channel.replace('_',' ')}</div>
                <input type="checkbox" checked={!!ch.is_enabled}
                       onChange={e => saveChannel(ch.channel, { is_enabled: e.target.checked })} />
              </div>
              {ch.channel === 'email' && (
                <input className="mt-2 w-full text-xs border rounded px-1 py-0.5"
                  placeholder="email@example.com"
                  defaultValue={ch.config.email_to || ''}
                  onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, email_to: e.target.value } })}/>
              )}
              {(ch.channel === 'webhook' || ch.channel === 'agent') && (
                <>
                  <input className="mt-2 w-full text-xs border rounded px-1 py-0.5"
                    placeholder="https://..."
                    defaultValue={ch.config.url || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, url: e.target.value } })}/>
                  <input className="mt-1 w-full text-xs border rounded px-1 py-0.5"
                    placeholder="signing secret" type="password"
                    defaultValue={ch.config.secret || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, secret: e.target.value } })}/>
                  {!ch.is_enabled && ch.config.url && (
                    <div className="text-xs mt-1 text-[hsl(var(--destructive))]">Awaiting ownership verification.</div>
                  )}
                </>
              )}
              {ch.channel === 'agent' && (
                <>
                  <textarea className="mt-1 w-full text-xs border rounded px-1 py-0.5"
                    placeholder="System prompt"
                    defaultValue={ch.config.system_prompt || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, system_prompt: e.target.value } })}/>
                  <textarea className="mt-1 w-full text-xs border rounded px-1 py-0.5"
                    placeholder="Context template ({{ work_item.display_key }} etc.)"
                    defaultValue={ch.config.context_template || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, context_template: e.target.value } })}/>
                </>
              )}
              <div className="mt-2 text-xs flex gap-2 items-center">
                Digest:
                <select value={ch.digest} disabled={ch.channel === 'in_app'}
                        onChange={e => saveChannel(ch.channel, { digest: e.target.value })}>
                  <option value="realtime">realtime</option>
                  <option value="hourly">hourly</option>
                  <option value="daily">daily</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wide font-medium mb-2">When should I be notified?</h2>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr><th className="text-left pr-3">Event</th>
                {relationships.map(r => <th key={r} className="px-2 text-center">{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {eventTypes.map(type => (
                <tr key={type}>
                  <td className="pr-3 py-0.5">{type}</td>
                  {relationships.map(rel => {
                    const def = prefs.defaults.find(d => d.relationship_type === rel && d.event_type === type)
                    const over = prefs.overrides.find(o => o.relationship_type === rel && o.event_type === type)
                    const enabled = over ? over.enabled : def?.enabled ?? false
                    const cellDisabled = !def
                    return (
                      <td key={rel} className="px-2 text-center">
                        <input type="checkbox" checked={enabled} disabled={cellDisabled}
                               onChange={e => toggleMatrix(rel, type, e.target.checked)}/>
                        {over && <span className="text-[9px] ml-0.5" title="Overridden">•</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Add route in App.jsx**

```jsx
import SettingsNotifications from './pages/SettingsNotifications'
// ...
<Route path="/admin/settings/notifications" element={<SettingsNotifications />} />
```

Add a sidebar link "Notifications" under the Admin group.

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/pages/SettingsNotifications.jsx admin-ui/src/App.jsx admin-ui/src/components/Sidebar.jsx
git commit -m "notifications: settings page for channels + matrix + digest"
```

---

## Task 25: End-to-end integration tests

**Files:**
- Create: `tests/notifications-integration.test.js`

- [ ] **Step 1: Write tests (server running, seeded)**

```js
// tests/notifications-integration.test.js
// Requires: `npm run dev` running on port 3000.

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

describe('notifications — end-to-end', () => {
  let workItemId
  before(async () => {
    const { rows } = await query('SELECT id FROM runtime.work_items ORDER BY id ASC LIMIT 1')
    workItemId = rows[0].id
    await query(`DELETE FROM runtime.notifications WHERE user_id = 1`)
  })

  it('comment with @mention creates a notification for mentioned user', async () => {
    const { rows: u } = await query(`SELECT split_part(email,'@',1) AS h FROM blueprint.users WHERE id = 1`)
    const handle = u[0].h
    const body = `Hey @${handle} look at this`
    await api(`/work-items/${workItemId}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
    await new Promise(r => setTimeout(r, 1500))
    const { data } = await api('/notifications?limit=5')
    const mentioned = data.rows.find(r => r.reasons.includes('mentioned'))
    assert.ok(mentioned, 'should have a mentioned-reason notification')
  })

  it('PATCH /:id/read marks a single row read', async () => {
    const { data } = await api('/notifications?unread_only=true&limit=1')
    if (!data.rows.length) return
    const id = data.rows[0].id
    const res = await api(`/notifications/${id}/read`, { method: 'PATCH' })
    assert.equal(res.status, 200)
    const { data: after } = await api(`/notifications?limit=50`)
    const row = after.rows.find(r => r.id === id)
    assert.ok(row.read_at)
  })

  it('POST /mark-read with filter marks only matching rows', async () => {
    await api('/notifications/mark-read', { method: 'POST', body: JSON.stringify({ work_item_id: workItemId }) })
    const { data } = await api(`/notifications?limit=100`)
    const stillUnreadForItem = data.rows.filter(r => r.work_item_id === workItemId && !r.read_at)
    assert.equal(stillUnreadForItem.length, 0)
  })
})
```

- [ ] **Step 2: Run with server up**

Run: `node --test tests/notifications-integration.test.js`
Expected: 3 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/notifications-integration.test.js
git commit -m "notifications: end-to-end integration tests"
```

---

## Final Verification

- [ ] Full no-server test sweep:
  ```bash
  node --test tests/notifications-fanout.test.js \
               tests/notifications-delivery.test.js \
               tests/notifications-ratelimit.test.js \
               tests/notifications-ownership-challenge.test.js
  ```
  Expected: all green.

- [ ] Full integration sweep (server running):
  ```bash
  node --test tests/events-integration.test.js tests/notifications-integration.test.js
  ```
  Expected: all green.

- [ ] Manual: create a work item, comment with `@someone`, observe the bell badge increment and the row appearing in the drawer within ~1s.

- [ ] Manual: point a webhook at a URL that echoes the verification token, save, observe POSTs with `X-FlowOS-Signature` arriving.

- [ ] Manual: point a webhook at a URL that does NOT echo, save, confirm the channel stays `is_enabled = false`.

- [ ] Update `CLAUDE.md`, `MEMORY.md`, `PRODUCT_PLAN.md` to reflect notifications shipped.
