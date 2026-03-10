# CONTEXT.md — Flow OS Project
> Paste this file at the start of every Claude session to restore full project context.
> Last updated: 2026-03-06 (Session 4)

---

## Project Name
**Flow OS** *(working title)*

---

## Vision Statement
A universal work operating system where every organization exposes services, every request flows through a consistent stage taxonomy, all work is connected top-to-bottom without limit, and the board visualizes flow health — not human productivity.

This is not another Jira. The fundamental mental model is different:
- Work is a **flow system**, not a task list
- Organizations are **service meshes**, not just containers
- The board is a **health monitor**, not a status tracker
- Timing is a **first-class citizen**, not a report you run
- We watch the **work move**, not the people doing it
- The system is **fractal / self-similar** — the same structures work for a single team or a 50,000-person enterprise

---

## Core Design Philosophy
- **Lean/Kanban first** — visualize and optimize flow above all else
- **Friction is the enemy** — every interaction must be as lightweight as possible. Jira has too many fields. We have as few as possible.
- **No required assignee** — work items are the unit of measurement, not people
- **Architecture over velocity** — the logical model must be correct before building. Wrong relationships = full rewrite.
- **Open and extensible** — the system exposes interfaces other systems and organizations can connect to
- **Timing everywhere** — stage entry/exit timestamps are sacred. Flow metrics are always visible, always current, never manually entered.
- **Prefer atomic primitives over named composite actions** — named actions like "refactor" are just sequences of primitives. Decompose them.
- **Gates vs. side effects are always distinct** — exit criteria GATE transitions. Transition actions execute as SIDE EFFECTS. Never conflate them.
- **Inheritance over explicit configuration** — child orgs inherit from parents. Walk up the tree. Zero-maintenance scaling.

---

## Technology Stack
- **Runtime:** Node.js (ESM, v24)
- **Architecture:** Modular, loosely coupled JS files — each module is essentially independent, communicates by passing full objects and data structures
- **API:** Express REST
- **Database:** Polyglot persistence — PostgreSQL + Neo4j
- **Object Storage:** S3-compatible (MinIO locally) — for evidence binaries
- **IDE:** VS Code with Prettier, ESLint, GitLens, GitHub Copilot
- **Platform:** MacBook Air, local development first
- **Frontend:** TBD — UI/board visualization deliberately deferred pending design brainstorm

---

## Artifact Files
- `blueprint_schema.sql` — v1.2 — PostgreSQL Blueprint schema (fixed table order + FK constraints)
- `runtime_schema.sql` — v0.4 — PostgreSQL Runtime schema
- `neo4j_graph_model.cypher` — v0.2 — Neo4j node/relationship definitions, constraints, indexes, queries, sync strategy
- `flowos/` — Node.js project (see structure below)

---

## Database Architecture

### Decision: Polyglot Persistence — PostgreSQL + Neo4j
**Boundary Rule:** "What are the properties of this thing?" → PostgreSQL. "How is this thing connected to other things?" → Neo4j.

### PostgreSQL — Blueprint Schema (31 tables)
Structural definitions. Empty of actual work. Can be versioned, snapshotted, rolled back independently.
- Organizations, hierarchy, tags, visibility policies
- Users, roles, org memberships, role inheritance
- Work item type classes, work item types, custom field definitions, type relationships
- Workflows, stages, stage transitions, stage transition role restrictions
- Exit criteria (all three tiers), transition actions, connections
- Service catalog items and visibility rules
- Business calendars and working hours
- Replenishment policies, org templates, inheritance policies

### PostgreSQL — Runtime Schema (16 tables)
Work item instances and all activity data.
- Work items (instances, current state, field values, spawn state)
- Stage transition history (immutable, sacred timestamps)
- Substate history, checklist completions, evidence metadata
- Exit criteria status per work item, transition action log
- Work item user relationships, work item comments
- Flow metrics snapshots, org flow metrics aggregates
- Board views, notifications, replenishment log, search index queue

### Neo4j (not yet seeded)
- Work item relationship graph (parent/child/spawned/origin chains)
- Cross-org work item networks
- Work item type version networks
- Workflow directed graphs
- Anything requiring deep traversal or visual network rendering

### Interview Narrative:
> "I used polyglot persistence — PostgreSQL for structured configuration and runtime data, and Neo4j for the work item relationship graph, because deep network traversal and real-time visualization of cross-organizational work cascades were core product requirements that a relational database couldn't serve elegantly."

---

## Key Architectural Decisions (locked)

### Blueprint vs. Runtime Separation
Two PostgreSQL schemas. Blueprint is structural DNA — empty of work. Runtime is the living system. They are versioned independently. A blueprint snapshot can be restored without touching runtime data.

### Global URI Addressing
Every entity has a globally unique, stable URI from creation:
`flowos://org-slug/entity-type/uuid`
Local DB primary keys are internal only. URIs are the public, cross-system identity. Required for federation, gossip, external references.

Valid entity types: orgs, work-items, users, workflows, stages, work-item-types, service-classes, connections, transitions, criteria

### Workflow as Directed Graph
Workflows are not flat status lists. Stages are nodes, transitions are edges. Each transition has an explicit `from_stage` and `to_stage`. `transition_kind`: `forward | backward | sideways | cross-workflow`.

### Stage Classes — Universal Vocabulary
Every stage belongs to a class regardless of what the team calls it:
`intake | triage | queued | in-progress | blocked | review | approved | delivery | done | cancelled`
This enables cross-workflow and cross-team board visibility. "QA Testing" and "Legal Approval" are both `review` class — they normalize on the same board.

### Stage Micro-States
Stages optionally expand into sub-columns without creating new stages in the data model.
Controlled by boolean flags: `has_waiting_queue`, `wip_limit`, `requires_review`, `requires_evidence`, `measure_substates`.

### Exit Criteria — Three Tiers
1. **Manual** — human evaluated, system tracks acknowledgment
2. **Codified** — system evaluates condition (field value, child items terminal, checklist complete)
3. **API** — external call returns condition, system allows/blocks transition

**Critical:** exit criteria OWN all blocking logic. Transition actions never block.

### Transition Actions — Always Fire-and-Forget (after commit)
- `api_call` — HTTP request, logged, never blocks
- `spawn` — creates work item in target org, inside transaction (fatal on failure)
- `optional_spawn` — user prompted BEFORE transition fires; decision included in execute call

### Transition Engine Design Decisions (locked)
1. API exit criteria failure → **blocks** transition (treated as criteria not met)
2. Optional spawn prompt → **before** transition fires (user decides first)
3. Spawn action failure → **rolls back** entire transition (fatal)
4. api_call actions → **fire and forget** after commit (never blocks)
5. Neo4j sync → **async** via search_index_queue (never blocks response)

### Work Item Creation — Pending State
Missing required fields → `spawn_state: 'pending'`, `pending_missing_fields: [...]`
All required fields present → `spawn_state: 'active'`
Never rejects on missing fields — item enters system and can be completed later.

---

## Project Structure

```
flowos/
├── .env
├── package.json
├── docker-compose.yml
├── context.md                     ← this file
│
├── api/
│   ├── server.js                  ← Express app, mounts all routes, initLogger()
│   └── routes/
│       ├── workItems.js           ← CRUD + prepare/execute transition (URI as query param)
│       ├── organizations.js
│       ├── catalog.js             ← stub
│       └── board.js               ← stub
│
├── admin/
│   ├── api.js                     ← admin endpoints: summary, orgs, work-items, workflows,
│   │                                 users, history, raw tables, logs SSE, SQL console
│   ├── logger.js                  ← ring buffer log capture + SSE broadcaster
│   ├── browser.html               ← Admin Data Browser UI (7 tabs)
│   ├── devtools.html              ← DevTools UI (4 tabs)
│   └── TODO.md                    ← admin tooling backlog
│
├── core/
│   ├── uri.js                     ← generateUri() + parseUri()
│   ├── calendar.js                ← resolveOrgCalendar() + calculateWorkingTime()
│   ├── access.js                  ← canAccess() stub — visibility rules engine (TODO)
│   └── inheritance.js             ← resolveInheritedPolicy() (TODO)
│
├── db/
│   ├── postgres.js                ← pg pool: query() + getClient()
│   ├── neo4j.js                   ← Neo4j driver: runQuery / runWriteQuery
│   └── seeds/
│       ├── seed.js                ← system defaults runner
│       ├── seed_test_data.js      ← dev test user + work item, prints curl commands
│       └── data/
│           ├── roles.js
│           ├── serviceClasses.js
│           ├── workItemTypeClasses.js
│           ├── workflows.js
│           └── workItemTypes.js
│
├── graph/
│   ├── sync.js                    ← syncToGraph() — stub, TODO
│   └── hierarchy.js               ← getWorkItemHierarchy() — stub, TODO
│
└── runtime/
    ├── transitions.js             ← prepareTransition() + executeTransition() — WORKING
    ├── exitCriteria.js            ← evaluateExitCriteria() — WORKING
    └── workItems.js               ← createWorkItem() + updateWorkItemFields() — WORKING
```

---

## Running Locally

```bash
docker compose up -d          # start postgres, neo4j, minio
npm run dev                   # start server with --watch on port 3000
npm run seed                  # seed system defaults
npm run seed:test             # seed test user + work item, prints curl commands

open http://localhost:3000/admin      # Admin Data Browser
open http://localhost:3000/devtools   # DevTools (endpoints, sequences, logs, DB console)
open http://localhost:3000/health     # health check
```

---

## API Endpoints

### Work Items (URIs passed as query params — Express can't handle flowos:// in paths)
```
GET   /v1/work-items?uri=flowos://...
POST  /v1/work-items
      body: { work_item_type_id, owner_org_id, title, service_class_id?, parent_id?, field_values?, description? }
PATCH /v1/work-items?uri=flowos://...
      body: { field_values: { key: value } }
GET   /v1/work-items/hierarchy?uri=flowos://...
GET   /v1/work-items/transition/prepare?uri=flowos://...&to_stage_id=N
POST  /v1/work-items/transition
      body: { uri, to_stage_id, reason?, spawn_decisions?: { [actionId]: boolean } }
```

### Organizations
```
GET /v1/organizations
```

### Admin API
```
GET  /admin/api/summary
GET  /admin/api/organizations
GET  /admin/api/work-items
GET  /admin/api/workflows
GET  /admin/api/users
GET  /admin/api/transition-history
GET  /admin/api/tables
GET  /admin/api/tables/:schema/:table
GET  /admin/api/logs
GET  /admin/api/logs/stream          ← SSE live stream
POST /admin/api/query                ← SELECT/EXPLAIN only
     body: { sql }
```

---

## Seed Data (system defaults)

| Entity | Count |
|--------|-------|
| Organizations | 1 (system org, slug: 'system') |
| Roles | 5 (owner, admin, member, viewer, external) |
| Service Classes | 4 (Expedited p0, Fixed Date p1, Standard p2, Deferred p3) |
| Work Item Type Classes | 7 (Task, Feature, Bug, Epic, Project, Service Request, Incident) |
| Work Item Types | 7 (one per class) |
| Workflows | 4 (Simple Task, Standard Feature, Bug Triage, Service Request) |
| Stages | 26 total |
| Stage Transitions | ~37 total |

### Simple Task Workflow (for test data)
Inbox (id:1) → In Progress (id:2) → Review (id:3) → Done (id:4)
Transition: Inbox → In Progress = transition id 1

Always run `npm run seed:test` after a database reset — it prints exact IDs and curl commands for the current database.

---

## Schema History

### Known Issues Fixed
1. **Table ordering bug** — `replenishment_policies` referenced `workflows`/`stages` before they were defined. Fixed in blueprint_schema.sql v1.2.
2. **Broken ALTER TABLE** — `fk_org_default_template` was missing its `ALTER TABLE` prefix. Fixed in v1.2.
3. **Missing tables** — `exit_criteria`, `transition_actions`, `connections` weren't loading. Applied via `fix_blueprint_tables.sql` (one-time, already applied to current db).

### Fix Files (already applied, keep for fresh setup)
- `fix_blueprint_tables.sql` — creates exit_criteria, transition_actions, connections
- `fix_schema.sql` — creates workflows, stages, stage_transitions (older fix)

---

## Load-Bearing Utilities

1. **`generateUri(orgSlug, entityType)`** — globally unique URIs on every entity creation. WORKING.
2. **`calculateWorkingTime(startTs, endTs, calendar)`** — converts timestamps to working-time seconds. Needs verification with real calendar data.
3. **`canAccess(userId, resourceType, resourceId, permissionType)`** — universal visibility rule evaluator. STUBBED (always returns true).
4. **`resolveOrgCalendar(orgId)`** — walks org tree to find effective business calendar. STUBBED.
5. **`resolveInheritedPolicy(orgId, resourceType)`** — walks org tree for inheritance. STUBBED.
6. **`syncToGraph(entityType, uri, operation, data)`** — syncs entity changes to Neo4j. STUBBED.
7. **`getWorkItemHierarchy(workItemUri, userId)`** — Neo4j traversal for Work Item Detail View. STUBBED.

---

## Work Item Detail View — Hierarchy Navigator

When a user clicks a work item on the Kanban board, they see the full hierarchical context.

### What the view shows:
- **Focus item** — center of the view
- **Parent chain** — ancestors up the hierarchy to permission boundary or root
- **Siblings** — other children of the same parent
- **Children** — all descendants downward, any depth
- **Cross-org spawned items** — work this item created in other orgs, and what spawned this item

### All nodes show: current stage, stage class, SLA status, service class, spawn state, owning org

### Permission boundary behavior:
- Check `canAccess()` at each node — stop that branch if it fails
- Show indicator: "X more items exist but are not visible to you"
- Never silently truncate — broken-looking trees destroy user trust

### Primary Neo4j query pattern:
```cypher
// Parent chain
MATCH path = (ancestor:WorkItem)-[:DECOMPOSES_INTO*]->(w:WorkItem {uri: $uri})
RETURN ancestor, length(path) AS depth ORDER BY depth DESC

// Siblings
MATCH (parent:WorkItem)-[:DECOMPOSES_INTO]->(w:WorkItem {uri: $uri})
MATCH (parent)-[:DECOMPOSES_INTO]->(sibling:WorkItem)
WHERE sibling.uri <> $uri RETURN sibling

// All descendants
MATCH (w:WorkItem {uri: $uri})-[:DECOMPOSES_INTO|SPAWNED*]->(descendant:WorkItem)
RETURN descendant

// Cross-org spawned (both directions)
MATCH (w:WorkItem {uri: $uri})-[:SPAWNED]->(spawned:WorkItem) RETURN spawned
MATCH (origin:WorkItem)-[:SPAWNED]->(w:WorkItem {uri: $uri}) RETURN origin
```

### Data source split:
- **Neo4j** — resolves the hierarchy (which items exist, how they relate)
- **PostgreSQL** — fetches full property data for each item
- **Visibility engine** — filters each node before returning to client

---

## Admin Tools

### Admin Data Browser (http://localhost:3000/admin)
Tabs: Summary · Organizations · Work Items · Workflows · Users · Transitions · Raw Tables
- Summary: live counts, sync queue depth
- Workflows: stage flow chips + full transition table
- Raw Tables: browse any whitelisted blueprint/runtime table with pagination

### DevTools (http://localhost:3000/devtools)
Tabs: Endpoints · Sequences · Log Viewer · DB Console

- **Endpoints** — fire any API call, syntax-highlighted JSON response
- **Sequences** — multi-step automated flows (Create→Transition→Done, Create Pending Item)
- **Log Viewer** — SSE live stream, level filters, autoscroll, clear
- **DB Console** — SELECT/EXPLAIN only, Cmd+Enter runs, 6 pre-built snippets

### Admin TODO (see admin/TODO.md)
- Sync Queue monitor with retry button
- Seed data manager (re-run scripts from browser)
- Schema inspector (column definitions)
- Work item detail view (click → inline history + fields)
- Workflow visualizer (node/edge diagram)
- More DevTools sequences (Bug lifecycle, Spawn, Pending→Active, Role restriction test)

---

## Open Questions
1. **Event sourcing** — full event log for work item state changes vs. current snapshot model?
2. **Org hierarchy depth** — max depth? Performance implications for deep inheritance walks?
3. **Multi-tenancy** — how isolated are orgs at the data layer?
4. **API criteria sandboxing** — who can configure API exit criteria?
5. **Neo4j visualization** — Neo4j Bloom natively vs. custom with D3 or Cytoscape.js?
6. **Work item type breaking changes** — when allowed? How are connected orgs notified?
7. **Event bus technology** — Redis pub/sub vs. NATS vs. Node.js EventEmitter. Start simple.
8. **Full-text search** — PostgreSQL tsvector to start, Elasticsearch later?
9. **Object storage** — MinIO locally. Which managed service for production?

---

## What's Not Yet Built
- Neo4j graph not yet seeded — sync queue fills but nothing processes it
- `graph/sync.js` and `graph/hierarchy.js` are stubs
- No auth middleware — all endpoints use `userId = 1` stub
- `canCreate()` always returns true — visibility rules not enforced
- Board endpoint (`/v1/board`) is a stub
- Catalog endpoint (`/v1/catalog`) is a stub
- No work item type fields seeded — required field validation never blocks creation
- `core/calendar.js` working time needs verification with real calendar data
- No background worker processing `search_index_queue`

## Next Up (prioritized)
1. **Neo4j graph seeding** — seed system org + work item type nodes, make sync worker functional
2. **Work item type fields** — seed required fields for Bug type so pending state actually triggers
3. **Board query** — make `/v1/board` return real Kanban data
4. **Admin Browser enhancements** — per admin/TODO.md
5. **Auth middleware** — replace userId = 1 stubs

---

## Session Notes
- Developer: Chris Tulino — Agile coaching, enterprise transformation, PMO leadership, mobile tech (Bank of America)
- Preferred style: architectural correctness over velocity; modular Node.js; fix before build
- Git: `christulino/flowos` (private), all work committed and pushed

### What's been built (2 days):
3 databases · 47 PostgreSQL tables (31 blueprint + 16 runtime) · 26 JS source files · 11 API endpoints · 9 seed scripts · 5 SQL schema files · 4 workflows · 26 stages · 37 stage transitions · 2 internal tools (Admin Browser + DevTools with 4 tabs each)

---
*This file is the source of truth for project context. Update it at the end of every working session.*
