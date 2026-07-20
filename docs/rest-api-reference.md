# Gladius REST API Reference

> External-consumer-facing reference for the Gladius HTTP API. Covers base path,
> authentication, and every endpoint group. For the complete raw endpoint list
> (method + path only, no shapes), see
> [`docs/api-endpoint-inventory.md`](./api-endpoint-inventory.md) — this document
> supersedes it as the human-readable entry point but that file is regenerated
> independently, so treat the two together as the source of truth. Where this
> doc and the code disagree, trust the code (`admin/api.js`, `api/routes/*.js`).
>
> Accurate as of 2026-07-15 (FEAT.26621). Not exhaustive — every ~173 endpoints'
> full field-level shape isn't documented, only the most-used ones.

---

## Base path & mounting

| Prefix | Source file | Auth |
|--------|-------------|------|
| `/auth` | `api/routes/auth.js` | Public |
| `/admin/api` | `admin/api.js` | `requireAuth` (session or Bearer) |
| `/admin/api/simulation` | `api/routes/simulation.js` | `requireDevTools` **and** `requireAuth` |
| `/health` | `api/server.js` | Public |

The admin UI is a single-page app served at `/admin/` (static build), which
calls `/admin/api/*` under the same origin. Programmatic/MCP clients call the
same endpoints directly.

## Authentication

Two mechanisms, both handled by `requireAuth` (`core/auth.js`). Bearer is
checked first, then falls back to session:

### 1. Session cookie (browser / admin UI)

- `POST /auth/login` with `{ email, password }` sets a session cookie named
  **`gladius.sid`** (httpOnly, 24hr). All subsequent requests from the browser
  send it automatically.
- `POST /auth/logout` destroys the session and clears the cookie.
- `GET /auth/me` returns the current user or `401`.
- `GET /auth/status` (public) returns `{ needsSetup, authenticated, user,
  devToolsEnabled, multiOrgEnabled }` — used by the UI to decide whether to
  show the setup wizard, login, or app.
- `POST /auth/setup` creates the first admin user; only works when no users
  with a password exist yet.
- Login and setup are rate-limited (`GLADIUS_LOGIN_RATE_MAX`, default 10 per
  15 min per IP) — brute-force throttle, disabled under `NODE_ENV=test`.

### 2. Bearer API token (programmatic / MCP clients)

Send `Authorization: Bearer fos_ak_<token>`. This is the path for the MCP
server (`mcp/gladius-context-server.js`), automation, and any non-browser
caller that can't hold a cookie session.

- Tokens are prefixed `fos_ak_` and are looked up by **SHA-256 hash**, not
  plaintext — `blueprint.users.api_token_hash` is the primary column
  (`core/auth.js#findUserByApiToken`). A legacy plaintext `api_token` column
  is retained only as a fallback during the hash migration: a hash-lookup
  miss falls through to a plaintext match, and a hit there backfills
  `api_token_hash` on that row (hash-on-use), so tokens self-migrate.
- A matched user must have `is_active = true`.
- There is currently no token-issuance or -rotation endpoint documented here;
  tokens are provisioned directly against `blueprint.users`.

Both paths populate `req.userId` for downstream handlers; `requireAuth`
returns `401` with `{ error }` on failure.

---

## Endpoint groups

Unless noted, every route below is under `/admin/api` and requires auth
(session or Bearer). Dev-tools-gated routes additionally require
`GLADIUS_DEV_TOOLS=true` (`requireDevTools` middleware) and 404/403 when off.

### Org structure & RBAC

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/org-types` | List / create org types |
| PATCH | `/org-types/:id` | Update org type |
| GET / POST | `/roles` | List / create roles |
| PATCH | `/roles/:id` | Update role |
| GET | `/permissions` | List all permissions |
| GET / PUT | `/role-permissions` | Read / replace role→permission grants |
| GET / POST | `/organizations` | List / create orgs |
| PATCH | `/organizations/:id` | Update org |
| GET / POST | `/org-members` | List / add org membership |
| PATCH / DELETE | `/org-members/:id` | Update / remove membership |
| GET | `/org-workflows` | Workflows assigned to an org |
| GET / POST | `/users` | List / create users |
| PATCH | `/users/:id` | Update user |
| GET | `/org-policy-data` | Aggregated policy config for an org |

### Work-item types, classes & custom fields

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/work-item-type-classes` | Global vocabulary classes (System org) |
| PATCH | `/work-item-type-classes/:id` | Update a class |
| GET / POST | `/work-item-types` | Org-scoped catalog entries (created from a class) |
| PATCH | `/work-item-types/:id` | Update a type |
| GET | `/service-library` | WIT-type catalog for an org (`?org_id=`) |
| GET / POST | `/class-fields` | Custom fields defined on a class |
| PATCH / DELETE | `/class-fields/:id` | Update / remove class field |
| GET / POST | `/type-fields` | Custom fields on a type (copied from class on type creation) |
| PATCH / DELETE | `/type-fields/:id` | Update / remove type field |

Custom field types: `text`, `number`, `date`, `select`, `multi-select`. Key +
type are immutable after creation; required-ness lives only in exit criteria,
not on the field definition. Keys can't collide with
`blueprint.reserved_field_keys` (28 entries) — enforced on POST.

### Workflows, stages & transitions

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workflows` | List workflows |
| GET / PATCH | `/workflows/:id` | Read / update a workflow |
| POST | `/workflows` | Create workflow |
| POST | `/workflows/:id/clone` | Clone a workflow (new draft version) |
| PUT | `/workflows/:id/stages/reorder` | Reorder stage `display_order` |
| POST | `/stages` | Create stage |
| PATCH / DELETE | `/stages/:id` | Update / remove stage |
| PATCH | `/transitions/:id` | Update a transition definition |
| GET / POST | `/transition-roles` | Roles permitted to execute a transition |
| DELETE | `/transition-roles/:id` | Remove a role grant |
| GET / POST | `/transition-actions` | Side-effect actions fired post-commit on a transition |
| PATCH / DELETE | `/transition-actions/:id` | Update / remove an action |
| GET / POST | `/exit-criteria` | Exit criteria definitions for a stage |
| PATCH / DELETE | `/exit-criteria/:id` | Update / remove a criterion definition |
| GET / POST | `/stages/:stageId/playbook` | Stage's AI playbook (markdown + YAML frontmatter) |

Exit criteria tiers: `manual` (human ack) and `codified` (system-evaluated).
The `api` tier was cut (DEBT.25494 — SSRF risk); unknown/legacy tiers fail
closed.

### Board & work items

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/board` | Full board snapshot for an org (see shape below) |
| GET / POST | `/work-items` | List (filtered) / create a work item |
| GET / PATCH | `/work-items/:id` | Read / partially update a work item |
| POST | `/work-items/:id/substate` | Set substate — `active` or `blocked` only |
| GET | `/work-items/:id/transitions` | Available outbound transitions |
| GET | `/work-items/:id/transition/prepare` | Dry-run a transition (`?to_stage_id=`) — returns pass/fail without committing |
| POST | `/work-items/:id/transition` | Execute a transition (two-phase engine: prepare then commit) |
| POST | `/work-items/bulk/transition` | Transition many items sequentially (per-item result) |
| POST | `/work-items/bulk/assign` | Assign many items to a user (per-item result) |
| GET | `/work-items/:id/exit-criteria-status` | Full criteria rows + status |
| GET | `/work-items/:id/exit-criteria` | Flat criteria array for current stage (MCP-friendly) |
| POST / DELETE | `/work-items/:id/exit-criteria/:criteriaId/acknowledge` | Ack / un-ack a manual criterion |
| POST | `/work-items/:id/exit-criteria/:criteriaId/waive` | Waive a criterion (with reason) |
| GET | `/work-items/:id/staleness` | Time-in-stage staleness signal |
| GET | `/transition-history` | Org-wide transition log |

Bulk endpoints are declared **before** the parameterized `/:id/transition`
route in `admin/api.js` so Express doesn't swallow `/bulk/*` as `:id="bulk"`.

### Comments & history

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/work-items/:id/comments` | List / add a comment (supports `parent_comment_id` for replies) |
| PATCH / DELETE | `/work-items/:id/comments/:commentId` | Edit (author-or-admin) / delete (cascades to replies) |
| GET | `/work-items/:id/history` | Audit trail — events expanded into per-field changes |

### Attachments (link-only)

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/work-items/:id/attachments` | List / add — JSON body for a link attachment |
| DELETE | `/work-items/:id/attachments/:attId` | Remove (uploader or admin only) |

File attachments were cut (FEAT.25493); only `kind='link'` is authorable.
Pre-existing `kind='file'` rows render with a text fallback; their bytes are
orphaned on disk.

### User relationships & item links

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/work-items/:id/relationships` | People watching/assigned/owning |
| DELETE | `/work-item-relationships/:id` | Remove a relationship |
| GET / POST | `/work-items/:id/links` | Item-to-item links (not parent/child) |
| DELETE | `/work-items/:id/links/:targetId` | Remove a link |

Parent/child hierarchy uses `parent_id` on the work item itself, not the
links table.

### Acceptance criteria

| Method | Path | Purpose |
|--------|------|---------|
| GET / PUT | `/work-items/:id/acceptance-criteria` | Read / replace the AC list |

### WIP limits

| Method | Path | Purpose |
|--------|------|---------|
| GET / PUT | `/org-wip-limits` | Per-stage-name WIP limits for an org |
| DELETE | `/org-wip-limits/:id` | Remove a limit |
| PUT | `/org-wip-class-limits` | Per-stage-class limits |
| DELETE | `/org-wip-class-limits/:id` | Remove a class limit |

### Lookup lists

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/lookup-lists` | Reusable value lists (for `select`/`multi-select` fields) |
| PATCH | `/lookup-lists/:id` | Update a list |
| GET / POST | `/lookup-lists/:listId/values` | List / add values |
| PATCH | `/lookup-values/:id` | Update a value |
| PUT | `/lookup-lists/:listId/values/reorder` | Reorder values |

### Reports & dashboards

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/reports/throughput` | Items completed per period, agent/human split |
| GET | `/reports/cycle-time-by-stage` | Time-in-stage distribution |
| GET | `/reports/aging-wip` | In-progress items by age |
| GET | `/summary` | High-level org counts |
| GET | `/dashboard` | Combined dashboard payload |

Flow metrics were trimmed to these three (cycle-time, aging-WIP, throughput),
each split by transition actor (agent vs. human, keyed on
`GLADIUS_AGENT_USER_ID`) — FEAT.26609.

### Search & saved filters

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/search/fields` | Native + visible-custom field catalog (for building filters) |
| GET | `/search` | Structured filter search (see shape below) |
| POST | `/search/translate` | Natural-language prompt → structured filter (Haiku 4.5) |
| GET / POST | `/saved-filters` | List / save a named filter |
| GET / PATCH / DELETE | `/saved-filters/:id` | Read / update / delete a saved filter |

`GET /search` requires at least one filter param or returns `{ rows: [],
next_before: null }` immediately. Cancelled-stage items are excluded by
default; opt in with `?include=cancelled` or `?stage_class=cancelled`.
`POST /search/translate` expects `{ prompt }` in the body and is subject to
per-user/per-instance budgets — every call is logged to
`runtime.translator_usage`.

### Notifications

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/notifications` | List notifications for the current user |
| PATCH | `/notifications/:id/read` | Mark one read |
| POST | `/notifications/mark-read` | Bulk mark-read |
| GET / PUT | `/notification-preferences` | Per-user channel preferences |
| GET | `/notification-deliveries` | Delivery outbox status |
| POST | `/notification-deliveries/:id/retry` | Retry a failed delivery |

Channels: `in_app` and `agent` only (`email`/`webhook` were cut, DEBT.25490).

### Events & subscribers

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/events` | Append-only event log |
| GET | `/event-subscribers` | Subscriber cursor status |
| POST | `/event-subscribers/:name/pause` | Pause a subscriber |
| POST | `/event-subscribers/:name/skip-past/:eventId` | Advance a stuck cursor |

### Context & AI (journal, org context, playbooks, models)

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/work-items/:id/context-entries` | Item journal — list / add an entry |
| PATCH / DELETE | `/work-items/:id/context-entries/:entryId` | Edit (author-or-admin) / delete |
| POST | `/work-items/:id/context-entries/:entryId/resolve` | Mark an entry resolved |
| POST | `/work-items/:id/context-entries/:entryId/reopen` | Reopen a resolved entry |
| GET | `/work-items/:id/assembled-context` | Full assembled context (journal + ancestors + org context) as sent to the LLM |
| GET | `/organizations/:orgId/session-context` | Single-round-trip board snapshot for AI agents |
| GET / POST | `/organizations/:orgId/context` | Org-level context library — list / add |
| PATCH / DELETE | `/organizations/:orgId/context/:id` | Edit / remove an org context entry |
| PATCH / DELETE | `/organizations/:orgId/playbooks/:id` | Edit / remove a stage playbook |
| POST | `/organizations/:orgId/playbooks/ai-assist` | AI-assisted playbook drafting |
| GET / POST | `/organizations/:orgId/ai-models` | List / add a named AI model config (API key encrypted at rest, AES-256-GCM) |
| PATCH / DELETE | `/organizations/:orgId/ai-models/:id` | Edit / remove a model config |
| GET | `/work-items/:id/stage-playbook` | Active playbook for the item's current stage |
| GET | `/work-items/:id/playbook-runs` | Playbook executor run history (status, tokens, entries written) |

Journal entry types: `nfr`, `discovery`, `acceptance`, `design`, `decision`,
`note`, `test-plan`, `playbook`. Visibility: `item` or `descendants`.

### Generic edit, avatar & MCP

| Method | Path | Purpose |
|--------|------|---------|
| PATCH | `/edit/:entityType/:id` | Generic field-level edit, gated by `/edit/rules` allowlist |
| GET | `/edit/rules` | Which fields are editable per entity type |
| POST | `/upload/avatar` | Upload a user avatar |
| GET | `/mcp/tools` | Canonical MCP tool schema manifest (same list the MCP server exposes) |

### Dev-tools-gated (`requireDevTools`)

Off by default; enable with `GLADIUS_DEV_TOOLS=true`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/tables` | List raw DB tables (browser allowlist) |
| GET | `/tables/:schema/:table` | Browse rows of an allowlisted table |
| POST | `/query` | Run a read-only ad-hoc query |
| GET | `/logs` | Recent server log lines |
| GET | `/logs/stream` | SSE log stream |

### Simulation (`/admin/api/simulation`, dev-tools-gated)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/start` \| `/stop` \| `/pause` \| `/resume` | Control the work-item flow simulator |
| PUT | `/speed` | Adjust simulation speed |
| GET | `/status` | Current simulation state |
| GET | `/stream` | SSE simulation event stream |
| GET | `/activity` | Recent simulated activity |

---

## Request/response shapes — most-used endpoints

### `POST /admin/api/work-items` — create a work item

Request:

```json
{
  "title": "REST API reference",
  "work_item_type_id": 138,
  "owner_org_id": 109,
  "description": "optional",
  "due_date": "2026-08-01",
  "is_expedited": false,
  "work_nature": "delivery",
  "priority": 2,
  "tags": ["focus-pivot-2026-07"],
  "estimate": 3,
  "estimate_unit": "points",
  "origin": "manual",
  "requester_id": null
}
```

`title`, `work_item_type_id`, `owner_org_id` are required (400 otherwise).
Response: `201` with the full created work item row (same shape as `GET
/work-items/:id` below).

### `GET /admin/api/work-items/:id` — read a work item

Response `200`:

```json
{
  "id": 26627,
  "uri": "flowos://org-slug/work-items/uuid",
  "title": "REST API reference",
  "description": "...",
  "spawn_state": "active",
  "current_substate": "active",
  "display_key": "FEAT.26621",
  "sequence_number": 26621,
  "field_values": {},
  "pending_missing_fields": null,
  "parent_id": null,
  "created_at": "...", "updated_at": "...", "entered_current_stage_at": "...",
  "current_stage_id": 639, "workflow_id": 138,
  "due_date": null, "is_expedited": false, "work_nature": "delivery",
  "priority": 2, "tags": [], "estimate": null, "estimate_unit": "points",
  "started_at": null, "resolved_at": null, "origin": "manual", "requester_id": null,
  "acceptance_criteria": [],
  "work_item_type_id": 138, "work_item_type_name": "Feature",
  "work_item_type_icon": "⭐", "work_item_type_color": "#8B5CF6",
  "key_prefix": "FEAT",
  "current_stage_name": "Planning", "current_stage_class": "in-progress", "is_terminal": false,
  "org_name": "Gladius Development", "org_slug": "flowos-dev", "owner_org_id": 109
}
```

`404` with `{ "error": "Work item not found" }` if missing.

### `POST /admin/api/work-items/:id/transition` — execute a transition

Request:

```json
{ "to_stage_id": 641, "reason": "optional, required by some transitions" }
```

Runs the two-phase engine (`runtime/transitions.js`) — exit criteria for the
current stage still gate the move. Response `200` on success:

```json
{
  "success": true,
  "workItemId": 26627,
  "fromStageId": 639,
  "toStageId": 641,
  "transitionHistoryId": 31305,
  "spawnedWorkItems": [],
  "warnings": []
}
```

On a gate failure: `422` with `{ "error": "...", "details": { ... } }` — no
partial state change. `GET /work-items/:id/transition/prepare?to_stage_id=`
runs the same evaluation without committing, for a dry-run/preview.

### `GET /admin/api/search` — structured filter search

Query params (all optional but at least one filter required, else immediate
empty result): `keyword`, `type_id`, `type_name`, `org_id`, `assignee_id`
(`me` resolves to the current user), `stage_class`, `priority`, `sort_by`
(`created_at`\|`updated_at`\|`priority`\|`due_date`), `sort_dir`
(`asc`\|`desc`), `created_after`, `created_before` (ISO date or relative
`Nd`), `limit` (max 200, default 50), `before` (cursor, work item id),
`include` (comma list, e.g. `cancelled`, `snippet`).

Response `200`:

```json
{
  "rows": [
    {
      "id": 26627, "display_key": "FEAT.26621", "title": "REST API reference",
      "priority": 2, "tags": [], "due_date": null, "is_expedited": false,
      "updated_at": "...", "resolved_at": null, "created_at": "...",
      "owner_org_id": 109, "status": "Planning", "stage_class": "in-progress",
      "org_slug": "flowos-dev", "org_name": "Gladius Development",
      "type_name": "Feature", "type_icon": "⭐", "type_color": "#8B5CF6",
      "substate": "active", "owner_user_id": null,
      "assignee_email": null, "assignee_name": null
    }
  ],
  "next_before": null
}
```

`next_before` is a cursor for the next page (pass as `?before=`) or `null` at
the end. Non-admin callers are automatically scoped to their org
memberships.

### `GET /admin/api/board` — board snapshot

Query: `?org_id=` (required).

Response `200`:

```json
{
  "org": { "id": 109, "name": "Gladius Development", "slug": "flowos-dev", "done_retention_days": 14 },
  "columns": [ /* 3-level hierarchy: stage_class group -> merged stage -> waiting split */ ],
  "items": [ /* work items with type/stage/owner joined in, unread notification counts */ ],
  "wip_limits": { "Planning": { "wip_limit": 5, "enforcement_type": "soft" } }
}
```

`items` excludes cancelled-stage items and applies the org's
`done_retention_days` window for completed work. `wip_limits` is keyed by
`stage_name` string, not id.

---

## MCP server (for AI agents)

External AI agents should generally prefer the **MCP stdio server**
(`mcp/gladius-context-server.js`, 19 tools) over calling this REST API
directly — it wraps the same endpoints via Bearer auth
(`mcp/http-client.js`) with retry/backoff and gives task-shaped tools
(`get_session_context`, `transition_work_item`, `write_context_entry`,
etc.). `GET /admin/api/mcp/tools` returns the same tool schema manifest the
MCP server uses, if you need to introspect it without an MCP client.

---

## See also

- [`docs/api-endpoint-inventory.md`](./api-endpoint-inventory.md) — flat
  method+path list, regenerated by grepping route files (DEBT.26607).
- `admin-ui/src/lib/api.js` — the admin UI's own API client, useful as a
  worked example of calling every endpoint from JS.
- `ARCHITECTURE.md` — database schema and the two-phase transition model
  these endpoints sit on top of.
