// =============================================================================
// FLOW OS — NEO4J GRAPH MODEL v0.1
// Cypher — Node definitions, relationship definitions, constraints, and indexes
//
// BOUNDARY RULE:
//   PostgreSQL = "what are the properties of this thing"
//   Neo4j      = "how is this thing connected to other things"
//
// Neo4j stores URIs as the primary identifier linking back to PostgreSQL.
// Never duplicate full property sets — store only what's needed for
// traversal, filtering, and visualization.
// =============================================================================


// =============================================================================
// CONSTRAINTS
// Enforce uniqueness on URI across all node types.
// URIs are the cross-system identity linking Neo4j nodes to PostgreSQL rows.
// =============================================================================

CREATE CONSTRAINT constraint_org_uri
    IF NOT EXISTS FOR (o:Organization) REQUIRE o.uri IS UNIQUE;

CREATE CONSTRAINT constraint_work_item_uri
    IF NOT EXISTS FOR (w:WorkItem) REQUIRE w.uri IS UNIQUE;

CREATE CONSTRAINT constraint_work_item_type_uri
    IF NOT EXISTS FOR (t:WorkItemType) REQUIRE t.uri IS UNIQUE;

CREATE CONSTRAINT constraint_stage_uri
    IF NOT EXISTS FOR (s:Stage) REQUIRE s.uri IS UNIQUE;

CREATE CONSTRAINT constraint_workflow_uri
    IF NOT EXISTS FOR (wf:Workflow) REQUIRE wf.uri IS UNIQUE;

CREATE CONSTRAINT constraint_service_catalog_uri
    IF NOT EXISTS FOR (sc:ServiceCatalogItem) REQUIRE sc.uri IS UNIQUE;

CREATE CONSTRAINT constraint_wit_class_uri
    IF NOT EXISTS FOR (c:WorkItemTypeClass) REQUIRE c.uri IS UNIQUE;


// =============================================================================
// INDEXES
// For fast node lookup and traversal filtering.
// =============================================================================

CREATE INDEX index_org_slug
    IF NOT EXISTS FOR (o:Organization) ON (o.slug);

CREATE INDEX index_work_item_stage_class
    IF NOT EXISTS FOR (w:WorkItem) ON (w.current_stage_class);

CREATE INDEX index_work_item_spawn_state
    IF NOT EXISTS FOR (w:WorkItem) ON (w.spawn_state);

CREATE INDEX index_work_item_sla_status
    IF NOT EXISTS FOR (w:WorkItem) ON (w.sla_status);

CREATE INDEX index_work_item_type_name
    IF NOT EXISTS FOR (t:WorkItemType) ON (t.name);

CREATE INDEX index_stage_class
    IF NOT EXISTS FOR (s:Stage) ON (s.stage_class);


// =============================================================================
// GRAPH 1 — ORGANIZATION HIERARCHY
//
// Mirrors the PostgreSQL org tree for fast traversal queries.
// PostgreSQL is source of truth — this is a read-optimized replica.
//
// Use cases:
//   - Walk up tree to resolve inherited policies (calendar, visibility, workflow)
//   - Find all orgs within N hops of a given org
//   - Visualize the org network
//   - Evaluate visibility rules (ancestor_members, all_descendants etc.)
// =============================================================================

// NODE: Organization
// ------------------
// Minimal properties — enough for traversal and display.
// Full config lives in PostgreSQL blueprint.organizations.
//
// CREATE (o:Organization {
//     uri:            "flowos://bank-of-america/org/uuid",
//     slug:           "bank-of-america-mobile",
//     name:           "Mobile Technology",
//     org_type:       "team",          // enterprise|division|department|team|external
//     depth:          3,               // depth in tree (root = 0) — denormalized for query performance
//     is_active:      true,
//     network_visible: false
// })

// RELATIONSHIP: PARENT_OF
// -----------------------
// Directed from parent → child.
// Traversing [:PARENT_OF*] finds all descendants.
// Traversing [:PARENT_OF*] in reverse finds all ancestors.
//
// (parent:Organization)-[:PARENT_OF {
//     since: datetime()
// }]->(child:Organization)

// EXAMPLE QUERIES:
// Find all descendants of an org (e.g. for all_descendants visibility scope):
//   MATCH (root:Organization {slug: 'engineering'})-[:PARENT_OF*]->(child:Organization)
//   RETURN child
//
// Find all ancestors of an org (e.g. for ancestor_members visibility scope):
//   MATCH (child:Organization {slug: 'mobile-team'})<-[:PARENT_OF*]-(ancestor:Organization)
//   RETURN ancestor
//
// Find orgs at same depth (same_depth visibility scope):
//   MATCH (o:Organization {depth: 3})
//   RETURN o
//
// Check if org A is an ancestor of org B (for policy resolution):
//   MATCH path = (a:Organization {slug: 'engineering'})-[:PARENT_OF*]->(b:Organization {slug: 'mobile-team'})
//   RETURN path IS NOT NULL AS is_ancestor


// =============================================================================
// GRAPH 2 — WORK ITEM RELATIONSHIP NETWORK
//
// The most important graph. Tracks how work items relate to each other
// across the entire system — decomposition, spawning, blocking, dependencies.
//
// Use cases:
//   - Visualize the full cascade from a project request
//   - Find all work items blocking a release
//   - Calculate roll-up flow health across an initiative
//   - Trace origin chain of any work item
//   - Find all items that will be affected by cancelling this item
// =============================================================================

// NODE: WorkItem
// --------------
// Properties needed for traversal, board rendering, and cascade visualization.
// Full work item data lives in PostgreSQL runtime.work_items.
//
// CREATE (w:WorkItem {
//     uri:                "flowos://mobile-team/work-items/uuid",
//     title:              "Launch Mobile Banking 3.0",
//     work_item_type_uri: "flowos://mobile-team/work-item-types/uuid",
//     work_item_type_name:"Project",
//     owner_org_uri:      "flowos://bank-of-america/org/uuid",
//     owner_org_slug:     "bank-of-america-mobile",
//
//     // Current state — denormalized from PostgreSQL for graph queries
//     current_stage_uri:  "flowos://mobile-team/stages/uuid",
//     current_stage_name: "In Development",
//     current_stage_class:"in-progress",   // stage class for cross-workflow board
//     spawn_state:        "active",         // pending|active|cancelled|done
//     service_class:      "standard",       // expedited|fixed-date|standard|deferred
//     sla_status:         "on_track",       // on_track|at_risk|breached|no_sla
//
//     created_at:         datetime(),
//     updated_at:         datetime()
// })

// RELATIONSHIP: DECOMPOSES_INTO
// -----------------------------
// User explicitly broke a work item into smaller work items.
// Direction: parent → child
//
// (parent:WorkItem)-[:DECOMPOSES_INTO {
//     created_at:         datetime(),
//     created_by_user_uri:"flowos://users/uuid",
//     display_order:      1              // ordering of siblings
// }]->(child:WorkItem)

// RELATIONSHIP: SPAWNED
// ---------------------
// System automatically created this item via a connection or transition action.
// Direction: origin → spawned
//
// (origin:WorkItem)-[:SPAWNED {
//     created_at:             datetime(),
//     connection_uri:         "flowos://org/connections/uuid",    // if via connection
//     transition_action_uri:  "flowos://org/transition-actions/uuid", // if via action
//     spawn_state:            "active",   // pending|active|rejected
//     was_optional:           false       // true if user was prompted
// }]->(spawned:WorkItem)

// RELATIONSHIP: ORIGIN_OF
// -----------------------
// A cancelled item that led directly to a replacement item.
// Direction: cancelled → replacement
// Enables full audit trail traversal.
//
// (cancelled:WorkItem)-[:ORIGIN_OF {
//     created_at:         datetime(),
//     reason:             "Wrong work item type — switching to Feature"
// }]->(replacement:WorkItem)

// RELATIONSHIP: BLOCKS
// --------------------
// This item must be in a terminal stage before that item can transition forward.
// Hard dependency. Direction: blocker → blocked.
//
// (blocker:WorkItem)-[:BLOCKS {
//     created_at:         datetime(),
//     created_by_user_uri:"flowos://users/uuid",
//     stage_uri:          "flowos://org/stages/uuid"  // which stage is blocked
// }]->(blocked:WorkItem)

// RELATIONSHIP: DEPENDS_ON
// ------------------------
// Soft dependency — this item needs that item but doesn't hard-gate it.
// Informational. Affects sequencing recommendations, not enforcement.
// Direction: dependent → dependency
//
// (dependent:WorkItem)-[:DEPENDS_ON {
//     created_at:         datetime(),
//     created_by_user_uri:"flowos://users/uuid",
//     notes:              "Needs API contract finalized first"
// }]->(dependency:WorkItem)

// EXAMPLE QUERIES:
// Full cascade from a project request (all descendants, any depth):
//   MATCH (root:WorkItem {uri: 'flowos://org/work-items/uuid'})
//   MATCH (root)-[:DECOMPOSES_INTO|SPAWNED*]->(descendant:WorkItem)
//   RETURN root, descendant
//
// Find all items blocking a release:
//   MATCH (release:WorkItem {uri: 'flowos://org/work-items/uuid'})
//   MATCH (blocker:WorkItem)-[:BLOCKS]->(release)
//   WHERE blocker.spawn_state <> 'done' AND blocker.spawn_state <> 'cancelled'
//   RETURN blocker
//
// Roll-up SLA status across an initiative:
//   MATCH (root:WorkItem {uri: 'flowos://org/work-items/uuid'})
//   MATCH (root)-[:DECOMPOSES_INTO|SPAWNED*]->(item:WorkItem)
//   RETURN item.sla_status, count(item) AS count
//
// Trace origin chain of a work item:
//   MATCH path = (origin:WorkItem)-[:ORIGIN_OF*]->(current:WorkItem {uri: '...'})
//   RETURN path
//
// Find work items this item transitively depends on:
//   MATCH (item:WorkItem {uri: '...'})-[:DEPENDS_ON|BLOCKS*]->(dep:WorkItem)
//   RETURN dep


// =============================================================================
// GRAPH 3 — WORK ITEM TYPE NETWORK
//
// Models the relationships between work item types, orgs, and service catalog
// items. Think of it as the "interface map" of the system — which orgs expose
// what, which types spawn which other types, and how versions relate.
//
// Use cases:
//   - "What breaks if I deprecate ProjectRequestV1?"
//   - "Show me everything downstream of this work item type"
//   - "Which orgs are consuming my service catalog item?"
//   - "What is the full dependency graph of work item types in this node?"
// =============================================================================

// NODE: WorkItemType
// ------------------
// CREATE (t:WorkItemType {
//     uri:            "flowos://mobile-team/work-item-types/uuid",
//     name:           "Project Request",
//     version:        "1.0.0",
//     owner_org_uri:  "flowos://bank-of-america/org/uuid",
//     request_mode:   "user_requestable",  // user_requestable|restricted|automation_only
//     is_published:   true,
//     is_active:      true,
//     deprecated_at:  null
// })

// NODE: WorkItemTypeClass
// -----------------------
// CREATE (c:WorkItemTypeClass {
//     uri:            "flowos://system/work-item-type-classes/uuid",
//     name:           "Project",
//     is_system_default: true
// })

// NODE: ServiceCatalogItem
// ------------------------
// CREATE (sc:ServiceCatalogItem {
//     uri:            "flowos://pmo/service-catalog/uuid",
//     name:           "Request a Project",
//     owner_org_uri:  "flowos://pmo/org/uuid",
//     request_mode:   "user_requestable",
//     is_external:    false,
//     is_active:      true
// })

// RELATIONSHIP: EXPOSES
// ---------------------
// An org exposes a work item type via its service catalog.
// Direction: org → service catalog item → work item type
//
// (org:Organization)-[:EXPOSES]->(sc:ServiceCatalogItem)
// (sc:ServiceCatalogItem)-[:BACKED_BY]->(t:WorkItemType)

// RELATIONSHIP: SPAWNS_TYPE
// -------------------------
// This work item type spawns that work item type on a transition.
// Key for impact analysis: "what gets created if I use this type?"
//
// (source:WorkItemType)-[:SPAWNS_TYPE {
//     connection_uri:         "flowos://org/connections/uuid",
//     trigger_stage_class:    "approved",
//     target_org_uri:         "flowos://pmo/org/uuid",
//     is_optional:            false      // true if optional_spawn action
// }]->(target:WorkItemType)

// RELATIONSHIP: SUCCEEDS
// ----------------------
// Version relationship. V2 succeeds V1.
// Enables: "what consumes V1 that needs to migrate to V2?"
//
// (v2:WorkItemType)-[:SUCCEEDS {
//     deprecated_at:  datetime(),
//     migration_notes:"Add scope field before upgrading"
// }]->(v1:WorkItemType)

// RELATIONSHIP: INHERITS_FROM
// ---------------------------
// Work item type inherits from a class.
//
// (t:WorkItemType)-[:INHERITS_FROM]->(c:WorkItemTypeClass)

// RELATIONSHIP: CONSUMES
// ----------------------
// An org has a connection that consumes another org's work item type.
// Enables: "who is affected if I change this type?"
//
// (consumer:Organization)-[:CONSUMES {
//     connection_uri:     "flowos://org/connections/uuid",
//     since:              datetime(),
//     version_consumed:   "1.0.0"
// }]->(t:WorkItemType)

// EXAMPLE QUERIES:
// Impact analysis — what consumes ProjectRequestV1?
//   MATCH (t:WorkItemType {name: 'Project Request', version: '1.0.0'})
//   MATCH (consumer:Organization)-[:CONSUMES]->(t)
//   RETURN consumer.name, consumer.uri
//
// Full downstream type cascade from a type:
//   MATCH (root:WorkItemType {uri: '...'})
//   MATCH (root)-[:SPAWNS_TYPE*]->(downstream:WorkItemType)
//   RETURN downstream
//
// Find all types that will break if this class changes:
//   MATCH (c:WorkItemTypeClass {name: 'Project'})
//   MATCH (t:WorkItemType)-[:INHERITS_FROM]->(c)
//   RETURN t


// =============================================================================
// GRAPH 4 — WORKFLOW DIRECTED GRAPH
//
// Stages as nodes, transitions as edges. Enables workflow visualization,
// path analysis, and dead-end detection.
//
// Use cases:
//   - Visualize any workflow as a graph
//   - Find all possible paths from intake to done
//   - Detect unreachable stages or dead ends in a workflow
//   - Analyze how many transitions items typically take (path length stats)
//   - Show which transitions are role-restricted
// =============================================================================

// NODE: Workflow
// --------------
// CREATE (wf:Workflow {
//     uri:            "flowos://mobile-team/workflows/uuid",
//     name:           "Standard Feature Workflow",
//     version:        "1.0.0",
//     owner_org_uri:  "flowos://mobile-team/org/uuid",
//     is_active:      true
// })

// NODE: Stage
// -----------
// CREATE (s:Stage {
//     uri:            "flowos://mobile-team/stages/uuid",
//     name:           "Code Review",
//     stage_class:    "review",        // universal vocabulary
//     stage_type:     "working",       // waiting|working
//     workflow_uri:   "flowos://mobile-team/workflows/uuid",
//     display_order:  4,
//     sla_hours:      24,
//     wip_limit:      3,
//     is_entry_stage: false,
//     is_terminal:    false
// })

// RELATIONSHIP: CONTAINS
// ----------------------
// A workflow contains stages.
// Direction: workflow → stage
//
// (wf:Workflow)-[:CONTAINS]->(s:Stage)

// RELATIONSHIP: TRANSITIONS_TO
// ----------------------------
// Directed edge from one stage to another. This IS the workflow graph.
// Direction: from_stage → to_stage
//
// (from:Stage)-[:TRANSITIONS_TO {
//     transition_label:   "Approve",
//     transition_kind:    "forward",   // forward|backward|sideways|cross-workflow
//     requires_reason:    false,
//     role_restriction_uris: [],       // empty = any role can execute
//     is_active:          true
// }]->(to:Stage)

// RELATIONSHIP: ASSIGNED_TO
// -------------------------
// A work item type uses this workflow.
//
// (t:WorkItemType)-[:ASSIGNED_TO]->(wf:Workflow)

// EXAMPLE QUERIES:
// Visualize a full workflow:
//   MATCH (wf:Workflow {uri: '...'})
//   MATCH (wf)-[:CONTAINS]->(s:Stage)
//   MATCH (s)-[t:TRANSITIONS_TO]->(next:Stage)
//   RETURN s, t, next
//
// Find all paths from entry to terminal stage:
//   MATCH (entry:Stage {is_entry_stage: true, workflow_uri: '...'})
//   MATCH (terminal:Stage {is_terminal: true, workflow_uri: '...'})
//   MATCH path = (entry)-[:TRANSITIONS_TO*]->(terminal)
//   RETURN path
//
// Detect unreachable stages (no incoming transitions):
//   MATCH (s:Stage {workflow_uri: '...'})
//   WHERE NOT (s)<-[:TRANSITIONS_TO]-() AND NOT s.is_entry_stage
//   RETURN s.name AS unreachable_stage
//
// Detect dead-end stages (no outgoing transitions, not terminal):
//   MATCH (s:Stage {workflow_uri: '...'})
//   WHERE NOT (s)-[:TRANSITIONS_TO]->() AND NOT s.is_terminal
//   RETURN s.name AS dead_end_stage


// =============================================================================
// CROSS-GRAPH RELATIONSHIPS
// Connections that span multiple graphs above.
// =============================================================================

// WorkItem IS_INSTANCE_OF WorkItemType
// Links the runtime graph to the type network.
// Enables: "show me all active instances of this work item type"
//
// (w:WorkItem)-[:IS_INSTANCE_OF]->(t:WorkItemType)

// NOTE: Current stage is stored as properties on WorkItem, not as a relationship.
// A CURRENTLY_IN relationship was considered but rejected — property + index gives
// identical query results with simpler writes (no relationship delete/create on
// every transition). Starting from a Stage node to find items is never a primary
// traversal direction.
//
// Current stage properties on WorkItem (updated on every transition):
//   current_stage_uri:   "flowos://org/stages/uuid"
//   current_stage_name:  "Code Review"
//   current_stage_class: "review"
//   sla_status:          "on_track"
// These are already defined on the WorkItem node above.

// Organization OWNS WorkItem
// Links org hierarchy to work item network.
// Enables: "show me all work items in this org's subtree"
//
// (o:Organization)-[:OWNS]->(w:WorkItem)

// EXAMPLE CROSS-GRAPH QUERIES:
// All work items in an org's subtree currently in 'review' class stages:
//   MATCH (root:Organization {slug: 'engineering'})-[:PARENT_OF*]->(org:Organization)
//   MATCH (org)-[:OWNS]->(w:WorkItem)
//   WHERE w.current_stage_class = 'review' AND w.spawn_state = 'active'
//   RETURN w
//
// Full initiative view: org → work item type → all instances and their cascade:
//   MATCH (o:Organization {slug: 'pmo'})-[:EXPOSES]->(sc:ServiceCatalogItem)
//   MATCH (sc)-[:BACKED_BY]->(t:WorkItemType)
//   MATCH (w:WorkItem)-[:IS_INSTANCE_OF]->(t)
//   MATCH (w)-[:DECOMPOSES_INTO|SPAWNED*0..]->(descendant:WorkItem)
//   RETURN w, descendant


// =============================================================================
// GRAPH 5 — USER CONTEXT GRAPH
//
// Users in Neo4j serve two purposes:
//   1. Work item assignment traversal — "who is working on items near this one"
//   2. Permission traversal — role relationships for canAccess() resolution
//
// Full user profile lives in PostgreSQL blueprint.users.
// Neo4j stores only what's needed for graph traversal and board display.
//
// Use cases:
//   - "Show me who is working on items in this initiative"
//   - "Find all items assigned to members of this org"
//   - "Who reviewed this item and items related to it?"
//   - canAccess() role traversal without hitting PostgreSQL on every check
// =============================================================================

// NODE: User
// ----------
// CREATE (u:User {
//     uri:            "flowos://users/uuid",
//     display_name:   "Chris Tulino",
//     email:          "chris@example.com",
//     is_active:      true
// })

// RELATIONSHIP: MEMBER_OF
// -----------------------
// User is a member of an organization with a role.
// Direction: user → org
// Used by canAccess() to resolve org membership and role during visibility checks.
//
// (u:User)-[:MEMBER_OF {
//     role_name:      "Tech Lead",        // denormalized for fast traversal
//     role_uri:       "flowos://org/roles/uuid",
//     is_active:      true,
//     joined_at:      datetime()
// }]->(o:Organization)

// RELATIONSHIP: WORKS_ON
// ----------------------
// User has an active relationship to a work item.
// Mirrors runtime.work_item_user_relationships.
// Direction: user → work item
//
// (u:User)-[:WORKS_ON {
//     relationship_type: "working_on",    // requested_by|owns|working_on|reviewing|approved_by|watching
//     assigned_at:        datetime(),
//     is_active:          true
// }]->(w:WorkItem)

// EXAMPLE QUERIES:
// Everyone working on items in an initiative:
//   MATCH (root:WorkItem {uri: $uri})-[:DECOMPOSES_INTO|SPAWNED*]->(item:WorkItem)
//   MATCH (u:User)-[:WORKS_ON {is_active: true}]->(item)
//   RETURN DISTINCT u.display_name, u.uri, item.title, item.current_stage_class
//
// All active work items for a user across all orgs:
//   MATCH (u:User {uri: $userUri})-[:WORKS_ON {relationship_type: 'working_on', is_active: true}]->(w:WorkItem)
//   WHERE w.spawn_state = 'active'
//   RETURN w ORDER BY w.sla_status, w.current_stage_class
//
// Role check for canAccess() — does user have a role in any ancestor org?
//   MATCH (u:User {uri: $userUri})-[m:MEMBER_OF]->(o:Organization)
//   MATCH (o)<-[:PARENT_OF*0..]-(ancestor:Organization {uri: $targetOrgUri})
//   RETURN m.role_name, o.uri
//   -- If result exists, user has org membership in the target org's hierarchy


// =============================================================================
// WORK ITEM DETAIL VIEW — HIERARCHY NAVIGATOR QUERIES
//
// Full query set for getWorkItemHierarchy(workItemUri, userId).
// Neo4j resolves the tree structure. PostgreSQL fetches full properties.
// Permission filtering applied at each node before returning to client.
//
// Returns a tree centered on the focus item with:
//   - Parent chain (up to permission boundary or root)
//   - Siblings (peer items sharing same parent)
//   - All descendants (any depth, DECOMPOSES_INTO + SPAWNED)
//   - Cross-org spawned items (both directions)
//   - Blocking relationships
// =============================================================================

// QUERY HN-1: Parent chain (ancestors)
// Returns all ancestors ordered by distance from focus item.
// Permission check applied to each before returning.
//
// MATCH path = (ancestor:WorkItem)-[:DECOMPOSES_INTO*]->(focus:WorkItem {uri: $uri})
// WITH ancestor, length(path) AS depth
// ORDER BY depth DESC
// RETURN ancestor.uri, ancestor.title, ancestor.current_stage_class,
//        ancestor.sla_status, ancestor.spawn_state,
//        ancestor.owner_org_uri, depth

// QUERY HN-2: Siblings
// Returns peer items sharing the same parent.
//
// MATCH (parent:WorkItem)-[:DECOMPOSES_INTO]->(focus:WorkItem {uri: $uri})
// MATCH (parent)-[:DECOMPOSES_INTO]->(sibling:WorkItem)
// WHERE sibling.uri <> $uri
// RETURN sibling.uri, sibling.title, sibling.current_stage_class,
//        sibling.sla_status, sibling.spawn_state, sibling.service_class

// QUERY HN-3: All descendants (decomposition + spawned, any depth)
// Returns full downward tree. Permission filtered before returning.
//
// MATCH (focus:WorkItem {uri: $uri})-[r:DECOMPOSES_INTO|SPAWNED*]->(descendant:WorkItem)
// RETURN descendant.uri, descendant.title, descendant.current_stage_class,
//        descendant.sla_status, descendant.spawn_state, descendant.owner_org_uri,
//        type(last(relationships(r))) AS relationship_kind,
//        -- relationship_kind distinguishes DECOMPOSES_INTO vs SPAWNED for UI styling
//        length(r) AS depth

// QUERY HN-4: Cross-org spawned (both directions)
// Items this work item spawned in other orgs, and what spawned this item.
//
// MATCH (focus:WorkItem {uri: $uri})-[:SPAWNED]->(spawned:WorkItem)
// RETURN spawned.uri, spawned.title, spawned.owner_org_uri,
//        spawned.current_stage_class, spawned.spawn_state, 'outbound' AS direction
// UNION
// MATCH (origin:WorkItem)-[:SPAWNED]->(focus:WorkItem {uri: $uri})
// RETURN origin.uri, origin.title, origin.owner_org_uri,
//        origin.current_stage_class, origin.spawn_state, 'inbound' AS direction

// QUERY HN-5: Blocking relationships
// Items blocking this item, and items this item is blocking.
//
// MATCH (blocker:WorkItem)-[:BLOCKS]->(focus:WorkItem {uri: $uri})
// WHERE blocker.spawn_state <> 'done' AND blocker.spawn_state <> 'cancelled'
// RETURN blocker.uri, blocker.title, blocker.current_stage_class,
//        blocker.sla_status, 'blocking_me' AS direction
// UNION
// MATCH (focus:WorkItem {uri: $uri})-[:BLOCKS]->(blocked:WorkItem)
// RETURN blocked.uri, blocked.title, blocked.current_stage_class,
//        blocked.sla_status, 'i_am_blocking' AS direction

// PERMISSION BOUNDARY BEHAVIOR:
// For each node returned by HN-1 through HN-5:
//   - Check canAccess(userId, 'work_item', nodeUri, 'view')
//   - If PASS: include full node data in response
//   - If FAIL: include a placeholder { uri: null, restricted: true, depth: N }
//   - Never silently drop nodes — always indicate something exists at that position
//   - Stop traversal beyond a restricted node (don't reveal what's behind it)


// =============================================================================
// BLOCKING CHAIN ANALYSIS
// Find the full chain of items preventing a target item from completing.
// Used for release readiness views and dependency dashboards.
// =============================================================================

// Find everything blocking a release (transitive blocking chain):
//   MATCH (release:WorkItem {uri: $releaseUri})
//   MATCH path = (blocker:WorkItem)-[:BLOCKS*]->(release)
//   WHERE blocker.spawn_state <> 'done' AND blocker.spawn_state <> 'cancelled'
//   RETURN blocker.uri, blocker.title, blocker.current_stage_class,
//          blocker.sla_status, blocker.owner_org_uri,
//          length(path) AS hops_from_release
//   ORDER BY hops_from_release

// Critical path — longest blocking chain:
//   MATCH (release:WorkItem {uri: $releaseUri})
//   MATCH path = (blocker:WorkItem)-[:BLOCKS*]->(release)
//   RETURN path, length(path) AS chain_length
//   ORDER BY chain_length DESC LIMIT 1

// Items with no blockers (ready to move forward):
//   MATCH (root:WorkItem {uri: $uri})-[:DECOMPOSES_INTO|SPAWNED*]->(item:WorkItem)
//   WHERE item.spawn_state = 'active'
//   AND NOT (item)<-[:BLOCKS]-(:WorkItem {spawn_state: 'active'})
//   RETURN item


// =============================================================================
// BOARD QUERY INTEGRATION PATTERN
// How Neo4j and PostgreSQL collaborate for the Kanban board.
//
// STEP 1 — Neo4j: resolve which org URIs to include
// STEP 2 — PostgreSQL: fetch and group work items
// STEP 3 — Application: assemble 2D grid
// STEP 4 — Neo4j (on demand): drill-down cascade when card clicked
// =============================================================================

// STEP 1 — Neo4j query (getDescendantOrgUris):
// Returns all org URIs in the subtree of the board's root org.
// Result passed directly to PostgreSQL as IN clause.
//
// MATCH (root:Organization {uri: $rootOrgUri})-[:PARENT_OF*0..]->(org:Organization)
// WHERE org.is_active = true
// RETURN org.uri AS org_uri
// -- *0.. includes the root org itself

// STEP 2 — PostgreSQL query (getActiveWorkItems):
// SELECT
//   wi.uri, wi.title, wi.current_stage_id, wi.current_substate,
//   wi.service_class_id, wi.sla_status, wi.spawn_state,
//   wi.field_values, wi.entered_current_stage_at,
//   wi.due_date, wi.owner_org_id,
//   fms.cycle_time_working_seconds, fms.lead_time_working_seconds
// FROM runtime.work_items wi
// LEFT JOIN runtime.flow_metrics_snapshots fms ON fms.work_item_id = wi.id
// WHERE wi.owner_org_id IN (
//   SELECT id FROM blueprint.organizations WHERE uri = ANY($orgUris)
// )
// AND wi.spawn_state = 'active'
// ORDER BY wi.service_class_id, wi.current_stage_id, wi.entered_current_stage_at

// STEP 3 — Application layer grouping:
// Group results into 2D structure:
// {
//   stages: [{ stage_id, stage_name, stage_class, sla_hours, wip_limit, substate_config }],
//   swimlanes: [{ service_class_id, name, color }],
//   cells: {
//     [stage_id]: {
//       [service_class_id]: {
//         [substate]: [ ...work_item_cards ]
//       }
//     }
//   }
// }


// =============================================================================
// PROPERTY COMPLETENESS AUDIT
// Verified properties needed across all use cases.
// =============================================================================

// WorkItem node — complete property set:
// uri, title, work_item_type_uri, work_item_type_name,
// owner_org_uri, owner_org_slug,
// current_stage_uri, current_stage_name, current_stage_class,
// current_substate,                    ← micro-state for sub-column rendering
// spawn_state,
// service_class,                       ← swimlane assignment
// sla_status,                          ← on_track|at_risk|breached|no_sla
// due_date,                            ← for Fixed Date service class display
// created_at, updated_at

// Stage node — complete property set:
// uri, name, stage_class, stage_type,
// workflow_uri, display_order,
// sla_hours,                           ← for board column SLA indicator
// wip_limit,                           ← for board column WIP display
// has_waiting_queue,                   ← for sub-column rendering decision
// is_entry_stage, is_terminal

// Organization node — complete property set:
// uri, slug, name, org_type,
// depth,                               ← for same_depth visibility scope
// is_active, network_visible

// User node — complete property set:
// uri, display_name, email, is_active

// WorkItemType node — complete property set:
// uri, name, version, owner_org_uri,
// request_mode, is_published,
// is_active, deprecated_at


// =============================================================================
// SYNC STRATEGY
// Neo4j is a read-optimized replica of relationship data.
// PostgreSQL is always the source of truth.
// If Neo4j goes down, nothing breaks except visualization and deep traversal.
// A full resync rebuilds it entirely from PostgreSQL.
//
// SYNC TRIGGERS — what PostgreSQL event causes a Neo4j write:
//
//   Organization created/updated/deactivated
//     → Upsert Organization node + PARENT_OF edge
//     → Update depth property on affected org and all descendants
//
//   User created/updated/deactivated
//     → Upsert User node
//
//   Org membership created/updated
//     → Upsert MEMBER_OF relationship (User → Organization)
//
//   Work item created
//     → Create WorkItem node
//     → Create IS_INSTANCE_OF (WorkItem → WorkItemType)
//     → Create OWNS (Organization → WorkItem)
//     → Create DECOMPOSES_INTO if parent_id set (parent → new item)
//     → Create SPAWNED if origin_work_item_id set (origin → new item)
//
//   Work item stage transition
//     → Update WorkItem node properties:
//         current_stage_uri, current_stage_name, current_stage_class,
//         current_substate, sla_status, updated_at
//
//   Work item cancelled + replacement created
//     → Update WorkItem.spawn_state = 'cancelled'
//     → Create ORIGIN_OF (cancelled → replacement)
//
//   Work item user relationship created/deactivated
//     → Upsert WORKS_ON (User → WorkItem) with is_active flag
//
//   Blocking/dependency relationship created
//     → Create BLOCKS or DEPENDS_ON relationship
//
//   Work item type created/versioned
//     → Upsert WorkItemType node
//     → Create INHERITS_FROM (type → class)
//     → Create SUCCEEDS if new version (v2 → v1)
//
//   Connection created/updated
//     → Upsert SPAWNS_TYPE (source type → target type)
//     → Upsert CONSUMES (consumer org → target type)
//
//   Workflow/stage created
//     → Upsert Workflow node + Stage nodes
//     → Create CONTAINS (workflow → stage)
//     → Create TRANSITIONS_TO edges
//     → Create ASSIGNED_TO (work item type → workflow)
//
//   Service catalog item created/updated
//     → Upsert ServiceCatalogItem node
//     → Create EXPOSES (org → catalog item)
//     → Create BACKED_BY (catalog item → work item type)
//
// SYNC MECHANISM:
//   Synchronous (critical path — must be consistent immediately):
//     - Stage transitions (current_stage_* properties on WorkItem)
//     - Work item created/cancelled
//     - BLOCKS relationship created (affects release readiness queries)
//
//   Asynchronous via event queue (eventual consistency acceptable):
//     - Org updates
//     - User/membership changes
//     - Work item type versioning
//     - Connection changes
//
//   Full resync:
//     - Available at any time from PostgreSQL
//     - Node.js module: fullResync(entityType?) — resyncs all or specific type
//     - Safe to run while system is live (upsert operations)
//
// NODE.JS SYNC MODULE: syncToGraph(entityType, entityUri, operation, payload)
//   entityType: 'org'|'user'|'membership'|'work_item'|'work_item_type'|
//               'connection'|'workflow'|'stage'|'catalog_item'|'user_relationship'
//   operation:  'create'|'update'|'delete'
//   payload:    the full object from PostgreSQL
// =============================================================================

// =============================================================================
// END NEO4J GRAPH MODEL v0.2
// =============================================================================
