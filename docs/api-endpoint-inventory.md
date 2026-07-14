# Gladius API — Endpoint Inventory

> Snapshot of the complete HTTP surface after the pivot-strip phase.
> Generated for DEBT.26607 (post-cut endpoint audit), 2026-07-13.
> Source: `api/server.js` (mounts), `admin/api.js`, `api/routes/auth.js`,
> `api/routes/simulation.js`. Regenerate by grepping
> `router\.(get|post|put|patch|delete)\(` in those files.

## Totals

| Source | Mount prefix | Routes | Auth |
|--------|--------------|-------:|------|
| `api/routes/auth.js` | `/auth` | 5 | public |
| `admin/api.js` | `/admin/api` | 159 | `requireAuth` (some also `requireDevTools`) |
| `api/routes/simulation.js` | `/admin/api/simulation` | 8 | `requireDevTools` + `requireAuth` |
| `api/server.js` | (root) | 1 | public (`/health`) |
| **Total** | | **173** | |

**Audit result (DEBT.26607): 0 endpoints deleted.** Count before = 173, count
after = 173. Every pivot-strip cut (intake forms DEBT.26603, `/v1` DEBT.25492,
Neo4j DEBT.25488, email/webhook channels DEBT.25490, service-class + `waiting`
substate FEAT.25491, file attachments FEAT.25493, exit-criteria `api` tier
DEBT.25494, service-catalog `/catalog-items` DEBT.26637) removed its own
endpoints inline as part of that cut. This audit verified no orphaned
cut-feature endpoint remains. See the "Cut-feature verification" section.

---

## Public — Auth (`/auth`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/status` | Session + install status (`multiOrgEnabled`, `devToolsEnabled`) |
| POST | `/auth/setup` | First-run admin bootstrap |
| POST | `/auth/login` | Password login |
| POST | `/auth/logout` | End session |
| GET | `/auth/me` | Current user |

## Public — System (`/`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Postgres health probe |

---

## `/admin/api` (authenticated, 159 routes)

### Org structure & RBAC

| Method | Path |
|--------|------|
| GET / POST | `/org-types` |
| PATCH | `/org-types/:id` |
| GET / POST | `/roles` |
| PATCH | `/roles/:id` |
| GET | `/permissions` |
| GET / PUT | `/role-permissions` |
| GET / POST | `/organizations` |
| PATCH | `/organizations/:id` |
| GET / POST | `/org-members` |
| PATCH / DELETE | `/org-members/:id` |
| GET | `/org-workflows` |
| GET / POST | `/users` |
| PATCH | `/users/:id` |
| GET | `/org-policy-data` |

### Work-item types, classes & custom fields

| Method | Path |
|--------|------|
| GET / POST | `/work-item-type-classes` |
| PATCH | `/work-item-type-classes/:id` |
| GET / POST | `/work-item-types` |
| PATCH | `/work-item-types/:id` |
| GET | `/service-library` (WIT-type catalog for an org) |
| GET / POST | `/class-fields` |
| PATCH / DELETE | `/class-fields/:id` |
| GET / POST | `/type-fields` |
| PATCH / DELETE | `/type-fields/:id` |

### Workflows, stages & transitions

| Method | Path |
|--------|------|
| GET | `/workflows` |
| GET / PATCH | `/workflows/:id` |
| POST | `/workflows` |
| POST | `/workflows/:id/clone` |
| PUT | `/workflows/:id/stages/reorder` |
| POST | `/stages` |
| PATCH / DELETE | `/stages/:id` |
| PATCH | `/transitions/:id` |
| GET / POST | `/transition-roles` |
| DELETE | `/transition-roles/:id` |
| GET / POST | `/transition-actions` |
| PATCH / DELETE | `/transition-actions/:id` |
| GET / POST | `/exit-criteria` |
| PATCH / DELETE | `/exit-criteria/:id` |
| GET / POST | `/stages/:stageId/playbook` |

### Board & work items

| Method | Path |
|--------|------|
| GET | `/board` |
| GET / POST | `/work-items` |
| GET / PATCH | `/work-items/:id` |
| POST | `/work-items/:id/substate` (`active` / `blocked`) |
| GET | `/work-items/:id/transitions` |
| GET | `/work-items/:id/transition/prepare` |
| POST | `/work-items/:id/transition` |
| POST | `/work-items/bulk/transition` |
| POST | `/work-items/bulk/assign` |
| GET | `/work-items/:id/exit-criteria-status` |
| GET | `/work-items/:id/exit-criteria` |
| POST / DELETE | `/work-items/:id/exit-criteria/:criteriaId/acknowledge` |
| POST | `/work-items/:id/exit-criteria/:criteriaId/waive` |
| GET | `/work-items/:id/staleness` |
| GET | `/transition-history` |

### Comments & history

| Method | Path |
|--------|------|
| GET / POST | `/work-items/:id/comments` |
| PATCH / DELETE | `/work-items/:id/comments/:commentId` |
| GET | `/work-items/:id/history` |

### Attachments (link-only)

| Method | Path |
|--------|------|
| GET / POST | `/work-items/:id/attachments` |
| DELETE | `/work-items/:id/attachments/:attId` |

### User relationships & item links

| Method | Path |
|--------|------|
| GET / POST | `/work-items/:id/relationships` (people watching/assigned) |
| DELETE | `/work-item-relationships/:id` |
| GET / POST | `/work-items/:id/links` (item-to-item) |
| DELETE | `/work-items/:id/links/:targetId` |

### Acceptance criteria

| Method | Path |
|--------|------|
| GET / PUT | `/work-items/:id/acceptance-criteria` |

### WIP limits

| Method | Path |
|--------|------|
| GET / PUT | `/org-wip-limits` |
| DELETE | `/org-wip-limits/:id` |
| PUT | `/org-wip-class-limits` |
| DELETE | `/org-wip-class-limits/:id` |

### Lookup lists

| Method | Path |
|--------|------|
| GET / POST | `/lookup-lists` |
| PATCH | `/lookup-lists/:id` |
| GET / POST | `/lookup-lists/:listId/values` |
| PATCH | `/lookup-values/:id` |
| PUT | `/lookup-lists/:listId/values/reorder` |

### Reports & dashboards

| Method | Path |
|--------|------|
| GET | `/reports/throughput` |
| GET | `/reports/cycle-time-by-stage` |
| GET | `/reports/aging-wip` |
| GET | `/summary` |
| GET | `/dashboard` |

### Search & saved filters

| Method | Path |
|--------|------|
| GET | `/search/fields` |
| GET | `/search` |
| POST | `/search/translate` |
| GET / POST | `/saved-filters` |
| GET / PATCH / DELETE | `/saved-filters/:id` |

### Notifications

| Method | Path |
|--------|------|
| GET | `/notifications` |
| PATCH | `/notifications/:id/read` |
| POST | `/notifications/mark-read` |
| GET / PUT | `/notification-preferences` |
| GET | `/notification-deliveries` |
| POST | `/notification-deliveries/:id/retry` |

### Events & subscribers

| Method | Path |
|--------|------|
| GET | `/events` |
| GET | `/event-subscribers` |
| POST | `/event-subscribers/:name/pause` |
| POST | `/event-subscribers/:name/skip-past/:eventId` |

### Context & AI (journal, org context, playbooks, models)

| Method | Path |
|--------|------|
| GET / POST | `/work-items/:id/context-entries` |
| PATCH / DELETE | `/work-items/:id/context-entries/:entryId` |
| POST | `/work-items/:id/context-entries/:entryId/resolve` |
| POST | `/work-items/:id/context-entries/:entryId/reopen` |
| GET | `/work-items/:id/assembled-context` |
| GET | `/organizations/:orgId/session-context` |
| GET / POST | `/organizations/:orgId/context` |
| PATCH / DELETE | `/organizations/:orgId/context/:id` |
| PATCH / DELETE | `/organizations/:orgId/playbooks/:id` |
| POST | `/organizations/:orgId/playbooks/ai-assist` |
| GET / POST | `/organizations/:orgId/ai-models` |
| PATCH / DELETE | `/organizations/:orgId/ai-models/:id` |
| GET | `/work-items/:id/stage-playbook` |
| GET | `/work-items/:id/playbook-runs` |

### Generic edit, avatar & MCP

| Method | Path |
|--------|------|
| PATCH | `/edit/:entityType/:id` |
| GET | `/edit/rules` |
| POST | `/upload/avatar` |
| GET | `/mcp/tools` |

### Dev-tools-gated (`requireDevTools`)

| Method | Path |
|--------|------|
| GET | `/tables` |
| GET | `/tables/:schema/:table` |
| POST | `/query` |
| GET | `/logs` |
| GET | `/logs/stream` |

---

## `/admin/api/simulation` (dev-tools-gated, 8 routes)

| Method | Path |
|--------|------|
| POST | `/start` |
| POST | `/stop` |
| POST | `/pause` |
| POST | `/resume` |
| PUT | `/speed` |
| GET | `/status` |
| GET | `/stream` |
| GET | `/activity` |

---

## Cut-feature verification (DEBT.26607)

Each pivot-strip cut was swept; no orphaned endpoint remains.

| Cut feature | Cut item | Endpoint residue found |
|-------------|----------|------------------------|
| Public intake forms | DEBT.26603 | None. `api/routes/forms.js` deleted; no `/forms` or `/intake` routes. |
| Service catalog `/catalog-items` | DEBT.26637 (#67) | None. No CRUD routes; not re-introduced. |
| `/v1` API surface | DEBT.25492 | None. No `/v1` routes anywhere. |
| Neo4j graph queries | DEBT.25488 | None. No graph/neo4j endpoints. |
| Email / webhook notification channels | DEBT.25490 | None. `runtime/channels/` = `agent.js` only; `notification-preferences` is channel-agnostic (DB CHECK = `in_app`/`agent`). |
| Service-class + `waiting` substate | FEAT.25491 | None. `/service-library` returns `work_item_types` (kept, 3 UI callers); `POST /work-items/:id/substate` restricted to `active`/`blocked`. |
| File attachments | FEAT.25493 | None. No `multer` / `/download` / `core/storage`; attachment endpoints are link-only. |
| Exit-criteria `api` tier | DEBT.25494 | None. `ALLOWED_CRITERIA_TIERS = ['manual','codified']`; POST/PATCH reject `api`. |

**Kept-ambiguous (not endpoints):** the dev-tools raw-table browser allowlist in
`admin/api.js` still lists `blueprint.service_classes` and
`blueprint.service_catalog_items`. Those are retained tables (no schema drops per
FEAT.25493 precedent), reachable only via the `requireDevTools`-gated
`/tables/:schema/:table` browser. A future table-vocabulary cleanup could trim the
two allowlist entries; it is out of scope for an endpoint audit.
