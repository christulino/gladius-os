# CLAUDE.md — FlowOS

> Source of truth for project context. Update at the end of every working session.
> Last updated: 2026-06-13 (Session 26 — Bulk ops + comment edit/delete shipped; all Tier-1 blockers done)

---

## Project

FlowOS is an **open source** universal work operating system built on Kanban/Lean
principles (Ohno/TPS, Anderson, Burrows). Self-hostable, not SaaS. Maintainer: Chris
Tulino. See `flowos-design-doc.docx` for the full intellectual foundation.

**Mental model:** Work is a flow system, not a task list. The board is a health monitor,
not a status tracker. We watch the work move, not the people doing it.

---

## Commands

```bash
docker-compose up -d                    # Start PostgreSQL + Neo4j
npm run dev                             # API server (port 3000, auto-restart)
npm start                               # API server (no watch)
cd admin-ui && npm run dev              # Admin UI (port 5173, proxies API to 3000)
cd admin-ui && npm run build            # Build admin UI for production
npm run seed                            # Seed database (drops + recreates all data)
npm test                                # Integration tests (requires running server)
node --test tests/workflow-api.test.js  # Run a single test file
npx eslint .                            # Lint
```

Tests are **integration tests** that hit the running API. No separate test database —
tests use the same local PostgreSQL instance.

---

## Tech Stack

- **Runtime:** Node.js (ESM, v24) — all files use `import`/`export`
- **API:** Express REST (`admin/api.js` — ~80 endpoints at `/admin/api`)
- **Database:** PostgreSQL (source of truth) + Neo4j (graph queries, not yet seeded)
- **Frontend:** React 18 + Vite + shadcn/ui + Tailwind, served at `/admin/`
- **Auth:** express-session + connect-pg-simple. Cookie: `flowos.sid`, 24hr, httpOnly
- **No ORM** — raw SQL with `pg` pool, parameterized queries everywhere

---

## Key Patterns

- **Two PG schemas:** `blueprint` (structural definitions) and `runtime` (work instances)
- **Request flow:** `api/server.js` → route mounting → `admin/api.js` → `runtime/` → `db/postgres.js`
- **Transition engine:** two-phase prepare → execute. Exit criteria gate transitions.
  Transition actions fire as side effects (never block). See `ARCHITECTURE.md` for details.
- **Public intake forms:** `/forms/:slug` (no auth), `/intake/:slug` serves React SPA
- **Vite base path:** `base: '/admin/'` in vite.config.js — required for Express serving
- **tailwind.config.js** uses `require()` not `import()` (jiti compatibility)
- **Event system:** `runtime.events` append-only log + per-subscriber cursor. Emit
  via `emitEvent(client, ...)` inside a transaction. Subscribers in `runtime/subscribers/`.
  Single active processor per deployment (PG advisory lock).
- **Notifications:** event subscriber fans out to `runtime.notifications` +
  `runtime.notification_deliveries`. Four channels (`in_app` direct-query,
  `email`/`webhook`/`agent` via `runtime/deliveryWorker.js` with exponential
  backoff + rate limits + webhook ownership challenge). Event-type list is
  **hardcoded** in `runtime/subscribers/notifications.js` (keep in sync with
  `blueprint.notification_defaults` seed in migration 012).
- **Audit trail:** `GET /admin/api/work-items/:id/history` reads
  `runtime.events` filtered by `entity_id` and expands `work_item.edited`
  payloads into per-field changes. Logic in `runtime/workItemHistory.js`,
  rendered as the "Activity" tab in `WorkItemDetail` via `WorkItemHistory.jsx`.
  Cursor pagination via `id < before` + `next_before` in response.
- **Admin-ui nav:** tab-based via `NAV` array + `PAGES` map in `App.jsx`.
  No react-router. The sidebar is inlined in `App.jsx` (not a separate
  `Sidebar.jsx` file).
- **Search:** JQL grammar (`runtime/search/jql.peggy`, generated to
  `jql.parser.js` via `npm run build:grammar`) → AST → SQL compiler
  (`runtime/search/jqlCompiler.js`) with hardcoded org-visibility scope
  (admin bypass) and 90-day done-retention default. The
  `runtime.work_item_search` denorm tsvector is maintained by the
  `search-index` event subscriber on work_item.{created,edited,
  commented,comment_edited,comment_deleted}. The `~` operator compiles
  to `to_tsquery` with `:*` prefix-suffix on each tokenized term, so
  partial typing matches (typing `auth` matches `authentication`).
  Title-weight setweight includes both `wi.title` and `wi.display_key`
  text, so typing partial keys (`BUG`) hits via the same operator.
  NL→JQL translator (`runtime/search/translate.js`) calls Haiku 4.5
  with input cap, per-user/per-instance budgets, output-shape
  filtering, and one-shot retry; every call is logged to
  `runtime.translator_usage`. Anthropic SDK `timeout` MUST be passed
  as the second-arg request option, not in the message body.
  Endpoints: `GET /search`, `GET /search/fields`,
  `POST /search/translate`, `GET|POST|PATCH|DELETE /saved-filters`.
  Work-item picker (related-item linking in `WorkItemDetail`) calls
  `/search` via `searchWorkItems` in `admin-ui/src/lib/api.js` —
  legacy `GET /work-items/search` was retired.
  Custom field keys can't collide with the 28 entries in
  `blueprint.reserved_field_keys` (validated on POST /class-fields,
  POST /type-fields).
- **Bulk operations:** `POST /admin/api/work-items/bulk/transition` and `/bulk/assign` accept
  `{ ids: [...], ... }` and return `{ results: [{id, success, error?}, ...] }`. Each item
  routes through the existing two-phase transition engine — exits criteria still gate each
  transition; partial success is correct. Board multi-select uses a `selectMode` state toggle
  in `Board.jsx`; `BulkActionBar.jsx` renders at bottom of board viewport.
- **Comment edit/delete:** `PATCH /work-items/:id/comments/:commentId` (body, author-or-admin,
  sets `is_edited=true`) and `DELETE` (cascade-deletes replies first). Both emit
  `work_item.comment_edited` / `work_item.comment_deleted` in-tx. `author_user_id` is included
  in the GET comments response so the UI can gate the edit/delete affordance client-side.
- **Attachments:** `runtime.attachments` (migration 015) holds files (`kind='file'`,
  bytes via pluggable storage adapter — local fs in v1, S3 designed not built)
  and links (`kind='link'`). Per-file size limit from
  `FLOWOS_MAX_ATTACHMENT_MB` env var (default 25). Endpoints under
  `/admin/api/work-items/:id/attachments`: `GET` (list), `POST`
  (multipart=file, JSON body=link), `GET .../:attId/download` (streams
  with Content-Disposition; CTL chars stripped from filename), `DELETE
  .../:attId` (uploader OR admin only; reacts to `deleteAttachment`
  helper's race-aware return). Two events
  `work_item.attachment_added` / `work_item.attachment_removed` flow
  through the existing event pipes: search-index subscriber concatenates
  filenames + link titles + URLs into the D-weight `custom_text`;
  audit-trail (`workItemHistory.js`) renders `attached X` / `removed
  attachment X` summaries. Storage path layout: `<rootDir>/<aa>/<uuid>`
  (2-char shard). **Stage-evidence requirements are NOT built yet** —
  that's a follow-up plan; attachments today have no exit-criteria
  semantics.

---

## Key Files

| File | Purpose |
|------|---------|
| `api/server.js` | Entry point, auth middleware, route mounting |
| `admin/api.js` | ~80 REST endpoints (board, CRUD, transitions, simulation, search, saved filters) |
| `runtime/transitions.js` | Two-phase transition engine |
| `runtime/exitCriteria.js` | Exit criteria evaluation (3-tier: manual/codified/api) |
| `runtime/workItems.js` | Work item CRUD + display key generation |
| `core/auth.js` | Session middleware, requireAuth, bcrypt password hashing |
| `core/uri.js` | Global URI generation (`flowos://org-slug/entity-type/uuid`) |
| `db/postgres.js` | PG connection pool |
| `admin-ui/src/lib/api.js` | All frontend API calls (~55 endpoints) |
| `admin-ui/style/README.md` | **UI style guide — read before any frontend changes** |
| `core/events.js` | Event emission + post-commit nudge |
| `runtime/eventProcessor.js` | Advisory lock, drain loop, subscriber registry |
| `runtime/subscribers/*.js` | Event subscribers (neo4j-sync, audit-log, notifications) |
| `runtime/deliveryWorker.js` | Notification delivery outbox drain (separate lock) |
| `runtime/channels/*.js` | Webhook/email/agent dispatch modules |
| `runtime/notifications/*.js` | Matrix, summaries, mentions, ownership challenge |
| `runtime/workItemHistory.js` | Audit trail query (events + edits + actor enrichment) |
| `runtime/search/jql.js` | JQL parser API (parse, JQLSyntaxError, JQLSemanticError) |
| `runtime/search/jqlCompiler.js` | AST → parameterized SQL with access scope |
| `runtime/search/fieldCatalog.js` | Native + visible-custom field metadata, 60s cache |
| `runtime/search/translate.js` | Haiku NL→JQL with budget + abuse hardening |
| `runtime/subscribers/searchIndex.js` | Maintains runtime.work_item_search tsvector |
| `scripts/backfillSearchIndex.js` | One-shot backfill of work_item_search |
| `admin-ui/src/pages/SearchPage.jsx` | Search page shell with JQL editor + saved filters |
| `runtime/attachments.js` | Attachment CRUD + event emission |
| `core/storage/index.js` | Storage adapter factory; size limit constant |
| `core/storage/localStorage.js` | Local filesystem storage adapter |
| `admin-ui/src/components/AttachmentsList.jsx` | Attachments list rendering |
| `admin-ui/src/components/AttachmentUpload.jsx` | File / camera / link upload UI |
| `admin-ui/src/components/BulkActionBar.jsx` | Bulk action toolbar (transition/assign N items) |

---

## UI Design System

**Read `admin-ui/style/README.md` before making any frontend changes.**
The style guide has been split into section files in `admin-ui/style/`.

Key rules: no top bar (logo in sidebar), one overlay pattern (right-side drawer, no modals),
cartography light theme (warm parchment, forest green primary), all sans-serif Inter,
3 font sizes only (`text-xs` body, `text-sm` titles), Tufte-density encoding
(symbols/color/position, not sprawl).

---

## Project-Specific Rules

These supplement the cross-project rules in `~/documents/ai/CODING-STYLE.md`.

### Do

- **ES modules everywhere.** `import`/`export`, never `require()` (except tailwind.config.js)
- **Parameterize all SQL.** No string interpolation in queries. Ever.
- **Two-schema discipline.** Blueprint = structure. Runtime = instances. Don't cross them.
- **Timestamps are sacred.** Stage entry/exit times drive all flow metrics. Never
  back-fill, estimate, or manually set timestamps.
- **Gates vs. side effects.** Exit criteria GATE transitions. Transition actions execute
  as SIDE EFFECTS after commit. Never conflate them.
- **Run `npx eslint .`** before declaring any task complete.
- **Functional components only** in React. No class components.
- **Component files under 200 lines.** Extract sub-components when they grow.

### Don't

- **Don't touch applied migrations.** Create a new migration file instead.
  Migrations must be idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- **Don't break the two-phase transition model.** Prepare evaluates criteria and
  returns state. Execute commits the transition. No shortcuts.
- **Don't add `font-mono` anywhere.** The style guide forbids it.
- **Don't use arbitrary font sizes.** Only `text-xs` (12px) and `text-sm` (14px).
- **Don't add modals.** The only overlay pattern is the right-side drawer.
- **Don't bypass `requireAuth` middleware** on new endpoints unless they're explicitly
  public (intake forms, auth routes).
- **Don't seed Neo4j yet.** The sync queue fills but isn't drained. Don't attempt to
  fix this unless specifically asked.

---

## Design Constraints (non-negotiable)

These come from the design doc. When a product decision conflicts, the principle wins.

| Principle | Rules Out |
|-----------|-----------|
| Pull, not push | Auto-advancing items without downstream capacity |
| WIP limits expose problems, not prevent work | Silent enforcement |
| Policies over process steps | Fixed mandatory sequences |
| Classes of service are first-class | Treating all work the same |
| The system signals its own problems | Silent failure of any kind |
| The workflow is measured, not the worker | Individual productivity tracking |

---

## Reference Documents

For deep architecture details, read these on demand — not every session:

- **`ARCHITECTURE.md`** — Database schema, core model decisions (URI, workflows,
  stages, sub-states, transitions, board model), what's built vs. planned, session log
- **`admin-ui/style/README.md`** — UI style guide (split into section files in `style/`)
- **`flowos-design-doc.docx`** — Full design document (~950 paragraphs)
- **`PRODUCT_PLAN.md`** — Product plan and backlog (renamed from ROADMAP.md)

---

## Planning & Status

- **Git:** `christulino/flowos` (private, will go public on release)
- **Open source release blockers:** Cross-instance service requests, seed-and-go
  experience, README + LICENSE
- **Current state:** 60+ PG tables, 16 migrations, 90+ API endpoints, 20+ React pages,
  auth working, intake forms working, exit criteria engine working, notifications working,
  per-item audit trail working, search v1 (JQL + Haiku translator + saved filters) working,
  attachments v1 working, **bulk operations working, comment edit/delete working — all 7 Tier-1 go-live blockers DONE**
- **See `ARCHITECTURE.md`** for the full "what's built / what's not" breakdown
