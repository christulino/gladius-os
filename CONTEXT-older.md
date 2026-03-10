# CONTEXT.md — Flow OS Project
> Paste this file at the start of every Claude session to restore full project context.
> Last updated: 2026-03-05

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
- **Runtime:** Node.js
- **Architecture:** Modular, loosely coupled JS files — each module is essentially independent, communicates by passing full objects and data structures via callbacks
- **Why Node.js:** Fits the architectural mindset of independent pieces working together; extensible; developer familiar with it
- **Frontend:** TBD — UI/board visualization is deliberately deferred pending design brainstorm
- **Database:** Polyglot persistence — PostgreSQL + Neo4j (see Database Architecture section)
- **Object Storage:** S3-compatible (MinIO locally) — for evidence binaries (photos, files)
- **IDE:** VS Code with Prettier, ESLint, GitLens, GitHub Copilot
- **Platform:** MacBook Air, local development first

---

## Artifact Files
- `blueprint_schema.sql` — v1.1 — PostgreSQL Blueprint schema (structural definitions)
- `runtime_schema.sql` — v0.4 — PostgreSQL Runtime schema (work item instances and activity)
- `neo4j_graph_model.cypher` — v0.2 — Neo4j node/relationship definitions, constraints, indexes, queries, sync strategy
- `flowos/` — Node.js project scaffold (17 files, see File & Directory Structure section below)

---

## Database Architecture

### Decision: Polyglot Persistence — PostgreSQL + Neo4j

**Boundary Rule:** "What are the properties of this thing?" → PostgreSQL. "How is this thing connected to other things?" → Neo4j.

### PostgreSQL — Blueprint Schema owns:
Structural definitions. Empty of actual work. Can be versioned, snapshotted, rolled back independently.
- Organizations, hierarchy, tags, visibility policies
- Users, roles, org memberships
- Work item type classes, work item types, custom field definitions
- Workflows, stages, stage transitions, stage micro-state settings
- Exit criteria (all three tiers)
- Transition actions (api_call, spawn, optional_spawn)
- Connections and cross-org triggers
- Service catalog items and visibility rules
- Business calendars and working hours
- Replenishment policies
- Org templates and inheritance policies

### PostgreSQL — Runtime Schema owns:
Work item instances and all activity data.
- Work items (instances, current state, field values, spawn state)
- Stage transition history (immutable, sacred timestamps)
- Substate history
- Checklist completions
- Evidence (metadata — binaries in object store)
- Exit criteria status per work item
- Transition action log
- Work item user relationships
- Work item comments
- Flow metrics snapshots (performance cache — rebuildable from history)
- Org flow metrics aggregates
- Replenishment log
- Notifications and notification preferences
- Board views (personal and shared)
- Search index queue

### Neo4j owns:
Relationship graphs, traversal, visualization — not yet designed in detail.
- Work item relationship graph (parent/child/spawned/origin chains)
- Cross-org work item networks (project request cascading to hundreds of downstream items)
- Work item type version networks (exposed interfaces between orgs, like microservice contracts)
- Workflow directed graphs (stages as nodes, transitions as edges)
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

Entities with URIs: organizations, users, work item types, workflows, stages, work items, service catalog items, connections, evidence, board views, visibility rules.

### Workflow as Directed Graph
Workflows are not flat status lists. Stages are nodes, transitions are edges. Each transition has an explicit `from_stage` and `to_stage`. `transition_kind`: `forward | backward | sideways | cross-workflow`. No `refactor` kind — that's handled by atomic primitives (cancel + create + link).

### Stage Classes — Universal Vocabulary
Every stage belongs to a class regardless of what the team calls it:
`intake | triage | queued | in-progress | blocked | review | approved | delivery | done | cancelled`
This is what enables cross-workflow and cross-team board visibility. A "QA Testing" stage and a "Legal Approval" stage are both `review` class — they normalize on the same board.

### Stage Micro-States
Stages optionally expand into sub-columns without creating new stages in the data model:
`[Waiting for X] → [In Progress N/WIP] → [X Done]`
Controlled by boolean flags on the stage: `has_waiting_queue`, `wip_limit`, `requires_review`, `requires_evidence`, `measure_substates`.

### Exit Criteria — Three Tiers
1. **Manual** — human evaluated, system tracks acknowledgment
2. **Codified** — system evaluates condition (field value, child items terminal, checklist complete)
3. **API** — external call returns condition, system allows/blocks transition
Evidence attachment is a fourth gate — enforced separately via stage settings.

**Critical:** exit criteria OWN all blocking logic. This includes checking that child work items of a type are terminal. Transition actions never block.

### Transition Actions — Always Fire-and-Forget
Execute after a transition completes. Never block the parent work item's flow.
Types: `api_call | spawn | optional_spawn | notify`
- `spawn` creates a work item that enters its own intake stage and lives independently. Parent never tracks it.
- `optional_spawn` prompts the user after transition: "Create Release Notes work item?"
- `api_call` fires HTTP request (log, Salesforce event, webhook). `api_on_failure`: `log | retry` only — no `block`.

### Cancel Pattern (replaces "Refactor")
No special "refactor" action type. When a work item needs to become something different:
1. Cancel current item (terminal transition with `requires_reason: true`)
2. Create new work item of correct type
3. Link new item's `origin_work_item_id` to cancelled item
Full history preserved. Parent doesn't wait. Both are atomic primitives.

### Pending Spawn State
When a connection or transition action spawns a work item but required fields are missing, the item is created with `spawn_state: pending`. It appears in the intake stage backlog. A user completes the missing fields, checklist clears, item becomes active. Receiving org can reject it — source work item returns to `rejection_returns_to_stage_id`.

### Service Classes (Kanban)
Every work item has a service class governing how it flows through the system:
- `Expedited` — bypasses WIP limits, max 1 concurrent
- `Fixed Date` — SLA is date-driven
- `Standard` — default FIFO
- `Deferred` — fills spare capacity
Defined in blueprint, attached to work item instances at runtime. `priority_order` drives replenishment sequencing.

### Replenishment
A pull operation — moves items from a backlog/intake stage into the first queued/ready stage. Respects WIP limits on the destination. Configurable cadence: `manual | daily | weekly | per_sprint`. Service class priority respected automatically.

### Business Calendars
Each org defines whether time is measured as wall clock or working time (e.g. M-F 9-5). All flow metrics store both wall clock seconds AND working time seconds. Calendar defined by: timezone, weekly working hours per day, holiday exceptions. Sub-orgs inherit parent calendar unless they define their own.

**Critical example:** A request starting Monday 4:59pm and ending Tuesday 9:01am is either 2 minutes or 16h 2min depending on the org's calendar.

### Work Item User Relationships
No "assignee" field. Instead a `work_item_user_relationships` table with semantic types:
`requested_by | owns | working_on | reviewing | approved_by | watching`
Multiple users can have different relationship types to the same item simultaneously. All queryable: "show me all items I'm working_on across all orgs."

### Universal Visibility Rules Engine
One table (`visibility_rules`) controls access to any resource in the system. Replaces explicit permission tables. Scales to any org size — zero rows needed per new org added.

**Resources:** `service_catalog_item | work_item_type | org | workflow`
**Permission types:** `view | request | use`
**Scope types (tree position — scale infinitely):**
- `members_only | direct_children | all_descendants | siblings | ancestor_members | same_depth | all_authenticated`
**Scope types (cross-tree — tag matching):**
- `tag_match` — matches orgs tagged with `tag_key:tag_value`
**Role scope:** `role_in_org | role_in_ancestor`
**Effect:** `allow | deny` — DENY rules carve exceptions from broad ALLOW rules.
**Evaluation:** rules ordered by `priority` (lower = first). First match wins. Default = members only.

### Request Modes
Every work item type and catalog item has a `request_mode`:
- `user_requestable` — visible in catalog, any qualifying user can submit
- `restricted` — visible only to users passing visibility rules
- `automation_only` — hidden from all catalog views, only triggered by connections/actions

### Inheritance Model
Child orgs inherit from parent orgs. Walk-up logic: check own definition → check parent → check grandparent → system default. Configurable per resource type via `inheritance_policies`:
- `own_only | inherit | inherit_and_extend | override`
Applies to: workflows, work item types, service catalog, business calendar, roles.

### Org Tags
Orgs are tagged with key-value attributes (`division:finance`, `tier:executive`, `region:us-east`). Tags are used by visibility rules for cross-tree access patterns without explicit org-to-org relationships.

### Multi-Role Membership
Users can have multiple roles in the same org via `org_membership_roles` junction table. Primary role stored on `org_memberships`. Additional roles in `org_membership_roles`. Users can be members of multiple orgs simultaneously.

### Role Inheritance
Roles defined at a parent org can grant visibility and access in child orgs without explicit membership. Configured via `role_inheritance_policies`. Example: an `Executive` role in the parent org automatically grants catalog visibility in all child orgs.

---

## Stage Taxonomy

| Class | Type | Description |
|---|---|---|
| `intake` | waiting | Work received, not yet evaluated |
| `triage` | working | Being evaluated for validity/fit |
| `queued` | waiting | Accepted, prioritized, waiting to start |
| `in-progress` | working | Actively being worked |
| `blocked` | waiting | Cannot proceed, external dependency |
| `review` | working | Being validated, tested, or approved |
| `approved` | waiting | Passed review, ready for next phase |
| `delivery` | working | Being released, shipped, deployed |
| `done` | waiting | Complete (terminal) |
| `cancelled` | waiting | Cancelled with reason (terminal) |

---

## Flow Metrics

All derived from stage transition timestamps — never manually entered. Both wall clock and working time stored.

| Metric | Definition |
|---|---|
| **Cycle Time** | Time from first working stage entry to done |
| **Lead Time** | Time from work item created to done |
| **Throughput** | Items completed per time period |
| **Arrival Rate** | Items entering the system per time period |
| **Takt Time** | Available time divided by demand rate |
| **WIP** | Count of items in working stages |
| **Queue Depth** | Count of items in waiting stages |
| **Flow Efficiency** | Working cycle time / working lead time |
| **Stage SLA Health** | Time in stage vs. configured SLA |

---

## Distributed Systems Patterns (Architectural Intent — Not Yet Designed)

Do not design against these. Decisions made now should leave these doors open.

- **Service Discovery** — orgs publish services, consumers browse and subscribe
- **Event Bus** — publishers, subscribers, listeners. Candidate: Redis pub/sub, NATS, or Node.js EventEmitter to start
- **Gossip Protocol** — peer-to-peer propagation of system state (new org registered, service deprecated, new version available)
- **Federated Nodes** — multiple Flow OS instances at different companies participating in the same work fabric

**What current schema already supports for this:**
- Global URI addressing on every entity
- Semantic versioning on work item types and workflows
- `network_visible` flag on organizations
- `is_published` and `request_mode` on work item types

---

## System Default Seeds

Shipped with every new installation. Marked `is_system_default: true`. Cannot be deleted.

**Work Item Type Classes:** Task, Bug, Feature, Epic, Service Request, Project, Incident

**Workflows:**
- Simple Task — `intake → in-progress → done`
- Standard Feature — `intake → triage → queued → in-progress → review → done`
- Bug Triage — `intake → triage → queued → in-progress → review → delivery → done`
- Service Request — `intake → triage → queued → in-progress → done`

**Service Classes:** Expedited, Fixed Date, Standard, Deferred

**Roles per org:** owner, admin, member, viewer, external

**Org Template:** "Basic Team Board" — cloned to every new sub-org on creation

---

## What We Solve That Jira Doesn't

| Problem | Jira | Flow OS |
|---|---|---|
| Workflow model | Flat status list (3 categories) | Directed graph with stage classes |
| Cross-team board | Not possible without heavy config | Native via stage class normalization |
| Timing visibility | Dot per day, no SLA context | Always-on, SLA-relative, working-time aware |
| Work item hierarchy | Limited, clunky | Unlimited depth, frictionless |
| Organization as service mesh | Not a concept | Core architecture |
| External exposure | Limited | Native via service catalog |
| Cross-org automation | Manual integrations | Native triggers and connections |
| People vs. work focus | People-centric | Work item-centric |
| Permissions at scale | Explicit rows per relationship | Policy engine — zero rows per new org |
| Business hours in metrics | Not supported | Native calendar model |
| Kanban service classes | Not supported | Native (Expedited, Fixed Date, Standard, Deferred) |
| Replenishment | Manual, no system support | Native pull with configurable cadence |

---

## MVP Scope

### In MVP
- Organization hierarchy with inheritance
- Service catalog with visibility rules
- Work item types with class inheritance and request modes
- Workflow engine (directed graph, all transition kinds, all exit criteria tiers)
- Stage micro-states (waiting queue, WIP limits, review, evidence)
- Work items (create, transition, decompose, cancel+link pattern)
- Pending spawn state
- Stage timing with business calendar support
- Flow metrics (all, derived from timestamps, wall clock + working time)
- Cross-org connections and triggers
- Transition actions (api_call, spawn, optional_spawn)
- Service classes (Expedited, Fixed Date, Standard, Deferred)
- Replenishment (manual to start, scheduled later)
- User roles and multi-org membership
- Work item user relationships
- Notifications (in-app)
- Board views (personal + shared)
- External exposure of catalog items (contact form → work item)
- REST API (same visibility resolution as UI)
- Board visualization (design TBD — pending UI brainstorm)

### Deliberately Deferred
- Payment / wallet / token system
- Deep third-party integrations (Salesforce etc. — architecture supports, not built)
- Board UI for hierarchical work item visualization (needs whiteboard session first)
- Mobile interface
- Event bus / pub-sub / gossip protocol
- Federated nodes
- Full-text search (search index queue built, engine deferred)
- Email / webhook notification channels (in-app only for MVP)

---

## Open Design Questions
1. **Board UI for hierarchy** — how to visualize work items with unlimited depth without creating "Jira board disaster"? Needs sketching session.
2. **Frontend framework** — not yet decided.
3. **Multi-tenancy** — how isolated are orgs at the data layer? Relevant for PostgreSQL schema partitioning.
4. **API criteria sandboxing** — who can configure API exit criteria? Admin only? Needs security model.
5. **Neo4j visualization layer** — Neo4j Bloom natively vs. custom with D3 or Cytoscape.js?
6. **Work item type breaking changes** — when is a breaking version change allowed? How are connected orgs notified?
7. **Event bus technology** — Redis pub/sub vs. NATS vs. Node.js EventEmitter. Start simple, design for upgrade.
8. **URI format** — finalize naming convention. Proposal: `flowos://org-slug/entity-type/uuid`
9. **Full-text search engine** — PostgreSQL tsvector to start, Elasticsearch later?
10. **Object storage** — MinIO locally. Which managed service for production?

---

## Work Item Detail View — Hierarchy Navigator

When a user clicks a work item on the Kanban board, they navigate to a detail view that shows the work item in full hierarchical context — like an org chart for work, centered on the selected item.

### What the view shows:
- **Focus item** — the selected work item, center of the view
- **Parent chain** — ancestors up the hierarchy (parent feature, parent epic, parent initiative) up to the permission boundary or root
- **Siblings** — other children of the same parent (peer features, peer stories)
- **Children** — all descendants downward, any depth (stories, tasks, sub-tasks)
- **Cross-org spawned items** — work this item created in other orgs (e.g. the PMO estimation request this feature spawned), and what spawned this item if it was automation-created
- **All nodes show:** current stage, stage class, SLA status, service class, spawn state, owning org

### Visual distinction:
- `DECOMPOSES_INTO` children — "part of this work" (structural hierarchy)
- `SPAWNED` children — "work this created elsewhere" (cross-org automation chain)
- Both appear in the hierarchy view but are visually distinguished

### Permission boundary behavior:
- Walk up and down the tree, checking `canAccess(userId, 'work_item', resourceId, 'view')` at each node
- If a node fails the check, stop that branch — do not reveal the node or anything beyond it
- Show a visual indicator: "X more items exist but are not visible to you"
- Never silently truncate — broken-looking trees destroy user trust

### Primary Neo4j query pattern:
```
// 1. Parent chain (up to permission boundary or root)
MATCH path = (ancestor:WorkItem)-[:DECOMPOSES_INTO*]->(w:WorkItem {uri: $uri})
RETURN ancestor, length(path) AS depth ORDER BY depth DESC

// 2. Siblings
MATCH (parent:WorkItem)-[:DECOMPOSES_INTO]->(w:WorkItem {uri: $uri})
MATCH (parent)-[:DECOMPOSES_INTO]->(sibling:WorkItem)
WHERE sibling.uri <> $uri
RETURN sibling

// 3. All descendants (any depth)
MATCH (w:WorkItem {uri: $uri})-[:DECOMPOSES_INTO|SPAWNED*]->(descendant:WorkItem)
RETURN descendant

// 4. Cross-org spawned (both directions)
MATCH (w:WorkItem {uri: $uri})-[:SPAWNED]->(spawned:WorkItem) RETURN spawned
MATCH (origin:WorkItem)-[:SPAWNED]->(w:WorkItem {uri: $uri}) RETURN origin
```

### Data source split:
- **Neo4j** — resolves the hierarchy (which items exist, how they relate)
- **PostgreSQL** — fetches full property data for each item in the hierarchy
- **Visibility engine** — filters each node before returning to client

### Node.js module: `getWorkItemHierarchy(workItemUri, userId)`
Returns a tree structure centered on the given work item, with permission filtering applied at each node. Used exclusively by the Work Item Detail View.

---

## File & Directory Structure

```
flowos/
│
├── .env.example                  ← copy to .env, fill in credentials
├── package.json
│
├── api/
│   ├── server.js                 ← Express app entry point (node api/server.js)
│   ├── middleware/               ← TODO: auth.js, validate.js
│   └── routes/
│       ├── board.js              ← GET /v1/board/:orgUri
│       ├── catalog.js            ← GET /v1/catalog/:orgUri, POST /:itemUri/request
│       ├── organizations.js      ← GET /v1/organizations, GET /:uri
│       └── workItems.js          ← GET /:uri, GET /:uri/hierarchy, POST /transition
│
├── board/
│   └── boardQuery.js             ← 4-step board assembly (Neo4j org URIs → PostgreSQL items)
│
├── blueprint/                    ← TODO: org, workflow, work item type domain modules
│
├── core/                         ← load-bearing utilities — everything depends on these
│   ├── access.js                 ← canAccess() — universal visibility rule evaluator
│   ├── calendar.js               ← resolveOrgCalendar() + calculateWorkingTime()
│   ├── inheritance.js            ← resolveInheritedPolicy() + resolveInheritedResource()
│   └── uri.js                    ← generateUri() + parseUri()
│
├── db/
│   ├── neo4j.js                  ← Neo4j driver: runQuery / runWriteQuery / runWriteTransaction
│   ├── postgres.js               ← PostgreSQL pool: query() + getClient()
│   └── seeds/                    ← TODO: blueprint_defaults.sql
│
├── graph/
│   ├── hierarchy.js              ← getWorkItemHierarchy() — Work Item Detail View
│   ├── orgTree.js                ← getDescendantOrgUris() + org node sync
│   └── sync.js                   ← syncToGraph() — routes all entity changes to Neo4j
│
└── runtime/                      ← TODO: workItems.js, transitions.js, evidence.js, metrics.js
```

**Next files to create (in priority order):**
1. `docker-compose.yml` — PostgreSQL + Neo4j + MinIO local environment
2. `db/seeds/blueprint_defaults.sql` — system default roles, service classes, workflows, stages
3. `runtime/transitions.js` — stage transition engine (exit criteria → action pipeline → Neo4j sync)
4. `runtime/workItems.js` — work item creation, field validation, spawn state management
5. `api/middleware/auth.js` — replace `userId = 1` stubs

---


These are load-bearing utilities that everything else depends on:

1. **`resolveOrgCalendar(orgId)`** — walks org tree to find effective business calendar. Used by all metric calculations.
2. **`calculateWorkingTime(startTs, endTs, calendarId)`** — converts timestamps to working-time seconds. Used everywhere timing is displayed.
3. **`canAccess(userId, resourceType, resourceId, permissionType)`** — universal visibility rule evaluator. Used by every query that returns resources.
4. **`resolveInheritedPolicy(orgId, resourceType)`** — walks org tree to find effective inheritance policy. Used when resolving workflows, work item types, catalogs for a given org.
5. **`generateUri(orgSlug, entityType)`** — generates globally unique URIs. Used on every entity creation.
6. **`getDescendantOrgUris(orgUri)`** — Neo4j traversal returning all descendant org URIs. Used by board query and visibility resolution.
7. **`getWorkItemHierarchy(workItemUri, userId)`** — Neo4j traversal returning full work item hierarchy (ancestors, siblings, descendants, spawned chains) with permission filtering at each node. Used by Work Item Detail View.

---

## Session Notes
- Developer: Chris Tulino — Agile coaching, enterprise transformation, PMO leadership, mobile tech (Bank of America)
- Preferred style: architectural correctness over velocity; modular Node.js; pass full objects between modules
- UI brainstorm needed before building board component
- **Completed:**
  - Full PostgreSQL Blueprint schema (v1.1) — 20+ tables
  - Full PostgreSQL Runtime schema (v0.4) — 16 tables
  - Neo4j graph model (v0.2) — 7 node types, 18 relationship types, full query library, sync strategy
  - Node.js project scaffold (17 files) — server running, health check responding correctly
- **Server status:** Fully operational locally. Health check returns `"status":"ok"` with `postgres: true` and `neo4j: true`. Docker running PostgreSQL 16, Neo4j 5, and MinIO. Schemas loaded. Databases empty — system default seed data not yet created.
- **Next session:** Seed system defaults (roles, service classes, workflows, stages), then implement the stage transition module

---
*This file is the source of truth for project context. Update it at the end of every working session.*
