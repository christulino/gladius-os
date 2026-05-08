# FlowOS Architecture Reference

> Deep reference for database schema, core model decisions, board model, and project
> status. Read this when working on specific subsystems — not every session.
>
> For everyday guidance, read `CLAUDE.md` instead.

---

## Repository Structure

```
flowos/
├── CLAUDE.md               # Read first — commands, stack, rules
├── ARCHITECTURE.md         # You are here — deep reference
├── api/                    # Express API server
│   ├── server.js           # Entry point, auth middleware, route mounting
│   └── routes/
│       ├── auth.js         # Login, logout, setup wizard, session status
│       ├── forms.js        # Public intake forms (no auth required)
│       ├── organizations.js
│       ├── workItems.js    # CRUD + prepare/execute transition
│       ├── catalog.js
│       └── board.js
├── admin-ui/               # React + Vite + shadcn/ui admin interface
│   ├── src/
│   │   ├── App.jsx         # Auth gate, sidebar nav, public form routing
│   │   ├── lib/api.js      # All API calls (~55 endpoints + forms + auth)
│   │   ├── lib/utils.js    # cn(), formatElapsed(), formatRelative()
│   │   ├── hooks/useApi.js
│   │   ├── components/     # FormDrawer, Panel, WorkItemCard, WorkItemDetail,
│   │   │                   # ServiceLibrary, OrgSelector, ColorPicker, shadcn ui
│   │   └── pages/          # Board, Summary, Organizations, WorkItems, Workflows,
│   │                       # WitClasses, WitTypes, WorkflowManager, Users,
│   │                       # History, RawTables, LogViewer, DbConsole,
│   │                       # Reports, Simulation, Login, Setup, IntakeForm
│   ├── vite.config.js      # base: '/admin/' — required for Express serving
│   └── tailwind.config.js  # uses require() not import() — jiti compatibility
├── core/                   # Shared business logic
│   ├── access.js           # Visibility rules engine (STUBBED — always returns true)
│   ├── auth.js             # Session middleware, requireAuth, password hashing (bcrypt)
│   ├── calendar.js         # Business calendar utilities (STUBBED)
│   ├── events.js           # emitEvent / nudgeAfterCommit
│   ├── inheritance.js      # Org policy inheritance (STUBBED)
│   ├── storage/            # Pluggable attachment storage adapter
│   │   ├── index.js        # Factory + buildStorageKey + MAX_ATTACHMENT_BYTES
│   │   └── localStorage.js # Local filesystem adapter (S3 deferred)
│   └── uri.js              # Work item URI generation (WORKING)
├── db/
│   ├── postgres.js         # PG connection pool
│   ├── neo4j.js            # Neo4j driver
│   ├── init/
│   │   ├── blueprint_schema.sql   # v1.2
│   │   └── runtime_schema.sql     # v0.4
│   ├── migrations/         # 001 through 015 (append-only, idempotent)
│   └── seeds/
│       ├── seed.js
│       └── seed_test_data.js
├── graph/                  # Neo4j graph modules (STUBBED — not yet seeded)
│   ├── hierarchy.js
│   ├── orgTree.js
│   └── sync.js             # PG → Neo4j sync queue (fills but not drained)
├── board/
│   └── boardQuery.js       # Board state assembly (SCAFFOLDED, not complete)
├── runtime/
│   ├── transitions.js      # Transition engine
│   ├── exitCriteria.js     # Exit criteria evaluation
│   ├── workItems.js        # Work item runtime operations
│   ├── workItemHistory.js  # Audit trail query + per-event rendering
│   ├── attachments.js      # Attachment CRUD + event emission
│   ├── eventProcessor.js   # Advisory lock, drain loop, subscriber registry
│   ├── deliveryWorker.js   # Notification delivery outbox drain (separate lock)
│   ├── search/             # JQL parser/compiler + NL→JQL translator
│   └── subscribers/        # neo4j-sync, audit-log, notifications, search-index
├── simulation/             # Simulation engine for generating test flow data
│   └── engine.js
├── admin/                  # Admin API routes (mounted at /admin/api)
│   └── api.js              # ~70 endpoints
├── docker-compose.yml      # PostgreSQL + Neo4j
├── tests/                  # API integration tests (require running server)
└── package.json
```

---

## Database Architecture

**Boundary rule:** "What are the properties of this thing?" → PostgreSQL.
"How is this thing connected to other things?" → Neo4j.

### PostgreSQL — Blueprint Schema (~33 tables)

Structural definitions. The "how work should flow" schema. Empty of actual work.
Can be versioned, snapshotted, rolled back independently of runtime.

Key tables:
- `organizations` — org tree with behavioral flags (has_external_intake, has_sla,
  is_service_center, is_coordination_layer, is_platform)
- `workflows` — directed graph workflow definitions
- `stages` — nodes with class, WIP limits, sub-state config
- `transitions` — directed edges with exit criteria and actions
- `work_item_types` — type library with adopt/fork/create model
- `field_definitions` — per-type field schema with required_at_stage support
- `service_classes` — name, color, sort_order, cost_of_delay_profile, sla_hours, sla_warning_pct
- `saved_filters` — first-class JQL filters with private/org/global scope (search v1)
- `reserved_field_keys` — 28 JQL native identifiers; custom field keys can't collide

### PostgreSQL — Runtime Schema (~18 tables)

Work item instances and all activity data. The "what is actually happening" schema.

Key tables:
- `work_items` — instances with sub_state, is_draft, resolution, service_class_id, spawn_state,
  priority, tags, estimate, estimate_unit, started_at, resolved_at, origin, requester_id
- `work_item_history` — full audit trail, immutable, sacred timestamps
- `assignments` — work item ↔ user with role
- `sub_state_history` — sub-state transition log
- `events` — append-only event log (id, event_type, entity_id, entity_uri, actor_id, occurred_at, payload)
- `event_subscribers` — per-subscriber cursor + health (name PK, last_processed_event_id, is_paused, last_error, failure_count)
- `work_item_edits` — field-level audit log (Jira changegroup/changeitem analog)
- `work_item_search` — denorm tsvector + per-source text columns (search v1)
- `translator_usage` — NL→JQL Haiku call log with token counts and outcome (search v1)
- `attachments` — work-item-scoped files & links; `kind`, `storage_key`, `file_name`,
  `file_size_bytes`, `mime_type`, `url`, `url_title`, `uploaded_by_user_id` (attachments v1, migration 015)

### Neo4j — Graph Store (not yet seeded)

Four graphs: work item relationships (parent/child/spawned/origin), org hierarchy,
user context, blocking chain analysis.

Neo4j is populated via sync queue from PostgreSQL. Read-only from the API.
PostgreSQL is the source of truth.

---

## Core Model Decisions (locked)

### Global URI Addressing
Every entity: `flowos://org-slug/entity-type/uuid`
Local DB primary keys are internal only. URIs are the public cross-system identity.
Valid entity types: orgs, work-items, users, workflows, stages, work-item-types,
service-classes, connections, transitions, criteria

### Workflow as Directed Graph
Stages are nodes, transitions are directed edges. Multiple outbound transitions from
any stage. Non-linear workflows are first-class. `transition_kind`: forward | backward |
sideways | cross-workflow.

### Stage Classes — Universal Vocabulary
Every stage belongs to a class: `intake | triage | queued | in-progress | blocked |
review | approved | delivery | done | cancelled`
Enables cross-workflow board visibility ("QA Testing" and "Legal Approval" are both
`review` class).

### Sub-States
`active | blocked | waiting` — icon glyphs on cards, never columns.
`waiting` = arrived at stage with `has_waiting_queue = true` but not pulled to active.
Blocked items do not consume WIP capacity.

### Draft
Creation-time flag, not a sub-state. Drafts live in submission tray outside the board.
Enter workflow at intake on submission. Age indicators at 3d (amber) and 7d (red).

### Resolution
Terminal annotation: completed | cancelled-superseded | cancelled-deprioritized |
cancelled-out-of-scope | discarded-duplicate | discarded-not-viable | discarded-no-action.
Discard rate is a Kanban health signal.

### Work Item Creation — Pending State
Missing required fields → `spawn_state: 'pending'`, `pending_missing_fields: [...]`.
All present → `spawn_state: 'active'`. Never rejects on missing fields.

### Display Key
`PREFIX.SEQ` (e.g. `BUG.42`). Prefix from `work_item_types.key_prefix`. Sequence
uses `runtime.work_item_seq`.

### Exit Criteria — Three Tiers
1. **Manual** — human evaluated, system tracks acknowledgment
2. **Codified** — system evaluates (field value, child items terminal, checklist)
3. **API** — external call returns condition

Exit criteria OWN all blocking logic. Transition actions never block.

### Transition Actions — Fire-and-Forget
- `api_call` — HTTP request, logged, never blocks
- `spawn` — creates work item in target org, inside transaction (fatal on failure)
- `optional_spawn` — user prompted BEFORE transition fires

### Transition Engine — Locked Decisions
1. API exit criteria failure → blocks transition
2. Optional spawn prompt → before transition fires
3. Spawn action failure → rolls back entire transition
4. api_call actions → fire and forget after commit
5. Neo4j sync → async via the event system (`neo4j-sync` subscriber)

### Service Classes — Derived, Not Selected
| Input | Derived Class |
|-------|---------------|
| `is_expedited = true` | Expedite |
| `due_date IS NOT NULL` | Fixed Date |
| `work_nature = 'improvement'` | Deferred |
| none of the above | Standard |

Computed via CASE expression in SQL. Legacy `service_classes` table still exists but
is no longer used in creation flow or card display.

### Child Work Items — Two Patterns
1. **System-spawned** — deterministic, created by trigger/action at transition time
2. **User-initiated** — ad-hoc decomposition, any type, any accessible org

### Org-Level WIP Limits
Keyed on `stage_name` string. "Same name = same stage on board." Default enforcement
is "soft" — WIP limits expose problems, not prevent work.

---

## Board Model

### Three Views

| View | Purpose | Status |
|------|---------|--------|
| Team Board | Walk the board, pull work forward | v1 (working) |
| Network Board | Cross-org view, relationship topology | v2 |
| Highway View | Visual pulse of entire system | v2 |

### Board Column Hierarchy (3 levels)

- **L1: Stage Class** — spanning header. Hidden when class has exactly 1 stage.
- **L2: Workflow Stage** — actual stage names. Same-name + same-class stages merge.
- **L3: Waiting Queue** — `has_waiting_queue = true` → split column (waiting | active).

API response shape (`GET /admin/api/board?org_id=X`):
```json
{
  "columns": [
    {
      "stage_class": "in-progress",
      "class_label": "In Progress",
      "stages": [
        { "key": "in-progress:In Development", "name": "In Development",
          "stage_ids": [5, 12], "has_waiting_queue": true, "display_order": 4 }
      ]
    }
  ],
  "items": [],
  "wip_limits": {},
  "service_classes": []
}
```

Items keep real `current_stage_id`. Frontend maps via `stage_ids` array.
Waiting-state cards show `→` pull button (sets substate to `active`).

### Card Encoding
Shape = work item type. Fill = ownership (solid = mine, hollow = other org).
Glyph = sub-state (↻ in-progress, ✕ blocked, no glyph = ready).
Connection indicator on cards with relationships.

---

## Load-Bearing Utilities

| Utility | Location | Status |
|---------|----------|--------|
| `generateUri(orgSlug, entityType)` | core/uri.js | WORKING |
| `createSessionMiddleware()` | core/auth.js | WORKING |
| `requireAuth` middleware | core/auth.js | WORKING |
| `hashPassword` / `verifyPassword` | core/auth.js | WORKING |
| `calculateWorkingTime(start, end, cal)` | core/calendar.js | NEEDS VERIFICATION |
| `canAccess(userId, resourceType, resourceId, permissionType)` | core/access.js | STUBBED |
| `resolveOrgCalendar(orgId)` | core/calendar.js | STUBBED |
| `resolveInheritedPolicy(orgId, resourceType)` | core/inheritance.js | STUBBED |
| `syncToGraph(entityType, uri, operation, data)` | graph/sync.js | STUBBED |
| `getWorkItemHierarchy(workItemUri, userId)` | graph/hierarchy.js | STUBBED |

---

## Schema History

1. **v1.2 fixes** — table ordering bug, broken ALTER TABLE, missing tables
2. **Migration 004** — org_wip_limits, class_fields, work_item_links, display keys
3. **Migration 005** — due_date, is_expedited, work_nature (derived service classes)
4. **Migration 006** — priority, tags, estimate, started_at, resolved_at, origin, requester_id
5. **Migration 007** — Custom field engine: lookup lists, field definitions
6. **Migration 008** — done_retention_days on organizations
7. **Migration 009** — org_wip_limits_by_class (stage-class-level WIP)
8. **Migration 010** — Auth: password_hash, is_admin, sessions table
9. **Migration 011** — Event system: events, event_subscribers, work_item_edits. Drops legacy search_index_queue.
10. **Migration 012** — Notifications: notifications, notification_deliveries, notification_defaults
11. **Migration 013** — (audit trail support — events shape extended)
12. **Migration 014** — Search v1: work_item_search (tsvector + per-source text), pg_trgm + trigram indexes on work_items.title/display_key, saved_filters, reserved_field_keys (28 JQL natives), translator_usage. Drops orphan search_index_queue.

---

## What Is and Isn't Built

### Working
- PostgreSQL schema (blueprint + runtime, ~60 tables, 14 migrations)
- Docker Compose environment (PostgreSQL + Neo4j)
- Seed data (enterprise org hierarchy, workflows, types, service classes, roles)
- Authentication (sessions, setup wizard, login/logout, requireAuth)
- Express API (~80 endpoints)
- Public intake forms (field-driven, anonymous submission, tracking numbers)
- Service catalog with admin CRUD and public form toggle
- Transition engine with exit criteria (3-tier evaluation, acknowledgment, waiver)
- React admin UI (20+ pages, cartography theme)
- Board: 3-level columns, drag-to-pan, skeleton loading, swimlanes, split waiting/active
- Work item detail drawer, comments, linking, people management
- Hierarchical WIP limits, class fields, custom field engine, simulation engine
- Org Center (5 section pills: Settings, Catalog, Policies, Members, Workflows)
- Event system + per-item audit trail
- Notifications v1 (in_app, email, webhook, agent channels)
- **Search v1: JQL parser + AST→SQL compiler with org-scope and admin bypass; tsvector index maintained by event subscriber; Haiku NL→JQL translator with abuse hardening; first-class saved filters (private/org/global); SearchPage UI with `/` keybinding**

### Open Source Release Blockers
- Cross-instance service requests (API calls between instances)
- Seed-and-go experience (`docker-compose up` → working board in 5 minutes)
- README + LICENSE

### Post-Release Roadmap
- Trigger/action processing (spawn works; notify/field-update/webhook not yet)
- Neo4j seeding (sync queue fills but not drained)
- Flow metrics (cycle time, lead time, throughput, WIP age, CFD)
- Network Board / Highway View
- SLA enforcement, notification engine
- SSO, full-text search, object storage, event bus, API versioning

### Open Questions
1. License: AGPL vs. Apache 2.0?
2. Event sourcing vs. current snapshot model?
3. Max org hierarchy depth?
4. Cross-instance auth: API keys vs. OAuth2 client credentials?
5. Neo4j visualization: Bloom vs. custom D3/Cytoscape.js?

---

## Session Log

### Session 16 (2026-03-25) — Open source decision
Decided to release as open source. Not SaaS, not a startup. Cross-instance via API
calls (service catalog + intake), not federation. Each instance sovereign.

### Session 17 (2026-03-30) — Auth, UI polish, intake forms
1. Username/password auth (migration 010, core/auth.js, setup wizard, all endpoints protected)
2. UI polish (Lucide SVG icons, skeleton loading, theme tokens, drag-to-pan board)
3. Public intake forms (forms.js, IntakeForm.jsx, catalog admin CRUD, dynamic field rendering)

### Session 18 (2026-03-30) — Exit criteria evaluation engine
Full exit criteria lifecycle: manual/codified/api evaluation, runtime status tracking
(auto-populated on stage entry), acknowledgment/undo/waive endpoints, transition gate
UI with inline confirm buttons and waive-with-reason.

### Session 20 (2026-04-16) — Event system
Event system shipped. Three new runtime tables: `events` (append-only bus),
`event_subscribers` (per-subscriber cursor with PG advisory lock for
single-processor enforcement), `work_item_edits` (Jira-shaped field audit).
Two subscribers live: `neo4j-sync` (replaces direct `syncToGraph` calls)
and `audit-log` (writes `work_item_edits` rows). Retired
`runtime.search_index_queue`. 13 event types emitted across transitions,
work-item CRUD, people, links, comments, substates, and exit-criteria
ack/waive. Admin UI at `/admin/events`.

**Known v1 limitations** (deferred to later sessions):
- No per-tick event budget — a subscriber with a huge backlog can monopolize
  the drain loop until it catches up.
- Subscribers drain sequentially — one slow handler blocks all others.
- Unit-style processor tests (drainNow-based in `tests/events-system.test.js`)
  cannot run while the API server holds the advisory lock. Run those tests
  with the server stopped; run integration tests (PATCH, emission, end-to-end)
  with the server running.
- No retention policy yet — events accumulate. Add a cron when volume warrants.
- Cross-instance nudging uses the 30s safety poll, not PG LISTEN/NOTIFY.

### Session 21 (2026-04-20) — Notifications v1
Notifications subsystem shipped. Three new runtime tables (migration 012 +
013-fix): `notifications` (in-app inbox), `notification_deliveries` (outbox
for email/webhook/agent with retry state), plus three blueprint tables for
the default matrix, per-user overrides, and per-user channel config.
`blueprint.users.is_agent` column added.

**Decisions:**

#### [2026-04-20] Hybrid channel config schema
**What:** `blueprint.user_notification_channels` uses typed columns for
stable universal fields (`is_enabled`, `digest`, `next_digest_at`) plus
a `config` JSONB for channel-specific payload.
**Why:** The agent channel's config shape (system_prompt, context_template,
tool_use_mode, model, response_handling) is expected to evolve quickly.
JSONB avoids migrations for every new agent field. Universal fields stay
typed for index/query clarity.
**Tradeoffs:** Validation of JSONB shape moves to application layer
(per-channel validators). Acceptable at current scale.

#### [2026-04-20] Agent as first-class channel, reserved namespace
**What:** Agents are regular user rows with `is_agent=true`, authenticated
by API key, and receive notifications via a dedicated `'agent'` channel that
wraps the payload in a prompt envelope but delivers identically to webhook
(HTTP + HMAC). The channel name is reserved in the CHECK constraint for v1.
**Why:** Unlocks FlowOS-as-agent-collaboration-platform later (Claude
maintaining roadmaps, updating TODOs, executing as work happens) without a
schema migration. The agent is a first-class participant in the same fanout
matrix as humans.
**Tradeoffs:** v1 agent behavior is "webhook + envelope" only — no
bidirectional protocol, no context fetching beyond the event payload, no
tool-use policies. Those are scoped to a follow-up `agent-collaboration-v1`
design spec.

#### [2026-04-20] Event type list hardcoded in the subscriber
**What:** `runtime/subscribers/notifications.js` holds a static `HANDLED`
Set of the 11 v1 event types. Adding a new event type requires editing both
the set and the seed in `blueprint.notification_defaults`.
**Why:** `handlesEventType()` is sync and called by the processor before
the handler runs. A DB-lazy-load caused a race where all events were
silently skipped at startup until the first handler invocation (which
never happened because the filter returned false). Commit `f8c2579` fixed
this. Static list is the simplest correct answer and makes the "v1
supported events" list explicit in code.
**Tradeoffs:** Minor coupling — the seed SQL and the JS list must stay in
sync. Caught at integration test time if they drift.

#### [2026-04-20] Webhook ownership challenge as activation gate
**What:** When a user saves a new webhook or agent URL, the channel is
marked `is_enabled=false` and FlowOS POSTs a random token; the endpoint
must echo the token back within 10s for the channel to activate.
**Why:** Primary defense against the amplifier case — a malicious user
can't turn FlowOS into a traffic generator against a victim endpoint
because the victim won't pass the challenge. Combined with per-host rate
limiter as defense in depth.
**Tradeoffs:** Users need to build a small verification handler at the
webhook URL, which is a standard pattern (Stripe, Slack) so acceptable.

#### [2026-04-20] Three-layer rate limiting on out-of-band delivery
**What:** (1) Per-(user, channel) sliding window computed from the
deliveries table itself (60/min, 600/hour default); (2) per-destination-host
in-memory sliding window (30/min); (3) global worker concurrency semaphore
(10 default). Breach reschedules, never drops.
**Why:** Low effort, defense in depth. User-level cap bounds any one
account's contribution; host-level cap prevents amplification; concurrency
cap prevents one slow endpoint from starving the worker.
**Tradeoffs:** Per-host limiter is in-memory — cross-instance state lost on
restart. Accepted because the cap is advisory and a brief restart burst is
safer than the cross-instance coordination we don't need yet.

### Session 22 (2026-04-29) — Audit trail v1
Per-work-item audit trail shipped on top of the Session 20 event system —
no schema changes. New module `runtime/workItemHistory.js` reads
`runtime.events` filtered by `entity_id`, joins `blueprint.users` for
actor metadata, and runs three batched lookups (stages, users, target
items) to resolve display labels for transitioned/assigned/linked events.
Field-level edit detail comes from the event payload's `changes[]` array,
not the parallel `runtime.work_item_edits` table — both hold the same
data; payload is one fewer join.

New endpoint `GET /admin/api/work-items/:id/history` paginates
descending by `id` with cursor `?before=`. Frontend exposes it as the
"Activity" tab on `WorkItemDetail` via `WorkItemHistory.jsx` (~162
lines). Edit rows expand inline to show `field: old → new`.

**Decisions:** none — straightforward feature work atop an existing
substrate.

### Session 23 (2026-05-06) — Search v1
JQL search system shipped end to end: peggy grammar → AST → parameterized
SQL compiler → tsvector index maintained by an event subscriber → React
SearchPage. The compiler emits `wi.owner_org_id = ANY($N)` for normal
users and bypasses (TRUE) for instance admins. Done-retention (90 day
default) is auto-injected unless the query references resolved/id/key/
stage_class=done.

`runtime.work_item_search` is a denorm table with the `search_doc`
tsvector plus the four source text columns (title/description/custom/
comments) for `ts_headline()` snippet generation. The `search-index`
event subscriber listens for work_item.{created,edited,commented,
comment_edited,comment_deleted} and rebuilds the row via UPSERT
(idempotent, replay-safe). Backfill: 25,237 items in 34.8s.

Haiku 4.5 powers NL→JQL with layered defenses: 2048-char input cap,
per-user hourly call limit (30) and daily token budget (100k), per-
instance daily token budget (5M), output-shape filter (rejects prose,
markdown fences, "I am sorry"), AST-parse with one-shot retry, and
`<user_request>...</user_request>` prompt-injection wrapping. Every
call writes a `runtime.translator_usage` row.

Saved filters are first-class with private/org/global scopes;
permissions enforced server-side (org-scope creation requires
membership; global requires is_admin). The reserved-key validator
on POST /class-fields and POST /type-fields blocks custom field
keys that would collide with the 28 JQL natives.

Endpoints: GET /search, GET /search/fields, POST /search/translate,
GET|POST|PATCH|DELETE /saved-filters. New nav: sidebar Search entry,
header search icon, `/` keybinding (skips inputs/textareas).

**Decisions:**
- [ARCH] Compiler bypasses org-visibility for is_admin — without it,
  admins with no `org_memberships` rows see no results. Real RBAC
  blocked on the auth-system buildout.
- [ARCH] peggy generated as `--format es` (named exports), wrapped in
  `runtime/search/jql.js` with `import * as parser`. The plan assumed
  the CommonJS default-export shape — corrected.
- [SCOPE] Skipped Task 9 (comment_edited/deleted event emissions).
  Comments are currently immutable in the API; subscriber declares
  the handlers for when those endpoints land.
- [SCOPE] Kept legacy `/work-items/search` endpoint — used by
  WorkItemDetail's link picker. Followup: migrate the picker to
  the new /search. (Done in Session 24.)

**Tests:** 7-test integration suite covering 404, single-event,
multi-field expansion, assignment summary, descending order, limit
parameter, cursor pagination. All green.

**Out of scope for v1:** event-type filter, search-within-history,
diff viewer for long text, "revert" actions, click-through to spawned
children. Manual browser verification of the tab is the only
unverified piece — flagged for next session.

### Session 24 (2026-05-07) — Search v1 polish

Smoke-tested the Haiku translator end to end with `ANTHROPIC_API_KEY`
set and uncovered a real bug: `runtime/search/translate.js` was passing
`timeout: 30000` inside the Messages API request body, where it isn't a
valid field. The Anthropic API rejected with `400: "timeout: Extra
inputs are not permitted"`; the error message contained "timeout" which
matched the `/timeout/i` regex on the catch path and got mis-classified
as `TRANSLATOR_TIMEOUT` 504. Translator was 100% broken whenever a real
key was set; the test suite stubbed the SDK and never exercised the
path. Fix: move `timeout` to the SDK's second-arg request options
(`client.messages.create(body, { timeout })`).

Migrated `WorkItemDetail`'s related-item picker off the retired
`GET /work-items/search` (substring ILIKE on title/key) onto the new
`/search`. To preserve typeahead UX without inventing a separate lookup
endpoint:

- `~` operator semantics changed: was `plainto_tsquery('english', q)`,
  now `to_tsquery('english', tokens.map(t => t+':*').join(' & '))`.
  Each whitespace-tokenized term gets a `:*` prefix-suffix so partial
  typing matches stems forward (typing `auth` matches `authentication`).
  Empty-string input compiles to `FALSE` (no error). The same shared
  helper, `buildPrefixTsquery`, is reused by `ts_headline` so snippet
  highlighting marks prefix matches too.

- `runtime.work_item_search.search_doc` now includes `display_key` text
  concatenated into the title-weight `setweight()` block. Typing `BUG`
  matches BUG.42 by key via the same `~` operator; no per-field
  branching in the picker. `title_text` column is unchanged.

- `searchWorkItems` in `admin-ui/src/lib/api.js` now constructs
  `text ~ "<escaped-q>" ORDER BY updated DESC` JQL and calls `/search`
  with `limit=20`. Response shape is preserved (`{rows, count}`) so
  `WorkItemDetail.jsx` was untouched. JQL-string-escaping defends
  against `"` injection in user typing.

- `GET /work-items/search` route deleted from `admin/api.js`.

Backfilled `runtime.work_item_search` for 25,239 rows (28.8s) so the
new `display_key`-aware tsvector replaces the old per-row contents.

**Decisions:**
- [ARCH] `~` operator: prefix tsquery is now the documented semantics.
  Tradeoff: marginally weaker token discrimination (any prefix of any
  stem matches) for usable typeahead. Affects every `~` consumer, not
  just the picker — saved filters with `text ~ "term"` are slightly
  broader than before. Considered acceptable; tests updated to assert
  the new shape.
- [ARCH] `display_key` co-located in `search_doc` rather than
  `key ~` adding a separate code path. Single tsvector, single
  operator, one place to keep current. The english parser splits
  dotted keys (`BUG.42` → `'42':n 'bug':m`), so prefix typing on the
  alpha part works; full-key typing still works via exact `key = "X.N"`.
- [SCOPE] Picker migration kept the existing wrapper-function shape.
  Alternative was deleting `searchWorkItems` from `lib/api.js` and
  changing `WorkItemDetail.jsx` to call `searchWorkItems` directly.
  Wrapper preserves a single chokepoint for picker-specific JQL and
  response massaging — easier to evolve later.

**Tests:** `tests/search-jql.test.js` updated — `~` now asserts
`to_tsquery` with `:*` token; added multi-word AND-join and
empty-input cases. 45/45 pass. search-api/search-translate/
search-index 49/49 pass. Saved-filters/workflow/comments/history
43/43 pass.

**Browser-verified:** picker shows live results for `depl`, `BUG`,
`auth`, `cdn` partials; nonsense input returns 0 rows. Network tab
confirms `/admin/api/search?q=text+~+"..."` is the only call —
legacy endpoint never invoked.

**Followups:** test isolation issue between search-* and comments-api
(comments fail when run after search tests; pass alone) — logged as
[P2] in BACKLOG. Same shape as the events/notifications baseline
flake.
