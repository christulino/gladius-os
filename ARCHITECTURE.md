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
│   ├── inheritance.js      # Org policy inheritance (STUBBED)
│   └── uri.js              # Work item URI generation (WORKING)
├── db/
│   ├── postgres.js         # PG connection pool
│   ├── neo4j.js            # Neo4j driver
│   ├── init/
│   │   ├── blueprint_schema.sql   # v1.2
│   │   └── runtime_schema.sql     # v0.4
│   ├── migrations/         # 001 through 010 (append-only, idempotent)
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
│   └── workItems.js        # Work item runtime operations
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

### PostgreSQL — Blueprint Schema (~31 tables)

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

### PostgreSQL — Runtime Schema (~16 tables)

Work item instances and all activity data. The "what is actually happening" schema.

Key tables:
- `work_items` — instances with sub_state, is_draft, resolution, service_class_id, spawn_state,
  priority, tags, estimate, estimate_unit, started_at, resolved_at, origin, requester_id
- `work_item_history` — full audit trail, immutable, sacred timestamps
- `assignments` — work item ↔ user with role
- `sub_state_history` — sub-state transition log
- `search_index_queue` — Neo4j sync queue

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
5. Neo4j sync → async via search_index_queue

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

---

## What Is and Isn't Built

### Working
- PostgreSQL schema (blueprint + runtime, ~50 tables, 10 migrations)
- Docker Compose environment (PostgreSQL + Neo4j)
- Seed data (enterprise org hierarchy, workflows, types, service classes, roles)
- Authentication (sessions, setup wizard, login/logout, requireAuth)
- Express API (70+ endpoints)
- Public intake forms (field-driven, anonymous submission, tracking numbers)
- Service catalog with admin CRUD and public form toggle
- Transition engine with exit criteria (3-tier evaluation, acknowledgment, waiver)
- React admin UI (18+ pages, cartography theme)
- Board: 3-level columns, drag-to-pan, skeleton loading, swimlanes, split waiting/active
- Work item detail drawer, comments, linking, people management
- Hierarchical WIP limits, class fields, custom field engine, simulation engine
- Org Center (5 section pills: Settings, Catalog, Policies, Members, Workflows)

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
