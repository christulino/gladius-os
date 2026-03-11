# Flow OS — Project Context (CLAUDE.md)

> This file is read automatically by Claude Code on session start.
> It is the source of truth for project context. Update at the end of every working session.
> Last updated: 2026-03-10 (Session 6)

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
│   │   ├── App.jsx         # Sidebar nav, 14 pages
│   │   ├── lib/api.js      # All API calls (~40 endpoints)
│   │   ├── lib/utils.js    # cn(), formatElapsed(), formatRelative()
│   │   ├── hooks/useApi.js
│   │   ├── components/     # FormDrawer, Panel, WorkItemCard, WorkItemDetail,
│   │   │                   # ServiceLibrary, ColorPicker, shadcn ui components
│   │   └── pages/          # Board, Summary, Organizations, WorkItems, Workflows,
│   │                       # WitClasses, WitTypes, WorkflowManager, Users,
│   │                       # History, RawTables, LogViewer, DbConsole
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
├── admin/                  # Legacy admin HTML (being replaced by admin-ui)
├── docker-compose.yml      # PostgreSQL + Neo4j
├── fix_blueprint_tables.sql  # Already applied — keep for fresh setup
├── fix_schema.sql            # Already applied — keep for fresh setup
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
- `work_items` — instances with sub_state, is_draft, resolution, service_class_id, spawn_state
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

### Sub-States — 3 values only
`ready | in-progress | blocked` — icon glyphs on cards, never columns.
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

## Service Classes (v1)

Fields: name, color, sort_order, cost_of_delay_profile (enum: expedite / fixed-date /
standard / intangible), sla_hours, sla_warning_pct.

The `cost_of_delay_profile` enum is architectural — it determines how the system
interprets aging, scheduling, and metrics. Adding it later requires retroactive decisions.
Adding other fields later is just adding columns.

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
| Organizations | 1 (system org, slug: 'system') |
| Roles | 5 (owner, admin, member, viewer, external) |
| Service Classes | 4 (Expedited p0, Fixed Date p1, Standard p2, Deferred p3) |
| Work Item Type Classes | 7 (Task, Feature, Bug, Epic, Project, Service Request, Incident) |
| Work Item Types | 7 (one per class) |
| Workflows | 4 (Simple Task, Standard Feature, Bug Triage, Service Request) |
| Stages | 26 total |
| Transitions | ~37 total |

Simple Task Workflow (for test data):
Inbox (id:1) → In Progress (id:2) → Review (id:3) → Done (id:4)
Transition: Inbox → In Progress = transition id 1

Always run `npm run seed:test` after a database reset — prints exact IDs and curl commands.

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

---

## What Is and Isn't Built

### Working
- PostgreSQL schema (blueprint + runtime, ~50 tables)
- Docker Compose environment (PostgreSQL + Neo4j)
- Seed data (orgs, workflows, work item types, service classes, roles)
- Express API — 40+ endpoints including organizations, work items, catalog, board, transitions,
  comments, relationships, search, linking, WIP limits, class fields
- Transition engine — two-phase prepare/execute, spawn actions, api_call fire-and-forget
- Work item creation with pending state, display key generation (prefix.seq)
- React + Vite + shadcn admin UI (cartography light theme, 14 pages):
  Team Board (columns, cards, WIP indicators, org multiselect), Work Item Detail modal
  (inline edit, transitions, comments, linking), Workflow Editor (stages, transitions),
  Service Catalog (WIT Classes with fields, WIT Types with workflow inheritance),
  Raw Tables browser, DB Console, Log Viewer, Summary
- Org-level WIP limits (keyed by stage name, soft/hard enforcement)
- Class-level field definitions with copy-on-create to types
- Work item search by title/display_key, linking (parent/child/related)

### Not Yet Built
- Sub-state transition engine (sub-state toggle works but no history tracking)
- Exit criteria evaluation engine (scaffolded but evaluates as always-pass)
- Trigger/action processing (spawn works, notify/field-update/webhook not yet)
- Neo4j seeding (sync queue fills but not drained)
- Service class swimlanes on board
- Draft submission tray
- Default workflow template seed data
- Metrics and flow data views
- Scheduled work item creation
- Auth middleware (all endpoints use userId = 1 stub)
- Work item type fields seeded (required field validation never blocks)
- Network Board / Highway View

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
3 databases · ~50 PostgreSQL tables · 30+ JS source files · 40+ API endpoints ·
9 seed scripts · 5 SQL schema files + 3 migrations · 5 workflows · 26 stages · 37 transitions ·
React admin UI (14 pages, cartography light theme) · Work item detail modal ·
Transition engine · Display keys · Org WIP limits · Class fields ·
Design document (flowos-design-doc.docx, ~950 paragraphs)
