# Flow OS — Project Context (CLAUDE.md)

> This file is read automatically by Claude Code on session start.
> It is the source of truth for project context. Update at the end of every working session.
> Last updated: 2026-03-16 (Session 15 — Unified policies, stage rules, hierarchical WIP)

---

## Vision

A universal work operating system where every organization exposes services, every request
flows through a consistent stage taxonomy, all work is connected top-to-bottom without
limit, and the board visualizes flow health — not human productivity.

This is not another Jira. The fundamental mental model is different:
- Work is a **flow system**, not a task list
- Organizations are **service meshes**, not just containers
- The board is a **health monitor**, not a status tracker
- Timing is a **first-class citizen**, not a report you run
- We watch the **work move**, not the people doing it
- The system is **fractal / self-similar** — same structures work for one team or 50,000 people

Built on sound theoretical foundations: Ohno/TPS, Anderson/Kanban Method,
Burrows/Kanban from the Inside. See Appendix A of flowos-design-doc.docx for the full
intellectual foundation and the eight design constraints that serve as absolute rules.

---

## Design Philosophy

- **Lean/Kanban first** — visualize and optimize flow above all else
- **Friction is the enemy** — every interaction must be as lightweight as possible
- **No required assignee** — work items are the unit of measurement, not people
- **Architecture over velocity** — the logical model must be correct before building
- **Timing everywhere** — stage entry/exit timestamps are sacred. Flow metrics always visible, always current, never manually entered
- **Gates vs. side effects are always distinct** — exit criteria GATE transitions. Transition actions execute as SIDE EFFECTS. Never conflate them
- **Inheritance over explicit configuration** — child orgs inherit from parents. Walk up the tree
- **Policies over process steps** — workflows are sets of policies, not sequences of mandatory activities
- **The workflow is measured, not the worker** — assignee data exists for routing and coordination, not surveillance

---

## UI Design System

**The complete UI style guide lives in `admin-ui/current-style.md`.** Read it before making any frontend changes.

Key rules (see style guide for full detail):
- **No top bar** — logo/app name in sidebar
- **One overlay pattern: the right-side drawer** — pushes content left, no modals, no inline panels
- **Cartography light theme** — warm parchment, forest green primary, higher contrast than typical soft themes
- **All sans-serif (Inter)** — no `font-mono` anywhere
- **3 font sizes only** — `text-xs` (12px) for body, `text-sm` (14px) for titles. No arbitrary pixel sizes.
- **Board is primary** — compact cards with four-corner encoding (icon, assignee, key+timer, status indicators)
- **Sidebar nav groups:** Board, Catalog (Orgs, Types), Configure (Workflows, Classes), Admin (Users, Roles), Reports, Dev Tools
- **Tufte density** — encode info in symbols/color/position, not sprawl

---

## Technology Stack

- **Runtime:** Node.js (ESM, v24)
- **Architecture:** Modular, loosely coupled JS files
- **API:** Express REST
- **Database:** Polyglot persistence — PostgreSQL + Neo4j
- **Object Storage:** S3-compatible (MinIO locally) — for evidence binaries
- **Frontend:** React + Vite + shadcn/ui (cartography light theme), served at /admin/
- **Platform:** MacBook Air, local development first

---

## Repository Structure

```
flowos/
├── CLAUDE.md               # This file — read first
├── api/                    # Express API server
│   ├── server.js           # Entry point, serves React build at /admin/
│   └── routes/
│       ├── organizations.js
│       ├── workItems.js    # CRUD + prepare/execute transition
│       ├── catalog.js
│       └── board.js
├── admin-ui/               # React + Vite + shadcn/ui admin interface
│   ├── src/
│   │   ├── App.jsx         # Sidebar nav, 14+ pages
│   │   ├── lib/api.js      # All API calls (~45 endpoints)
│   │   ├── lib/utils.js    # cn(), formatElapsed(), formatRelative()
│   │   ├── hooks/useApi.js
│   │   ├── components/     # FormDrawer, Panel, WorkItemCard, WorkItemDetail,
│   │   │                   # ServiceLibrary, OrgSelector, ColorPicker, shadcn ui
│   │   └── pages/          # Board, Summary, Organizations, WorkItems, Workflows,
│   │                       # WitClasses, WitTypes, WorkflowManager, Users,
│   │                       # History, RawTables, LogViewer, DbConsole,
│   │                       # Reports, Simulation
│   ├── vite.config.js      # base: '/admin/' — required for Express serving
│   └── tailwind.config.js  # uses require() not import() — jiti compatibility
├── core/                   # Shared business logic
│   ├── access.js           # Visibility rules engine (STUBBED — always returns true)
│   ├── calendar.js         # Business calendar utilities (STUBBED)
│   ├── inheritance.js      # Org policy inheritance (STUBBED)
│   └── uri.js              # Work item URI generation (WORKING)
├── db/
│   ├── postgres.js         # PG connection pool
│   ├── neo4j.js            # Neo4j driver
│   ├── init/
│   │   ├── blueprint_schema.sql   # v1.2
│   │   └── runtime_schema.sql     # v0.4
│   ├── migrations/
│   │   ├── 002_org_types_permissions.sql
│   │   ├── 003_workflow_enhancements.sql
│   │   └── 004_org_wip_and_class_fields.sql
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
│   └── engine.js           # Random work item creation + transitions
├── admin/                  # Admin API routes (mounted at /admin/api)
│   └── api.js              # ~50 endpoints: board, CRUD, transitions, simulation
├── docker-compose.yml      # PostgreSQL + Neo4j
├── fix_blueprint_tables.sql  # Already applied — keep for fresh setup
├── fix_schema.sql            # Already applied — keep for fresh setup
├── tests/                  # API integration tests (require running server)
└── package.json
```

---

## Running the System

```bash
# Start databases
docker-compose up -d

# Install dependencies
npm install

# Seed the database
node db/seeds/seed.js

# Start API server (port 3000)
node api/server.js

# Admin UI dev server (port 5173, proxies to 3000)
cd admin-ui && npm run dev

# Build admin UI for production serving
cd admin-ui && npm run build
# Then access at http://localhost:3000/admin/
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
Four graphs:
- Work item relationship graph (parent/child/spawned/origin chains)
- Org hierarchy tree
- User context graph
- Blocking chain analysis

Neo4j is populated via sync queue from PostgreSQL. It is read-only from the API.
PostgreSQL is the source of truth.

---

## Core Model Decisions (locked)

### Global URI Addressing
Every entity has a globally unique, stable URI from creation:
`flowos://org-slug/entity-type/uuid`

Local DB primary keys are internal only. URIs are the public, cross-system identity.
Required for federation, gossip, external references.

Valid entity types: orgs, work-items, users, workflows, stages, work-item-types,
service-classes, connections, transitions, criteria

### Workflow as Directed Graph
Stages are nodes, transitions are directed edges. Multiple outbound transitions from any
stage. Non-linear workflows are first-class. `transition_kind`: forward | backward |
sideways | cross-workflow.

### Stage Classes — Universal Vocabulary
Every stage belongs to a class regardless of what the team names it:
`intake | triage | queued | in-progress | blocked | review | approved | delivery | done | cancelled`

This enables cross-workflow board visibility. "QA Testing" and "Legal Approval" are both
`review` class — they normalize to the same column on a cross-org board.

### Sub-States — 3 values + waiting
`active | blocked | waiting` — icon glyphs on cards, never columns.
`waiting` = item has arrived at a stage with `has_waiting_queue = true` but hasn't been
pulled to active yet. Transition engine sets substate automatically based on destination
stage's `has_waiting_queue` flag.
Blocked items do not consume WIP capacity (intentional — encourages resolving blockers).

### Draft is a creation-time flag, not a sub-state
Drafts live in a submission tray outside the board. They enter the workflow at intake
on submission. Draft lifecycle: age indicators at 3d (amber) and 7d (red), optional
auto-expiry, login nudge badge.

### Resolution is a terminal annotation
Applied when work reaches a done or cancelled stage:
completed | cancelled-superseded | cancelled-deprioritized | cancelled-out-of-scope |
discarded-duplicate | discarded-not-viable | discarded-no-action
Discard rate is a Kanban health signal.

### Intake is the only structurally special stage
Universal entry point. Can be renamed but not deleted.
Minimal viable workflow: Intake → Done.

### Work Item Creation — Pending State
Missing required fields → `spawn_state: 'pending'`, `pending_missing_fields: [...]`
All required fields present → `spawn_state: 'active'`
Never rejects on missing fields — item enters system and can be completed later.

### Exit Criteria — Three Tiers
1. **Manual** — human evaluated, system tracks acknowledgment
2. **Codified** — system evaluates condition (field value, child items terminal, checklist complete)
3. **API** — external call returns condition, system allows/blocks transition

Exit criteria OWN all blocking logic. Transition actions never block.

### Transition Actions — Always Fire-and-Forget (after commit)
- `api_call` — HTTP request, logged, never blocks
- `spawn` — creates work item in target org, inside transaction (fatal on failure)
- `optional_spawn` — user prompted BEFORE transition fires; decision included in execute call

### Transition Engine — Locked Decisions
1. API exit criteria failure → **blocks** transition (treated as criteria not met)
2. Optional spawn prompt → **before** transition fires (user decides first)
3. Spawn action failure → **rolls back** entire transition (fatal)
4. api_call actions → **fire and forget** after commit (never blocks)
5. Neo4j sync → **async** via search_index_queue (never blocks response)

### Child Work Item Creation — Two Patterns
1. **System-spawned** — deterministic, created by trigger/action rules at transition time.
   Type and target org pre-specified in workflow config.
2. **User-initiated (ad-hoc decomposition)** — human attaches new work item to any
   in-flight parent at any time. Any accessible type, any accessible org.
   Supports the project Kanban pattern.

Both use the same parent-child relationship in the graph.

### Display Key
Every work item gets a human-readable key at creation: `PREFIX.SEQ` (e.g. `BUG.42`).
Prefix comes from `work_item_types.key_prefix`. Sequence uses a single PostgreSQL
sequence (`runtime.work_item_seq`). Searchable, shown on cards and in detail view.

### Org-Level WIP Limits
WIP limits are keyed on `stage_name` string in `blueprint.org_wip_limits`.
"Stages with the same name = same stage on the board." Renaming a stage breaks the
association (acceptable: admin-level action). Default enforcement is "soft" per design
constraint: WIP limits expose problems, not prevent work.

### Class Field Inheritance
Class fields (`blueprint.work_item_class_fields`) are copied to type fields on type
creation. Changes to class fields do not auto-propagate to existing types.

---

## Board Model

### Three Views

| View | Purpose | Density | Status |
|------|---------|---------|--------|
| Team Board | Walk the board, pull work forward, daily flow | Medium — text visible, scrollable | v1 |
| Network Board | Cross-org view, relationship topology, program health | Low — icons, filters prominent | v1 |
| Highway View | Visual pulse of entire system, connection arcs | Experimental | v2 |

Network Board and Highway View are the same renderer at different density/zoom levels.

### Team Board Specifics
- Right-aligned by default — Done columns always visible
- Team walks right to left (pull forward from done) — canonical Kanban practice
- Right-to-left / left-to-right is an on-screen toggle
- Horizontally scrollable — CSS overflow, browser handles layout, no JS calculation needed
- Card icon encoding: shape = work item type, fill = ownership (solid = mine, hollow = other org),
  glyph = sub-state (↻ in-progress, ✕ blocked, no glyph = ready)
- Connection indicator on cards with relationships — click to open relationship view
  (does not flood board with lines)
- Live filter toolbar: blocked, over-average age, assigned to me, type, org, class of service
- Service class swimlanes always visible on board

### Board Column Hierarchy (3 levels)
Board columns are real workflow stages, not flattened stage_class buckets.

- **L1: Stage Class** — spanning header ("In Progress", "Review"). Only shown when a class
  has 2+ child stage columns. Collapsed (hidden) when class has exactly 1 stage.
- **L2: Workflow Stage** — actual stage names ("In Development", "In Fix", "Designing").
  Stages with the same name AND same stage_class across workflows are merged into one column.
  Stage header shows name + WIP indicator (editable).
- **L3: Waiting Queue** — stages with `has_waiting_queue = true` render as split columns
  (220px + 220px = 440px). Left half = "Ready for..." (waiting items), right half = active items.
  Stages without waiting queue are 220px single columns.

**API response shape** (`GET /admin/api/board?org_id=X`):
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
  "items": [...],  // current_stage_id = real numeric stage ID
  "wip_limits": {...},
  "service_classes": [...]
}
```

Items keep their real `current_stage_id`. Frontend maps items to columns via `stage_ids` array.
Items with `current_substate = 'waiting'` render in the left (waiting) half of split columns.

**Pull button**: waiting-state cards show a `→` hover button. Click sets substate to `active`
via `POST /admin/api/work-items/:id/substate`. Allowed substates: `active | blocked | waiting`.

### Work Item Detail View — Hierarchy Navigator
When user clicks a work item: shows focus item, parent chain, siblings, children, cross-org spawns.
All nodes show: current stage, stage class, SLA status, service class, spawn state, owning org.
Permission boundary: show "X more items exist but are not visible to you" — never silently truncate.

Primary Neo4j queries:
```cypher
// Parent chain
MATCH path = (ancestor:WorkItem)-[:DECOMPOSES_INTO*]->(w:WorkItem {uri: $uri})
RETURN ancestor, length(path) AS depth ORDER BY depth DESC

// All descendants
MATCH (w:WorkItem {uri: $uri})-[:DECOMPOSES_INTO|SPAWNED*]->(descendant:WorkItem)
RETURN descendant

// Cross-org spawned (both directions)
MATCH (w:WorkItem {uri: $uri})-[:SPAWNED]->(spawned:WorkItem) RETURN spawned
MATCH (origin:WorkItem)-[:SPAWNED]->(w:WorkItem {uri: $uri}) RETURN origin
```

---

## Service Classes — Derived, Not Selected

Class of service is **derived from natural fields** on each work item, never explicitly
selected by the user. The user never needs to learn Kanban vocabulary.

| Input | Derived Class |
|-------|---------------|
| `is_expedited = true` | **Expedite** — drop everything |
| `due_date IS NOT NULL` | **Fixed Date** — has a deadline |
| `work_nature = 'improvement'` | **Deferred** — pull when capacity allows |
| none of the above | **Standard** — committed delivery work |

Columns on `runtime.work_items`:
- `due_date TIMESTAMPTZ` — optional, shown on card when set
- `is_expedited BOOLEAN DEFAULT FALSE` — urgency checkbox
- `work_nature TEXT DEFAULT 'delivery'` — `'delivery'` or `'improvement'`

The derived class is computed in SQL via CASE expression in board and detail queries.
Board cards show accent color by derived class (red/amber/green/gray).
Fixed-date cards always show the due date, even if it makes the card taller.

The legacy `service_classes` table and `service_class_id` FK still exist for backward
compatibility but are no longer used in the creation flow or card display.

WIP allocation per class, spillover policies, and inheritance model are v2.

---

## Default Workflow Templates (to be seeded)

Named, opinionated workflow configurations. Teams can modify after adoption.

- **Service Request** — Intake → Triage → In Progress → Done. Cross-org spawn on triage.
- **Project** — Intake → Planning → In Flight → Review → Done. Child completion exit criteria.
- **Bug / Incident** — Intake → Triage → In Progress → Verification → Done. SLA on triage.
- **Feature Delivery** — Discovery → Scoping → Development → Review → Release. Story spawn.
- **Recurring Operations** — Schedule-driven. Fires directly to In Progress.

---

## Seed Data (current)

| Entity | Count |
|--------|-------|
| Organizations | enterprise hierarchy (system, Acme Corp, Engineering, Product, etc.) |
| Roles | 5 (owner, admin, member, viewer, external) |
| Service Classes | 4 (Expedited p0, Fixed Date p1, Standard p2, Deferred p3) |
| Work Item Type Classes | 7 (Task, Feature, Bug, Epic, Project, Service Request, Incident) |
| Work Item Types | per-org types created from classes |
| Workflows | 5 (Simple Task, Standard Feature, Bug Triage, Service Request, Feature Delivery) |
| Stages | ~30 total (many with `has_waiting_queue = true`) |
| Transitions | ~40 total |

Seed script: `node db/seeds/seed.js` — seeds enterprise org hierarchy, workflows,
types, and optionally test work items via `db/seeds/enterprise/` data files.

---

## Load-Bearing Utilities

| Utility | Location | Status |
|---------|----------|--------|
| `generateUri(orgSlug, entityType)` | core/uri.js | WORKING |
| `calculateWorkingTime(start, end, cal)` | core/calendar.js | NEEDS VERIFICATION |
| `canAccess(userId, resourceType, resourceId, permissionType)` | core/access.js | STUBBED (always true) |
| `resolveOrgCalendar(orgId)` | core/calendar.js | STUBBED |
| `resolveInheritedPolicy(orgId, resourceType)` | core/inheritance.js | STUBBED |
| `syncToGraph(entityType, uri, operation, data)` | graph/sync.js | STUBBED |
| `getWorkItemHierarchy(workItemUri, userId)` | graph/hierarchy.js | STUBBED |

---

## Schema History — Known Issues Fixed

1. **Table ordering bug** — `replenishment_policies` referenced `workflows`/`stages` before defined.
   Fixed in blueprint_schema.sql v1.2.
2. **Broken ALTER TABLE** — `fk_org_default_template` missing `ALTER TABLE` prefix. Fixed v1.2.
3. **Missing tables** — `exit_criteria`, `transition_actions`, `connections` not loading.
   Applied via `fix_blueprint_tables.sql` (already applied, keep for fresh setup).
4. **Migration 004** — `org_wip_limits`, `work_item_class_fields`, `work_item_links` tables.
   `key_prefix` on work item types, `sequence_number`/`display_key` on work items.
   Display key format: `PREFIX.SEQ` (e.g. BUG.42). Uses `runtime.work_item_seq` sequence.
5. **Migration 005** — `due_date`, `is_expedited`, `work_nature` on work items.
   Derived class of service computed in queries (expedite/fixed_date/standard/deferred).
6. **Migration 006** — `priority`, `tags`, `estimate`, `estimate_unit`, `started_at`,
   `resolved_at`, `origin`, `requester_id` on work items. Native fields for query
   performance. GIN index on tags. `started_at` set automatically on first transition
   out of intake/queued. `resolved_at` set on terminal stage entry, cleared on backward transition.
7. **Migration 007** — Custom field engine: lookup lists, field definitions.
8. **Migration 008** — `done_retention_days` on organizations.
9. **Migration 009** — `org_wip_limits_by_class` table for stage-class-level WIP limits.

---

## What Is and Isn't Built

### Working
- PostgreSQL schema (blueprint + runtime, ~50 tables, 9 migrations)
- Docker Compose environment (PostgreSQL + Neo4j)
- Seed data (enterprise org hierarchy, workflows, work item types, service classes, roles)
- Express API — 60+ endpoints including organizations, work items, catalog, board, transitions,
  comments, relationships, search, linking, WIP limits, class fields, simulation,
  exit criteria CRUD, transition actions CRUD, role restrictions, policy data aggregation
- Transition engine — two-phase prepare/execute, spawn actions, api_call fire-and-forget,
  automatic `waiting` substate for stages with `has_waiting_queue`
- Work item creation with pending state, display key generation (prefix.seq)
- React + Vite + shadcn admin UI (cartography light theme, 16+ pages):
  Team Board (3-level column hierarchy, swimlanes, split waiting/active cells, pull button),
  Work Item Detail drawer (inline edit, transitions, comments, linking, urgency/scheduling,
  people management), Workflow Editor (stages, transitions), Organizations (tree view),
  Service Catalog (WIT Classes with fields, WIT Types with workflow inheritance),
  Reports page, Simulation page, Raw Tables browser, DB Console, Log Viewer, Summary
- Board 3-level columns: L1 stage_class headers, L2 merged workflow stages, L3 waiting queues
- Service class swimlanes on board (expedite/fixed_date/standard/deferred/personal)
- Hierarchical WIP limits: stage-class-level + stage-level (both org-scoped, soft/hard)
- Class-level field definitions with copy-on-create to types
- Custom field engine (lookup lists, 10 field types, JSONB storage)
- Work item search by title/display_key, linking (parent/child/related)
- Simulation engine (random work item generation, transitions, configurable pace)
- Org Center: master-detail with Settings, Catalog, Policies, Members, Workflows pills
- Policies section: Board (retention), WIP Limits (hierarchical), Stage Rules
  (exit conditions + transition actions per stage, managed via drawer)
- Exit criteria: manual sign-off, codified system checks, API gates — full CRUD
- Transition actions: spawn work items, optional spawns, API calls — full CRUD
- Acceptance criteria with template seeding from types
- WorkflowPicker component for type→workflow assignment

### Not Yet Built — Roadmap

**Core engine gaps:**
- Exit criteria evaluation engine (scaffolded but evaluates as always-pass)
- Trigger/action processing (spawn works, notify/field-update/webhook not yet)
- Sub-state history tracking (toggle works but no history log)
- Neo4j seeding (sync queue fills but not drained)
- Auth middleware (all endpoints use userId = 1 stub)

**Service catalog & intake:**
- Public service catalog (org exposes requestable services)
- Intake forms (type-specific, field-driven, external-facing)
- Draft submission tray (age indicators, auto-expiry)
- Email/Slack/API intake channels

**Automation & rules:**
- Conditional transition actions ("if type = X then spawn Y")
- Field-update actions on transition
- Scheduled work item creation (recurring operations)
- SLA enforcement (warning thresholds, escalation triggers)
- Notification engine (in-app, email, webhook)

**Queries & reporting:**
- Saved queries / custom filters
- Flow metrics: cycle time, lead time, throughput, WIP age
- CFD (cumulative flow diagram)
- Bottleneck detection / aging analysis
- Org-level and cross-org rollup dashboards
- Export (CSV, PDF)

**Simulation & seed data:**
- Goal-driven simulation agents (persona-based, not random)
- Richer seed data (realistic enterprise scenarios)
- Simulation scenarios (incident response, feature delivery, service requests)

**Views & visualization:**
- Network Board / Highway View
- Work item hierarchy navigator (Neo4j-backed)
- Timeline / Gantt view for date-driven work

**Platform:**
- Auth (local + SSO via SAML/OIDC)
- Full-text search (tsvector → Elasticsearch)
- Object storage for evidence (MinIO → S3)
- Event bus (async processing, Neo4j sync)
- API versioning / webhook subscriptions

---

## Open Questions

1. **Event sourcing** — full event log for work item state changes vs. current snapshot model?
2. **Org hierarchy depth** — max depth? Performance implications for deep inheritance walks?
3. **Multi-tenancy** — how isolated are orgs at the data layer?
4. **API criteria sandboxing** — who can configure API exit criteria?
5. **Neo4j visualization** — Neo4j Bloom natively vs. custom D3 or Cytoscape.js?
6. **Work item type breaking changes** — when allowed? How are connected orgs notified?
7. **Event bus technology** — Redis pub/sub vs. NATS vs. Node.js EventEmitter. Start simple.
8. **Full-text search** — PostgreSQL tsvector to start, Elasticsearch later?
9. **Object storage** — MinIO locally. Which managed service for production?

---

## Design Constraints (from Appendix A of design doc)

These are not aspirational. When a product decision conflicts with one of these, the principle wins.

| Principle | Rules Out |
|-----------|-----------|
| Pull, not push | Auto-advancing items without downstream capacity |
| WIP limits expose problems, not prevent work | Silent enforcement — violations must be visible |
| Policies over process steps | Fixed mandatory sequences |
| Classes of service are first-class | Treating all work items the same |
| The system signals its own problems | Silent failure of any kind |
| Improvement is everyone's responsibility | Metrics accessible only to admins |
| The workflow is measured, not the worker | Individual productivity tracking |
| Start with what you do now | Forcing process abandonment to use the system |

---

## Session Notes

- Developer: Chris Tulino — Agile coaching, enterprise transformation, PMO leadership, mobile tech
- Preferred style: architectural correctness over velocity; modular Node.js; fix before build
- Git: `christulino/flowos` (private)

### What's been built (across all sessions):
3 databases · ~50 PostgreSQL tables · 40+ JS source files · 60+ API endpoints ·
enterprise seed data · 5 SQL schema files + 9 migrations · 5 workflows · ~30 stages · ~40 transitions ·
React admin UI (16+ pages, cartography light theme, Tufte-inspired style system) ·
3-level board column hierarchy (stage_class → merged stages → waiting queues) ·
Work item detail drawer · Derived class of service · Transition engine with waiting substates ·
Display keys · Hierarchical WIP limits (class + stage) · Class fields · Custom field engine ·
Simulation engine · People management · Comments · Reports page ·
Org Center (5 section pills) · Unified policies (exit criteria + transition actions + WIP) ·
Acceptance criteria · Lookup lists · WorkflowPicker ·
Design document (flowos-design-doc.docx, ~950 paragraphs)
