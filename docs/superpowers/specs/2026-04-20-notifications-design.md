# Notifications — Design Spec

**Status:** Draft
**Authored:** 2026-04-20 (Session 21)
**Depends on:** Event system (Session 20, `runtime.events` + subscriber framework)
**Roadmap slot:** Phase 2, item 5

---

## Goal

Tell users and agents, through the channels they care about, when work they care about
changes state — without drowning anyone in noise. Establish a foundation that supports
humans (bell, email) and agents (webhook, pull) as equal-class subscribers.

Success criteria:

- A user watching a work item reliably sees an in-app notification within 1s of a relevant event.
- A user with email enabled receives realtime or digested emails depending on their pref.
- An agent registered with a webhook URL receives signed POSTs with exponential-backoff retry on failure.
- The default configuration produces meaningful signal (not spam) for a new user with no setup.
- The actor that caused an event never gets notified about their own action.
- Failed webhook/email deliveries are observable and retryable from an admin UI.

## Non-Goals (v1)

- Per-work-item muting (we'll add a hook for it but not ship it).
- Slack / Teams / Discord native channels (use webhooks).
- Per-org or per-type preference layers.
- Smart batching/coalescing beyond digest windows.
- Full-page inbox (drawer only, card dots on the board).
- Localization of summary strings.
- Push notifications to mobile apps (no mobile app exists).
- Cross-instance NOTIFY nudge for deliveries (5s poll is sufficient at our scale).

## Architectural Overview

A new event subscriber, `notifications`, runs inside the existing event processor
alongside `neo4j-sync` and `audit-log`. Nothing about the event system changes.

Per event, the subscriber:

1. Resolves recipients by joining the event to work-item relationships + extracting
   `@mentions` from comment payloads.
2. Applies the role × event-type default matrix plus per-user overrides.
3. Collapses duplicates (one user with multiple reasons → one notification with a
   `reasons` array).
4. Suppresses the actor (never notify the person who caused the event).
5. Writes one row per recipient into `runtime.notifications` and enqueues
   out-of-band deliveries into `runtime.notification_deliveries`.

A second loop, the **delivery worker**, drains the deliveries table for email and
webhook channels with its own PG advisory lock, exponential-backoff retry, and
per-user digest aggregation.

The in-app channel has no worker — `runtime.notifications` is directly queried by
the bell/drawer API.

## Units

- **`runtime/subscribers/notifications.js`** — event handler, fanout, matrix
  evaluation, summary rendering. Single entry point: `handler(event)` returning void,
  throwing on failure so the processor cursor does not advance.
- **`runtime/deliveryWorker.js`** — start/stop lifecycle with advisory lock
  (key `252727380`), poll loop (5s), per-channel dispatch, backoff, digest tick.
- **`runtime/channels/webhook.js`** — POST + HMAC signing + retry semantics.
- **`runtime/channels/email.js`** — SMTP via `nodemailer`, digest templating,
  dev-mode no-op when unconfigured.
- **`runtime/notifications/matrix.js`** — default matrix + override resolution,
  pure functions, trivially unit-testable.
- **`runtime/notifications/summaries.js`** — `event_type → (event, workItem) => string`
  renderer map.
- **`admin-ui/src/components/NotificationsDrawer.jsx`** — right-side Sheet.
- **`admin-ui/src/pages/SettingsNotifications.jsx`** — channels + matrix + digest prefs.
- **`admin/api.js`** gets new endpoints (see API section).

## Data Model

Migration `010_notifications.sql`:

```sql
-- Agent-flag on users.
ALTER TABLE blueprint.users
  ADD COLUMN IF NOT EXISTS is_agent BOOLEAN NOT NULL DEFAULT false;

-- Default matrix (seeded). Structural, not runtime state → blueprint schema.
CREATE TABLE blueprint.notification_defaults (
  relationship_type TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (relationship_type, event_type)
);

-- Per-user channel config. Missing row = channel disabled.
-- Hybrid: stable universal fields are typed columns; channel-specific
-- payload lives in `config` JSONB (validated in the application layer).
CREATE TABLE blueprint.user_notification_channels (
  user_id          INTEGER REFERENCES blueprint.users(id) ON DELETE CASCADE,
  channel          TEXT NOT NULL CHECK (channel IN ('in_app','email','webhook','agent')),
  is_enabled       BOOLEAN NOT NULL DEFAULT true,
  digest           TEXT NOT NULL DEFAULT 'realtime'
                     CHECK (digest IN ('realtime','hourly','daily')),
  next_digest_at   TIMESTAMPTZ,
  config           JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, channel)
);

-- Sparse overrides of the default matrix.
CREATE TABLE blueprint.user_notification_overrides (
  user_id           INTEGER REFERENCES blueprint.users(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, relationship_type, event_type)
);

-- In-app inbox.
CREATE TABLE runtime.notifications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  event_id      BIGINT NOT NULL REFERENCES runtime.events(id) ON DELETE CASCADE,
  work_item_id  INTEGER REFERENCES runtime.work_items(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  reasons       TEXT[] NOT NULL,
  summary       TEXT NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);
CREATE INDEX idx_notifications_user_unread
  ON runtime.notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user_workitem
  ON runtime.notifications (user_id, work_item_id) WHERE read_at IS NULL;

-- Delivery outbox for email + webhook.
CREATE TABLE runtime.notification_deliveries (
  id               BIGSERIAL PRIMARY KEY,
  notification_id  BIGINT NOT NULL REFERENCES runtime.notifications(id) ON DELETE CASCADE,
  channel          TEXT NOT NULL CHECK (channel IN ('email','webhook')),
  status           TEXT NOT NULL CHECK (status IN ('pending','sent','failed')) DEFAULT 'pending',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deliveries_pending
  ON runtime.notification_deliveries (next_attempt_at) WHERE status = 'pending';
```

Rationale notes:

- `reasons TEXT[]` avoids a join table; no user cares about per-reason read state.
- `work_item_id` denormalized so the Board card-dot query doesn't join events.
- `user_notification_channels` uses typed columns for universal fields
  (`is_enabled`, `digest`, `next_digest_at`) and `config` JSONB for
  channel-specific payload:
  - `in_app`: `{}` (no config).
  - `email`: `{ email_to }`.
  - `webhook`: `{ url, secret }`.
  - `agent`: `{ url, secret, system_prompt, context_template, tool_use_mode,
    model, response_handling }` — see the Agent Channel section.
- Channel-specific `config` shape is validated by per-channel validators in
  `runtime/channels/*.js`. Adding agent-specific config fields is a no-migration
  change, which matters because agent collaboration patterns are still evolving.
- Overrides table is sparse — only rows where the user has deviated from default.

### Agent Users

Agents are modeled as regular user rows with `is_agent = true` (new column on
`blueprint.users`, added in migration 010). They authenticate via the existing
API key system (`fos_ak_` prefix). They can be assigned to work-item relationships
(owner, working_on, reviewing, watching), appear in people-pickers with an agent
icon, and receive notifications routed through the exact same matrix as human
users — except their default channel is `agent` (or `webhook` for simple
HTTP-only cases) rather than `in_app`.

## Default Matrix (seeded)

| event_type | owns | working_on | reviewing | watching | requester | mentioned |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| work_item.created | · | · | · | ✓ | · | · |
| work_item.edited | · | · | · | ✓ | · | · |
| work_item.transitioned | ✓ | ✓ | · | ✓ | ✓ | · |
| work_item.substate_changed | ✓ | ✓ | · | ✓ | · | · |
| work_item.assigned | ✓ | ✓ | ✓ | ✓ | · | · |
| work_item.commented | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| work_item.spawned | ✓ | · | · | ✓ | ✓ | · |
| exit_criteria.acknowledged | ✓ | ✓ | ✓ | ✓ | · | · |
| exit_criteria.unacknowledged | ✓ | ✓ | ✓ | ✓ | · | · |
| exit_criteria.waived | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| work_item.linked | ✓ | · | · | ✓ | · | · |

Three parked event types — `work_item.unlinked`, `work_item.comment_edited`,
`work_item.comment_deleted` — get matrix rows when their emission endpoints are built.

## Fanout Algorithm

Inside `runtime/subscribers/notifications.js`:

```
for each event handled:
  recipients = new Map<user_id, { reasons: Set<string>, }>()

  // 1. Relationship-based candidates
  for each row in runtime.work_item_user_relationships
      where work_item_id = event.entity_id:
    candidates.add(user_id, relationship_type)
  candidates.add(work_items.requester_id, 'requester')

  // 2. @mentions for comment events
  if event.event_type == 'work_item.commented':
    for each user_id in parse_mentions(event.payload.body):
      candidates.add(user_id, 'mentioned')

  // 3. Matrix + override evaluation
  for each (user_id, relationship_type) in candidates:
    enabled = override_lookup(user_id, relationship_type, event.event_type)
           ?? default_lookup(relationship_type, event.event_type)
    if enabled:
      recipients.get_or_create(user_id).reasons.add(relationship_type)

  // 4. Actor suppression
  recipients.delete(event.actor_id)

  // 5. (v2 hook: mute-this-item check)

  // 6. Persist
  BEGIN
    for each (user_id, { reasons }) in recipients:
      summary = renderSummary(event, workItem)
      INSERT INTO runtime.notifications
        (user_id, event_id, work_item_id, event_type, reasons, summary)
        ON CONFLICT (user_id, event_id) DO NOTHING
      for each channel in user_enabled_channels(user_id) except 'in_app':
        INSERT INTO runtime.notification_deliveries
          (notification_id, channel, status, next_attempt_at)
  COMMIT
```

## Delivery Worker

`runtime/deliveryWorker.js`:

- Acquires PG advisory lock key `252727380` at startup; polls every 5s.
- `SELECT ... FOR UPDATE SKIP LOCKED LIMIT $BATCH_SIZE` to claim pending
  deliveries whose `next_attempt_at <= now()`.
- Dispatches via the channel module for the row's `channel`, running up to
  `$CONCURRENCY` dispatches in parallel via a small semaphore so one slow
  endpoint doesn't stall the whole batch.
- On 2xx/success: `status='sent'`, `sent_at=now()`.
- On failure: increment `attempt_count`, set `last_error`. If `attempt_count >= 5`,
  mark `status='failed'`; else reschedule with backoff
  `[1m, 5m, 30m, 2h, 12h][attempt_count - 1]`.
- Before dispatching, consults the rate limiter (see "Rate Limiting" below).
  A rate-limited delivery is rescheduled, not failed.
- Separate digest-tick loop (every minute) marks per-user pending email rows ready
  for flush when their `next_digest_at` elapses.

Configurable via env:

- `DELIVERY_WORKER_BATCH_SIZE` (default `50`)
- `DELIVERY_WORKER_CONCURRENCY` (default `10`)
- `DELIVERY_WORKER_POLL_INTERVAL_MS` (default `5000`)

## Rate Limiting

Three layers, all applied by the delivery worker before a dispatch call. Any
breach reschedules the delivery to the next window start — never drops.

### 1. Per-(user, channel) send rate

Computed from `runtime.notification_deliveries` itself:

```sql
SELECT count(*)
  FROM runtime.notification_deliveries d
  JOIN runtime.notifications n ON n.id = d.notification_id
  WHERE n.user_id = $1
    AND d.channel = $2
    AND d.sent_at > now() - interval '1 minute';
```

Defaults (env-configurable): `RATE_LIMIT_PER_USER_PER_MIN = 60`,
`RATE_LIMIT_PER_USER_PER_HOUR = 600`. Both are checked. Breach pushes
`next_attempt_at` to the start of the next window.

Applies to `email`, `webhook`, and `agent` channels. `in_app` is exempt (no
outbound traffic; writes to the notifications table are already bounded by the
event system's own pace).

### 2. Per-destination-host cap (webhook + agent)

Prevents FlowOS from amplifying traffic toward a single external host when
multiple users (or one malicious user) configure URLs pointing at the same
endpoint. An in-memory sliding window in the delivery worker keyed on
`new URL(config.url).hostname`:

- Default cap: `RATE_LIMIT_PER_HOST_PER_MIN = 30`.
- Implementation: `Map<hostname, ring_buffer_of_timestamps>`, eviction on write.
- Breach reschedules the delivery by `60s` (soft penalty, just stalls until the
  window drains).
- In-memory is fine for this — the cap is advisory and losing state on restart
  simply means a brief burst capacity, which is safer than stricter cross-instance
  coordination we don't need.

### 3. Global worker concurrency

The `DELIVERY_WORKER_CONCURRENCY` semaphore above is itself a rate limiter:
no more than N in-flight deliveries at once across the entire worker. Prevents
a single pathological endpoint (10s timeout × batch of 50) from starving
everything else.

## Webhook Ownership Challenge (v1)

When a user saves a new webhook or agent channel config, FlowOS verifies the
URL is one they control before activating the channel:

1. User submits `url` + `secret` via `PUT /notification-preferences`. Row is
   saved with `is_enabled = false` and a generated `verification_token` stored
   in `config.verification_token`.
2. FlowOS `POST`s `{ type: 'flowos.verify', token: '<random>' }` to the URL.
   The endpoint must respond with `200` and a JSON body `{ token: '<same>' }`
   within 10s.
3. On success: `is_enabled = true`, `verification_token` cleared, channel live.
   On failure: row stays disabled, the UI surfaces "verification failed" with
   a retry button.

The same challenge runs any time `url` changes. Token is single-use.

This is the primary defense against the amplifier case: a user cannot turn
FlowOS into a traffic generator against a victim server, because the victim
server won't echo the verification token.

### Webhook Channel

- `POST user_notification_channels.config.webhook_url`
- Body: `{ notification_id, event_id, event_type, work_item: {...denormalized...},
  reasons, summary, occurred_at }`
- Headers:
  - `Content-Type: application/json`
  - `X-FlowOS-Signature: sha256=<hex HMAC of body with webhook_secret>`
  - `X-FlowOS-Delivery-Id: <notification_deliveries.id>` (idempotency key for agents)
- 10s request timeout. 2xx = success.

### Agent Channel (v1: same-as-webhook)

Reserved channel name for AI agents. In v1, the `agent` channel is delivered
identically to `webhook` (HTTP POST with HMAC signature) — only the
`user_notification_channels.config` shape differs. The payload is wrapped in a
minimal prompt envelope:

```json
{
  "system_prompt": "<from config>",
  "context": { "notification": {...}, "work_item": {...} },
  "instruction": "<rendered from config.context_template>"
}
```

In v1 the agent channel does not process responses, fetch richer context beyond
the work item, or enforce tool-use policies. Those behaviors are scoped for the
Agent Collaboration design (see "Future" section). The namespace is reserved
now so that users can configure agents without a later schema migration, and so
the matrix / fanout / delivery path treats `agent` as a first-class channel
from day one.

Per-channel validator for `agent` config requires: `url`, `secret`,
`system_prompt` (string), `context_template` (string, template literal syntax —
e.g., `"Notification for {{ work_item.display_key }}: {{ summary }}"`). The
other fields (`tool_use_mode`, `model`, `response_handling`) are accepted but
unused in v1.

### Email Channel

- `nodemailer` SMTP. Env-driven config (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM`). When unconfigured, logs a warning and marks the delivery
  `sent` (dev-friendly no-op) — guarded behind a `NODE_ENV !== 'production'` check;
  in production, lack of SMTP config is a fatal startup error.
- Realtime: one email per notification.
- Digest: one email per user per tick, grouped by work item, subject
  `"N updates from FlowOS — <date>"`.
- Template is plain text with minimal inline HTML. Each item is a hyperlink to
  `<BASE_URL>/admin/work-items/:id`.

## API Surface

New endpoints under `/admin/api`:

- `GET /notifications?cursor=<id>&unread_only=<bool>&limit=<n>` — inbox query.
  Cursor-based pagination: `cursor` is the `notifications.id` of the last item
  in the previous page (exclusive). Results ordered by `id DESC`. Response
  includes `next_cursor` (the last id returned) or `null` if exhausted. Cursor
  chosen over offset so inserts during pagination don't shift or duplicate rows.
- `PATCH /notifications/:id/read` — mark single read.
- `POST /notifications/mark-read` — accepts a filter body and marks all
  matching unread rows (for the current user) as read. Body shape:
  ```json
  {
    "ids":          [1, 2, 3],           // optional — explicit id set
    "work_item_id": 42,                  // optional — all for one item
    "event_type":   "work_item.edited",  // optional — all of one type
    "older_than":   "2026-04-15T00:00Z"  // optional — bulk cleanup
  }
  ```
  Filters AND together; empty body = mark every unread row for the user.
  Covers the drawer's "Mark all read" button, the auto-mark-read when a user
  opens a WorkItemDetail drawer (`{ work_item_id }`), and any future bulk UI
  actions without needing a new endpoint each time.
- `GET /notification-preferences` — returns the user's matrix (defaults merged
  with overrides) and channel config.
- `PUT /notification-preferences` — updates overrides and channel config.
- `GET /notification-deliveries?status=failed` — admin-only; failed delivery browser.
- `POST /notification-deliveries/:id/retry` — admin-only; reset to pending.

The inbox query powers the drawer; the card-dot query piggybacks on the board
endpoint with a subquery against `idx_notifications_user_workitem`.

## UI

- **Bell icon** in the sidebar (Lucide `Bell` SVG), unread count badge, click opens
  the Notifications drawer.
- **Drawer**: segmented `Unread | All` filter, type dropdown, time-grouped list,
  per-row event icon + summary + `reasons` pills + relative timestamp. Row click
  = mark read + navigate.
- **Card dots** on the Board: filled dot top-right when a user has unread for that
  item; tooltip shows count.
- **Settings page** at `/admin/settings/notifications`: three channel cards
  (In-App / Email / Webhook), matrix grid with per-cell overrides, digest radio per
  channel, "Reset to defaults" button, webhook-failing banner if applicable.

All conforms to the UI style guide: cartography theme, `text-xs`/`text-sm` only,
right-side drawer, no modals, Inter everywhere, auto-save on field change.

## Testing

- **`tests/notifications-fanout.test.js`** (no-server): matrix lookup, override
  precedence, actor suppression, `@mention` extraction, dedup-by-collapse,
  idempotent replay.
- **`tests/notifications-delivery.test.js`** (no-server): backoff schedule,
  webhook HMAC signing, digest aggregation, `failed` status after 5 attempts,
  agent-channel payload envelope correctly wraps `system_prompt` +
  `context_template` around the notification body.
- **`tests/notifications-ratelimit.test.js`** (no-server): per-user cap defers
  (not fails) on breach; per-host in-memory window evicts correctly and resets
  after the window; global concurrency semaphore never allows more than
  `DELIVERY_WORKER_CONCURRENCY` in-flight.
- **`tests/notifications-ownership-challenge.test.js`** (no-server, HTTP mock):
  challenge succeeds → channel enabled; wrong token → channel stays disabled;
  timeout → channel stays disabled; rotating the URL retriggers the challenge.
- **`tests/notifications-integration.test.js`** (server-running):
  - POST /work-items emits an event → notification row appears for requester.
  - POST /comments with `@user` → mentioned user sees row.
  - GET /notifications + PATCH /:id/read + POST /mark-all-read round-trip.
  - Admin endpoints: GET failed deliveries, POST retry resets status.

Playwright coverage deferred — drawer and settings page covered by component-level
assertions and manual verification for v1.

## Migration & Rollout

- Migration 010 adds all tables, seeds `blueprint.notification_defaults`, adds
  `is_agent` to `blueprint.users`.
- No data backfill — notifications start fresh from first event after deploy.
- `deliveryWorker.start()` wired into `api/server.js` boot, after the event
  processor starts.
- Feature is live the moment migration 010 is applied and the server restarts;
  existing users get default-matrix behavior with in-app channel enabled by default
  (auto-created on first notification).

## Retention

A nightly job (`runtime/jobs/notificationRetention.js`, scheduled via a simple
`setInterval` in the worker process, guarded by its own advisory lock) deletes
rows from `runtime.notifications` where `read_at < now() - interval '90 days'`.
Unread rows are never auto-deleted — if a user is gone for 6 months and comes
back, their unread inbox should still be there. `notification_deliveries` rows
cascade on `notifications` delete.

Env-configurable: `NOTIFICATION_RETENTION_DAYS` (default `90`), or `0` to
disable auto-retention entirely.

## Future: Agent Collaboration (separate design)

This spec ships notifications and reserves the `agent` channel. The richer
vision — FlowOS as an agent collaboration platform where Claude (or another
agent) maintains the backlog, updates the roadmap, and contributes to work
items as it executes them — is scoped to a follow-up design spec, tentatively
`agent-collaboration-v1`. That spec will cover:

- **Bidirectional protocol.** Agent responses feed back as FlowOS mutations
  (comments, work-item edits, new work items, transitions). Auth via the same
  API key; audit via the existing event log with `actor_id` = the agent's user.
- **Prompt context engine.** The `context_template` evolves into a fetchable
  context graph: related work items, project plan references, recent history,
  org goals. Some notifications demand more than the event payload.
- **Tool-use policies.** Per-agent-user allow-lists for which endpoints the
  agent may call. Default is read-only; write access is explicit.
- **Response handling modes.** Whether an agent's response becomes a comment
  on the triggering work item, a new work item, or is logged and dropped.
- **Agent-origin work items.** When FlowOS is the system of record for an
  agent's own roadmap / TODO, spawned items need a clear provenance chain.
- **Observability.** Dedicated admin view: which agents are acting on what,
  tokens used, cost attribution.

The notification channel design in this spec is deliberately forward-compatible:
the `agent` channel name is reserved, the config shape is JSONB so prompt /
context / tool fields can land without a migration, and agent users are
indistinguishable from human users in the fanout logic. Nothing in v1 closes a
door we'll want to walk through in that follow-up.

## Risks

- **Runaway notifications on bulk edits.** Once bulk operations ship, a single
  action could produce thousands of notifications. Mitigation: bulk ops emit a
  single `work_item.bulk_edited` event with `affected_ids[]`, not N separate events.
  Revisit when bulk ops are built.
- **Webhook abuse / amplifier.** Primary mitigation: the ownership challenge
  (see "Webhook Ownership Challenge" section) blocks activating any URL the
  user cannot prove they control. Defense in depth: per-host rate limit caps
  aggregate traffic to any single hostname even if challenges were somehow
  bypassed; per-user rate limit caps any one account's contribution.
- **Email deliverability.** SMTP hygiene (SPF, DKIM) is the operator's problem
  in a self-hosted system, not ours. Document it in the deploy README.
