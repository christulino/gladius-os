-- =============================================================================
-- FLOW OS — BLUEPRINT SCHEMA v1.1
-- PostgreSQL
-- Defines structure only. No work item instances live here.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS blueprint;

-- =============================================================================
-- ORGANIZATIONS
-- Self-referencing hierarchy. No limit on depth.
-- =============================================================================

CREATE TABLE blueprint.organizations (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,               -- Global address: flowos://org-slug
    slug                TEXT NOT NULL UNIQUE,               -- URL-safe short name: 'bank-of-america-mobile'
    name                TEXT NOT NULL,                      -- Display name: 'Mobile Technology'
    description         TEXT,
    parent_id           INTEGER REFERENCES blueprint.organizations(id),
    org_type            TEXT NOT NULL DEFAULT 'team',       -- 'enterprise' | 'division' | 'department' | 'team' | 'external'
    network_visible     BOOLEAN NOT NULL DEFAULT FALSE,     -- Visible to other nodes in federated network
    default_template_id INTEGER,                            -- FK added after org_templates created (see below)
    calendar_id         INTEGER,                            -- FK to business_calendars — added after that table exists
    -- NULL = inherit from parent org. Top-level org should always define a calendar.
    extended_data       JSONB,                              -- Overflow bucket for additional org metadata
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- USERS AND ROLES
-- Lightweight identity model. Roles are org-scoped.
-- =============================================================================

CREATE TABLE blueprint.users (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    email               TEXT NOT NULL UNIQUE,
    display_name        TEXT NOT NULL,
    avatar_url          TEXT,
    is_system           BOOLEAN NOT NULL DEFAULT FALSE,     -- System/bot users for automated actions
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles are defined at the org level
-- System default roles: 'owner' | 'admin' | 'member' | 'viewer' | 'external'
CREATE TABLE blueprint.roles (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    org_id              INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    name                TEXT NOT NULL,                      -- 'Tech Lead' | 'QA Engineer' | 'Product Owner'
    description         TEXT,
    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE for built-in roles
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, name)
);

-- Users belong to organizations with a role
CREATE TABLE blueprint.org_memberships (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES blueprint.users(id),
    org_id              INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    role_id             INTEGER NOT NULL REFERENCES blueprint.roles(id),
    joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, org_id)
);

-- =============================================================================
-- ORG VISIBILITY AND ACCESS POLICIES
-- Controls who can see an org exists and who can see/request its services.
-- Supports role-based and parent-org-membership-based visibility.
--
-- INHERITANCE MODEL:
-- If no policy is defined for an org, it inherits from parent org.
-- Walk-up logic: check own policy → check parent → check grandparent → system default.
-- System default: org is visible only to its own members.
-- =============================================================================

CREATE TABLE blueprint.org_visibility_policies (
    id                  SERIAL PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES blueprint.organizations(id),

    -- Who can see this org exists in the system
    visibility_scope    TEXT NOT NULL DEFAULT 'members_only',
    -- 'members_only'      = only direct members of this org
    -- 'parent_members'    = members of this org AND parent org
    -- 'ancestor_members'  = members of any org in the ancestor chain
    -- 'role_based'        = controlled by allowed_role_ids below
    -- 'public'            = visible to all authenticated users in the node

    -- For role_based scope: which roles can see this org
    -- Roles from any org in the hierarchy qualify
    allowed_role_ids    INTEGER[],                          -- blueprint.roles.id[]

    -- Inheritance
    inherit_from_parent BOOLEAN NOT NULL DEFAULT TRUE,
    -- TRUE = if no explicit policy rows match, walk up to parent org's policy

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id)
);

-- =============================================================================
-- ORG TAGS
-- Lightweight labels attached to orgs for policy matching.
-- Used by visibility rules to express cross-tree access patterns
-- without explicit many-to-many relationships.
-- Examples: division:finance, region:us-east, tier:executive, type:external
-- =============================================================================

CREATE TABLE blueprint.org_tags (
    id                  SERIAL PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    tag_key             TEXT NOT NULL,                      -- 'division' | 'region' | 'tier' | 'type'
    tag_value           TEXT NOT NULL,                      -- 'finance' | 'us-east' | 'executive' | 'external'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, tag_key, tag_value)
);

-- =============================================================================
-- UNIVERSAL VISIBILITY RULES ENGINE
-- A single policy engine controlling access to any resource in the system.
-- Replaces resource-specific permission tables with one unified model.
--
-- Applies to:
--   'service_catalog_item'  — what appears in the catalog and who can request it
--   'work_item_type'        — who can create or see this type
--   'org'                   — who can see this org exists
--   'workflow'              — who can use or view this workflow
--
-- HOW IT WORKS:
--   Rules are evaluated in priority order (lower number = first).
--   First matching rule wins. Default (no rules) = owner org members only.
--   DENY rules can carve out exceptions from broad ALLOW rules.
--
-- SCALE DESIGN:
--   No explicit org-to-org relationships. Zero rows needed per new org.
--   Rules express policies; the org tree and org tags are evaluated at query time.
--   10 teams of 10 teams of 10 teams = same number of rules as 1 team.
--
-- SCOPE TYPES:
--   Tree position (scale infinitely, no maintenance):
--     'members_only'       — members of the owning org only
--     'direct_children'    — owning org + its direct child orgs
--     'all_descendants'    — owning org + entire subtree
--     'siblings'           — orgs sharing the same parent
--     'ancestor_members'   — any org that is an ancestor of the owning org
--     'same_depth'         — orgs at the same depth in the tree
--     'all_authenticated'  — any logged-in user in the node
--   Tag match (cross-tree, no maintenance):
--     'tag_match'          — any org tagged with tag_key:tag_value
--   Role scope:
--     'role_in_org'        — users with role in the owning org
--     'role_in_ancestor'   — users with role in any ancestor org
-- =============================================================================

CREATE TABLE blueprint.visibility_rules (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,

    -- What resource this rule applies to
    resource_type       TEXT NOT NULL,
    -- 'service_catalog_item' | 'work_item_type' | 'org' | 'workflow'
    resource_id         INTEGER NOT NULL,
    -- FK to the relevant table (polymorphic — enforced at application layer)

    -- What action this rule governs
    permission_type     TEXT NOT NULL DEFAULT 'view',
    -- 'view'     — can see this resource exists
    -- 'request'  — can submit a request / create an instance (catalog items, work item types)
    -- 'use'      — can assign this workflow to a work item type

    priority            INTEGER NOT NULL DEFAULT 0,         -- Lower = evaluated first

    -- Scope
    scope_type          TEXT NOT NULL,

    -- For tag_match scope
    tag_key             TEXT,
    tag_value           TEXT,

    -- For role_in_org / role_in_ancestor scope
    role_id             INTEGER REFERENCES blueprint.roles(id),

    -- Effect
    effect              TEXT NOT NULL DEFAULT 'allow',      -- 'allow' | 'deny'

    -- Notes — explains the intent of this rule (important for maintainability)
    notes               TEXT,
    -- e.g. 'Executive event planning — only requestable by executive tier roles'
    -- e.g. 'Automation only — deny all user requests'

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);





-- =============================================================================
-- ROLE INHERITANCE
-- Roles defined at a parent org can be recognized in child orgs.
-- A user with 'Executive' role in the parent org may automatically have
-- elevated visibility in all child orgs without explicit membership.
-- =============================================================================

CREATE TABLE blueprint.role_inheritance_policies (
    id                  SERIAL PRIMARY KEY,
    parent_org_id       INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    parent_role_id      INTEGER NOT NULL REFERENCES blueprint.roles(id),
    child_org_id        INTEGER REFERENCES blueprint.organizations(id),
    -- NULL = applies to ALL child orgs of parent_org_id

    -- What the inherited role grants in child orgs
    grants_visibility   BOOLEAN NOT NULL DEFAULT TRUE,      -- Can see child org exists
    grants_catalog_view BOOLEAN NOT NULL DEFAULT FALSE,     -- Can see child org's service catalog
    grants_catalog_request BOOLEAN NOT NULL DEFAULT FALSE,  -- Can request from child org's catalog
    grants_child_role_id INTEGER REFERENCES blueprint.roles(id),
    -- If set, user effectively has this role in the child org
    -- without being an explicit member

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (parent_org_id, parent_role_id, child_org_id)
);

-- =============================================================================
-- ORG MEMBERSHIPS — MULTI-ROLE SUPPORT
-- Updated to support multiple roles per user per org.
-- A user can be both 'Tech Lead' and 'Product Owner' in the same org.
-- =============================================================================

-- Drop the single-role constraint from org_memberships
-- and add a separate roles junction table

-- Note: original org_memberships.role_id is kept for primary/default role
-- Additional roles are stored in org_membership_roles

CREATE TABLE blueprint.org_membership_roles (
    id                  SERIAL PRIMARY KEY,
    org_membership_id   INTEGER NOT NULL REFERENCES blueprint.org_memberships(id),
    role_id             INTEGER NOT NULL REFERENCES blueprint.roles(id),
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by_user_id  INTEGER REFERENCES blueprint.users(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_membership_id, role_id)
);

-- =============================================================================
-- INHERITANCE POLICIES FOR KEY BLUEPRINT STRUCTURES
-- Defines how child orgs inherit or override parent definitions.
-- Applies to: workflows, work item types, service catalog items.
-- Pattern: check own definition → walk up tree → use system default.
-- =============================================================================

CREATE TABLE blueprint.inheritance_policies (
    id                  SERIAL PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    resource_type       TEXT NOT NULL,
    -- 'workflow'          = workflow definitions
    -- 'work_item_type'    = work item type definitions
    -- 'service_catalog'   = service catalog items
    -- 'business_calendar' = working hours calendar
    -- 'role'              = role definitions

    inheritance_mode    TEXT NOT NULL DEFAULT 'inherit_and_extend',
    -- 'own_only'          = use only definitions created for this org
    -- 'inherit'           = use parent definitions, cannot extend
    -- 'inherit_and_extend'= use parent definitions AND add own (most common)
    -- 'override'          = own definitions completely replace parent (no fallback)

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, resource_type)
);


-- Reusable templates that Work Item Types inherit from.
-- Renamed from 'classes' to avoid collision with reserved/common term.
-- =============================================================================

CREATE TABLE blueprint.work_item_type_classes (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,                      -- 'Software Feature' | 'Service Request' | 'Bug'
    description         TEXT,
    owner_org_id        INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    is_abstract         BOOLEAN NOT NULL DEFAULT FALSE,     -- Abstract classes cannot be instantiated directly
    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,     -- Shipped with system, cannot be deleted
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WORK ITEM TYPES
-- Inherits from a Work Item Type Class. Configured per organization.
-- Defines the shape of a specific kind of work.
-- =============================================================================

CREATE TABLE blueprint.work_item_types (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,                      -- 'Project Request' | 'Bug Report' | 'Delivery Task'
    description         TEXT,
    version             TEXT NOT NULL DEFAULT '1.0.0',      -- Semantic versioning for federation/compatibility
    class_id            INTEGER NOT NULL REFERENCES blueprint.work_item_type_classes(id),
    owner_org_id        INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    icon                TEXT,                               -- Icon identifier or emoji for board display
    color               TEXT,                               -- Hex color for card rendering
    is_published        BOOLEAN NOT NULL DEFAULT FALSE,     -- Published to service catalog
    is_externally_visible BOOLEAN NOT NULL DEFAULT FALSE,   -- Exposed outside the organization
    request_mode        TEXT NOT NULL DEFAULT 'user_requestable',
    -- 'user_requestable' — visible in catalog, any qualifying user can submit
    -- 'restricted'       — visible only to users passing visibility_rules
    -- 'automation_only'  — never visible in catalog, only triggered by connections/actions
    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,     -- Shipped with system, cannot be deleted
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    deprecated_at       TIMESTAMPTZ,                        -- Scheduled for decommission
    successor_type_id   INTEGER REFERENCES blueprint.work_item_types(id),
    extended_data       JSONB,                              -- Overflow bucket for additional type metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Custom fields defined per Work Item Type
-- Stored as field schema — values live in runtime schema
-- Note: estimation (hours, points, cost) is handled here as custom fields
CREATE TABLE blueprint.work_item_type_fields (
    id                  SERIAL PRIMARY KEY,
    work_item_type_id   INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    field_key           TEXT NOT NULL,                      -- Machine name: 'estimated_hours'
    field_label         TEXT NOT NULL,                      -- Display name: 'Estimated Hours'
    field_type          TEXT NOT NULL,
    -- 'text'|'number'|'date'|'boolean'|'select'|'multiselect'|'url'|'user'|'currency'
    field_options       JSONB,                              -- For select/multiselect: ["option1","option2"]
    field_group         TEXT,                               -- Grouping label: 'Estimation' | 'Details'
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,     -- Inherited from class, cannot be removed
    display_order       INTEGER NOT NULL DEFAULT 0,
    inherited_from_class_id INTEGER REFERENCES blueprint.work_item_type_classes(id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_item_type_id, field_key)
);

-- Allowed parent/child relationships between work item types
-- Defines decomposition rules: ProjectRequest → Feature → Task
CREATE TABLE blueprint.work_item_type_relationships (
    id                  SERIAL PRIMARY KEY,
    parent_type_id      INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    child_type_id       INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    relationship_kind   TEXT NOT NULL DEFAULT 'decomposition', -- 'decomposition' | 'dependency' | 'spawn'
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    min_children        INTEGER NOT NULL DEFAULT 0,
    max_children        INTEGER,                            -- NULL = unlimited
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (parent_type_id, child_type_id, relationship_kind)
);

-- =============================================================================
-- SERVICE CLASSES
-- Kanban service classes define the policy governing how a work item flows.
-- Attached to work item instances at runtime, defined here in blueprint.
-- This is distinct from work_item_type_classes — this is about flow policy,
-- not about what kind of work it is.
-- =============================================================================

CREATE TABLE blueprint.service_classes (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    org_id              INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    name                TEXT NOT NULL,                      -- 'Expedited' | 'Fixed Date' | 'Standard' | 'Deferred'
    description         TEXT,

    -- Visual differentiation on board
    color               TEXT,                               -- Hex color for card highlight
    icon                TEXT,                               -- Icon or emoji indicator

    -- Flow policy
    can_bypass_wip      BOOLEAN NOT NULL DEFAULT FALSE,     -- Expedited items can exceed WIP limits
    max_concurrent      INTEGER,                            -- Max items of this class in system at once. NULL = unlimited
    -- Expedited is typically limited to 1 at a time

    sla_hours           NUMERIC,                            -- Default SLA for this class. NULL = no class-level SLA
    is_date_driven      BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE for fixed-date: SLA is calculated from due_date field

    priority_order      INTEGER NOT NULL DEFAULT 0,         -- Lower number = higher priority for replenishment ordering

    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,     -- Shipped with system
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, name)
);

-- System default service classes (seeded per org on creation):
--   priority 0: 'Expedited'   — can_bypass_wip: true, max_concurrent: 1
--   priority 1: 'Fixed Date'  — is_date_driven: true
--   priority 2: 'Standard'    — default for all new work items
--   priority 3: 'Deferred'    — low urgency, fill spare capacity

-- =============================================================================
-- BUSINESS CALENDARS
-- Defines what counts as "working time" for an organization.
-- Flow metrics (cycle time, lead time, SLA) are calculated in working time,
-- not wall clock time.
--
-- A request that starts Monday 4:59pm and ends Tuesday 9:01am is either
-- 2 minutes or 16h 2min depending on the org's schedule. This table defines
-- which interpretation is correct for each org.
--
-- Sub-orgs inherit parent calendar unless they define their own.
-- Continuous (24/7) orgs use is_continuous = true — no schedule needed.
-- =============================================================================

CREATE TABLE blueprint.business_calendars (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    org_id              INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    name                TEXT NOT NULL,                      -- 'Standard US Business Hours' | '24/7 Operations'
    description         TEXT,
    timezone            TEXT NOT NULL,                      -- IANA timezone: 'America/New_York' | 'UTC' | 'Europe/London'
    is_continuous       BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE = 24/7, ignore schedule entirely
    is_inherited        BOOLEAN NOT NULL DEFAULT TRUE,      -- TRUE = use parent org's calendar
    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id)                                         -- One calendar definition per org
);

-- Working hours per day of week
-- Allows different hours per day: Mon-Thu 9-6, Fri 9-1
CREATE TABLE blueprint.calendar_working_hours (
    id                  SERIAL PRIMARY KEY,
    calendar_id         INTEGER NOT NULL REFERENCES blueprint.business_calendars(id),
    day_of_week         INTEGER NOT NULL,                   -- 0=Sunday, 1=Monday ... 6=Saturday
    is_working_day      BOOLEAN NOT NULL DEFAULT TRUE,      -- FALSE = weekend or non-working day
    start_time          TIME,                               -- NULL if is_working_day = false
    end_time            TIME,                               -- NULL if is_working_day = false
    -- Example: Monday, 09:00 to 17:00
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (calendar_id, day_of_week)
);

-- Holiday/exception dates — specific dates that override the weekly schedule
-- Can mark a normally working day as non-working (holiday)
-- or a normally non-working day as working (makeup day)
CREATE TABLE blueprint.calendar_exceptions (
    id                  SERIAL PRIMARY KEY,
    calendar_id         INTEGER NOT NULL REFERENCES blueprint.business_calendars(id),
    exception_date      DATE NOT NULL,                      -- '2026-07-04' | '2026-12-25'
    exception_name      TEXT,                               -- 'Independence Day' | 'Christmas'
    is_working_day      BOOLEAN NOT NULL DEFAULT FALSE,     -- FALSE = holiday, TRUE = makeup/special working day
    start_time          TIME,                               -- Only relevant if is_working_day = true
    end_time            TIME,                               -- Only relevant if is_working_day = true
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (calendar_id, exception_date)
);


-- Defines how and when items move from backlog into the first ready/queued stage.
-- Replenishment is a pull operation — it respects WIP limits on the destination.
-- =============================================================================

CREATE TABLE blueprint.workflows (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    description         TEXT,
    owner_org_id        INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    version             TEXT NOT NULL DEFAULT '1.0.0',
    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Links workflows to work item types
-- History preserved — only one is_current per type at a time
CREATE TABLE blueprint.work_item_type_workflows (
    id                  SERIAL PRIMARY KEY,
    work_item_type_id   INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    workflow_id         INTEGER NOT NULL REFERENCES blueprint.workflows(id),
    is_current          BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to        TIMESTAMPTZ,                        -- NULL = still current
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- STAGES
-- Nodes in the workflow directed graph.
-- =============================================================================

CREATE TABLE blueprint.stages (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    workflow_id         INTEGER NOT NULL REFERENCES blueprint.workflows(id),
    name                TEXT NOT NULL,                      -- 'QA Testing' | 'Legal Approval' | 'Code Review'
    description         TEXT,

    -- Universal vocabulary — enables cross-workflow board visibility
    stage_class         TEXT NOT NULL,
    -- 'intake'|'triage'|'queued'|'in-progress'|'blocked'|'review'|'approved'|'delivery'|'done'|'cancelled'

    -- Flow metric classification
    stage_type          TEXT NOT NULL,                      -- 'waiting' | 'working'

    -- Board display
    display_order       INTEGER NOT NULL DEFAULT 0,
    color               TEXT,

    -- SLA
    sla_hours           NUMERIC,                            -- NULL = no SLA

    -- Micro-state settings
    has_waiting_queue   BOOLEAN NOT NULL DEFAULT FALSE,
    waiting_label       TEXT,                               -- e.g. 'Waiting for Review'
    wip_limit           INTEGER,                            -- NULL = no limit
    requires_review     BOOLEAN NOT NULL DEFAULT FALSE,
    review_label        TEXT,                               -- e.g. 'Approve' | 'Sign Off'
    requires_evidence   BOOLEAN NOT NULL DEFAULT FALSE,
    evidence_types      TEXT[],                             -- 'photo'|'file'|'link'|'text_note'
    min_evidence_count  INTEGER NOT NULL DEFAULT 1,
    measure_substates   BOOLEAN NOT NULL DEFAULT FALSE,

    is_entry_stage      BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal         BOOLEAN NOT NULL DEFAULT FALSE,
    extended_data       JSONB,                              -- Overflow bucket for additional stage metadata
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stage transitions — edges of the directed graph
CREATE TABLE blueprint.stage_transitions (
    id                  SERIAL PRIMARY KEY,
    from_stage_id       INTEGER NOT NULL REFERENCES blueprint.stages(id),
    to_stage_id         INTEGER NOT NULL REFERENCES blueprint.stages(id),
    transition_label    TEXT,                               -- 'Approve' | 'Reject' | 'Escalate' | 'Cancel'
    transition_kind     TEXT NOT NULL DEFAULT 'forward',
    -- 'forward'|'backward'|'sideways'|'cross-workflow'
    -- Note: no 'refactor' kind — cancelling and creating a replacement
    -- uses atomic primitives: cancel (terminal transition) + create new + link origin
    target_workflow_id  INTEGER REFERENCES blueprint.workflows(id),
    requires_reason     BOOLEAN NOT NULL DEFAULT FALSE,     -- TRUE for cancel/reject transitions
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_stage_id, to_stage_id)
);

-- Role restrictions on transitions
-- If any rows exist for a transition, only those roles can execute it
CREATE TABLE blueprint.stage_transition_role_restrictions (
    id                  SERIAL PRIMARY KEY,
    stage_transition_id INTEGER NOT NULL REFERENCES blueprint.stage_transitions(id),
    role_id             INTEGER NOT NULL REFERENCES blueprint.roles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stage_transition_id, role_id)
);

-- =============================================================================
-- CHECKLISTS
-- Lightweight ordered acknowledgment lists attached to a stage.
-- NOT work items. No tracking, no metrics. Just checkboxes.
-- Can gate stage exit as part of exit criteria.
-- =============================================================================

CREATE TABLE blueprint.stage_checklists (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    stage_id            INTEGER NOT NULL REFERENCES blueprint.stages(id),
    name                TEXT NOT NULL,                      -- 'Pre-deployment Checklist'
    description         TEXT,
    is_blocking         BOOLEAN NOT NULL DEFAULT TRUE,      -- All items checked before stage exit?
    display_order       INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE blueprint.checklist_items (
    id                  SERIAL PRIMARY KEY,
    checklist_id        INTEGER NOT NULL REFERENCES blueprint.stage_checklists(id),
    label               TEXT NOT NULL,                      -- 'Estimate recorded in system'
    description         TEXT,                               -- Optional guidance
    is_required         BOOLEAN NOT NULL DEFAULT TRUE,
    display_order       INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EXIT CRITERIA
-- Conditions that must be met before a work item can leave a stage.
-- Tier 1: manual | Tier 2: codified | Tier 3: api
-- Checklists and evidence enforced separately via stage/checklist settings.
-- =============================================================================

CREATE TABLE blueprint.exit_criteria (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    stage_id            INTEGER NOT NULL REFERENCES blueprint.stages(id),
    name                TEXT NOT NULL,
    description         TEXT,
    criteria_tier       TEXT NOT NULL,                      -- 'manual' | 'codified' | 'api'
    display_order       INTEGER NOT NULL DEFAULT 0,

    -- Tier 2: codified
    codified_condition  JSONB,
    -- System evaluates a condition against runtime state. Examples:
    -- Check a field value:
    --   {"type":"field_value","field_key":"estimate_hours","operator":"gt","value":0}
    -- Check child work items of a specific type are all terminal:
    --   {"type":"child_items_terminal","work_item_type_id":42}
    -- Check at least N child items of a stage class are terminal:
    --   {"type":"child_stage_class_terminal","stage_class":"review","min_count":1}
    -- Check a checklist is fully complete:
    --   {"type":"checklist_complete","checklist_id":7}
    -- NOTE: child work items checked here were likely spawned by transition_actions
    -- or connections — but they live independently. This criteria just inspects
    -- their current state at transition time without caring how they got there.

    -- Tier 3: api
    api_endpoint        TEXT,
    api_method          TEXT DEFAULT 'GET',                 -- 'GET' | 'POST'
    api_payload_template JSONB,                             -- Can reference work item fields
    api_success_condition JSONB,
    -- {"path":"$.status","operator":"eq","value":"approved"}
    api_timeout_seconds INTEGER DEFAULT 10,

    is_blocking         BOOLEAN NOT NULL DEFAULT TRUE,      -- FALSE = advisory only
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TRANSITION ACTIONS
-- An ordered pipeline of actions that fire when a stage transition occurs.
-- Distinct from exit criteria — criteria GATE the transition,
-- actions EXECUTE as part of or after the transition.
--
-- IMPORTANT DISTINCTION:
--   Exit criteria owns all "blocking" logic — including checking that child
--   work items of a certain type are in a terminal stage before transitioning.
--   Transition actions are NEVER blocking the parent work item's flow.
--   Spawned work items live their own independent lives — the parent does not
--   track, wait for, or care about their outcome.
--
-- Action types:
--   'api_call'        — Fire an HTTP request as a side effect (log, notify, Salesforce etc.)
--   'spawn'           — Create a work item; it enters its intake stage and lives independently
--   'optional_spawn'  — Same as spawn but user is prompted first: "Create Release Notes?"
--   'notify'          — Send a notification to a role or user (future)
-- =============================================================================

CREATE TABLE blueprint.transition_actions (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    stage_transition_id INTEGER NOT NULL REFERENCES blueprint.stage_transitions(id),
    name                TEXT NOT NULL,                      -- 'Log to Splunk' | 'Create Release Notes' | 'Notify QA'
    description         TEXT,
    action_type         TEXT NOT NULL,
    -- 'api_call' | 'spawn' | 'optional_spawn' | 'notify'

    execution_timing    TEXT NOT NULL DEFAULT 'post',
    -- 'pre'  = executes before transition completes
    -- 'post' = executes after transition completes (most actions)

    display_order       INTEGER NOT NULL DEFAULT 0,

    -- -------------------------------------------------------------------------
    -- API CALL config (action_type = 'api_call')
    -- Fire and forget. Never blocks the transition.
    -- Use for: logging, webhooks, Salesforce events, external notifications etc.
    -- -------------------------------------------------------------------------
    api_endpoint        TEXT,
    api_method          TEXT DEFAULT 'POST',                -- 'GET' | 'POST' | 'PUT' | 'PATCH'
    api_headers         JSONB,                              -- {"Authorization": "Bearer {{secret}}"}
    api_payload_template JSONB,
    -- References work item fields using {{field_key}} syntax:
    -- {
    --   "event_type": "stage_transition",
    --   "work_item_uri": "{{uri}}",
    --   "title": "{{title}}",
    --   "org": "{{org_slug}}"
    -- }
    api_timeout_seconds INTEGER DEFAULT 10,
    api_on_failure      TEXT DEFAULT 'log',                 -- 'log' | 'retry'
    -- 'log'   = failure recorded, transition unaffected
    -- 'retry' = queued for background retry, transition unaffected
    -- NOTE: 'block' intentionally omitted — blocking belongs in exit criteria

    -- -------------------------------------------------------------------------
    -- SPAWN config (action_type = 'spawn' or 'optional_spawn')
    -- Creates a new work item that enters its own intake stage.
    -- Parent work item NEVER tracks or waits on spawned item.
    -- Spawned item may be completed, cancelled, or ignored — parent doesn't care.
    -- -------------------------------------------------------------------------
    spawn_work_item_type_id INTEGER REFERENCES blueprint.work_item_types(id),
    spawn_target_org_id     INTEGER REFERENCES blueprint.organizations(id),
    -- NULL = same org as source work item

    spawn_field_mapping     JSONB,
    -- Map source work item fields to spawned item's initial field values
    -- [{"source_field": "title", "target_field": "title"}]

    -- Optional spawn specific
    optional_spawn_prompt   TEXT,
    -- Shown to user after transition: "Would you like to create a Release Notes work item?"
    optional_spawn_default  BOOLEAN DEFAULT FALSE,
    -- Whether the prompt defaults to YES (true) or NO (false)

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- When a work item reaches a defined stage, automatically
-- create a new work item in another organization's workflow.
-- =============================================================================

CREATE TABLE blueprint.connections (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,                      -- 'Project Approval → PMO Estimation'
    description         TEXT,

    source_org_id       INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    source_work_item_type_id INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    trigger_stage_id    INTEGER NOT NULL REFERENCES blueprint.stages(id),
    trigger_on          TEXT NOT NULL DEFAULT 'enter',
    -- 'enter'|'exit'|'evidence_attached'|'criteria_met'|'checklist_complete'

    target_org_id       INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    target_work_item_type_id INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),

    field_mapping       JSONB,
    -- [{"source_field":"title","target_field":"title"},{"source_field":"uri","target_field":"origin_ref"}]

    -- Pending spawn support
    -- If spawn cannot be completed immediately, work item is created in 'pending' state
    -- pending_required_fields lists which fields must be populated before item becomes active
    pending_required_fields JSONB,
    -- ["description","estimated_hours","priority"]
    -- NULL means spawn is always immediate — no pending state
    allow_rejection     BOOLEAN NOT NULL DEFAULT TRUE,      -- Can receiving org reject the spawned item?
    rejection_returns_to_stage_id INTEGER REFERENCES blueprint.stages(id),
    -- If rejected, source work item returns to this stage. NULL = no automatic return.

    relationship_kind   TEXT NOT NULL DEFAULT 'spawn',      -- 'spawn' | 'notify' | 'block'
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
CREATE TABLE blueprint.replenishment_policies (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    workflow_id         INTEGER NOT NULL REFERENCES blueprint.workflows(id),
    name                TEXT NOT NULL,                      -- 'Weekly Replenishment' | 'On-Demand Pull'

    source_stage_id     INTEGER NOT NULL REFERENCES blueprint.stages(id),
    -- The backlog/intake stage items are pulled FROM

    destination_stage_id INTEGER NOT NULL REFERENCES blueprint.stages(id),
    -- The ready/queued stage items are pulled INTO

    -- Scheduling
    cadence             TEXT,                               -- 'manual' | 'daily' | 'weekly' | 'per_sprint'
    cadence_config      JSONB,
    -- For weekly: {"day_of_week": "monday", "time": "09:00"}

    -- Pull rules
    max_pull_count      INTEGER,                            -- Max items to pull per replenishment. NULL = fill to WIP limit
    ordering_field      TEXT NOT NULL DEFAULT 'priority_order',
    -- How to order candidates: 'priority_order' | 'arrival_date' | 'due_date' | 'service_class'

    -- Service class priority is respected automatically via service_classes.priority_order
    respect_service_class_priority BOOLEAN NOT NULL DEFAULT TRUE,

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ORGANIZATION TEMPLATES
-- Starter kits cloned when a new sub-org is created.
-- =============================================================================

CREATE TABLE blueprint.org_templates (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,                      -- 'Basic Team Board' | 'Software Delivery Team'
    description         TEXT,
    owner_org_id        INTEGER REFERENCES blueprint.organizations(id),
    -- NULL = system-level template
    default_workflow_id INTEGER REFERENCES blueprint.workflows(id),
    clones_service_classes BOOLEAN NOT NULL DEFAULT TRUE,
    clones_work_item_types BOOLEAN NOT NULL DEFAULT TRUE,
    is_system_default   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- SERVICE CATALOG
-- What an organization offers to others.
-- Requesting a service instantiates a work item of the linked type.
-- =============================================================================

CREATE TABLE blueprint.service_catalog_items (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    description         TEXT,
    owner_org_id        INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    work_item_type_id   INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    is_internal         BOOLEAN NOT NULL DEFAULT TRUE,      -- Internal org use only
    is_cross_org        BOOLEAN NOT NULL DEFAULT FALSE,     -- Available to other orgs in same node
    is_external         BOOLEAN NOT NULL DEFAULT FALSE,     -- Exposed outside system (contact forms etc)
    request_mode        TEXT NOT NULL DEFAULT 'user_requestable',
    -- 'user_requestable' — appears in catalog, user can fill form and submit
    -- 'restricted'       — appears only to users passing visibility_rules for this item
    -- 'automation_only'  — hidden from all catalog views, only triggered by automation
    external_slug       TEXT UNIQUE,                        -- URL slug: /request/project-request
    requires_approval   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WORKFLOWS
-- Assigned to a Work Item Type.
-- A workflow is a directed graph of stages.
-- =============================================================================


-- =============================================================================
-- DEFERRED FOREIGN KEYS
-- Added after referenced tables exist
-- =============================================================================

ALTER TABLE blueprint.organizations
    ADD CONSTRAINT fk_org_calendar
    FOREIGN KEY (calendar_id)
    REFERENCES blueprint.business_calendars(id);

ALTER TABLE blueprint.organizations
    ADD CONSTRAINT fk_org_default_template
    FOREIGN KEY (default_template_id)
    REFERENCES blueprint.org_templates(id);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_calendar_org              ON blueprint.business_calendars(org_id);
CREATE INDEX idx_calendar_hours_calendar   ON blueprint.calendar_working_hours(calendar_id);
CREATE INDEX idx_calendar_exceptions_date  ON blueprint.calendar_exceptions(calendar_id, exception_date);

CREATE INDEX idx_service_classes_org        ON blueprint.service_classes(org_id);
CREATE INDEX idx_replenishment_workflow     ON blueprint.replenishment_policies(workflow_id);
CREATE INDEX idx_replenishment_source       ON blueprint.replenishment_policies(source_stage_id);
CREATE INDEX idx_replenishment_dest         ON blueprint.replenishment_policies(destination_stage_id);

CREATE INDEX idx_visibility_rules_resource  ON blueprint.visibility_rules(resource_type, resource_id);
CREATE INDEX idx_visibility_rules_scope     ON blueprint.visibility_rules(scope_type);
CREATE INDEX idx_visibility_rules_tag       ON blueprint.visibility_rules(tag_key, tag_value);
CREATE INDEX idx_visibility_rules_role      ON blueprint.visibility_rules(role_id);
CREATE INDEX idx_org_visibility_org         ON blueprint.org_visibility_policies(org_id);
CREATE INDEX idx_role_inheritance_parent    ON blueprint.role_inheritance_policies(parent_org_id);
CREATE INDEX idx_role_inheritance_child     ON blueprint.role_inheritance_policies(child_org_id);
CREATE INDEX idx_org_membership_roles       ON blueprint.org_membership_roles(org_membership_id);
CREATE INDEX idx_inheritance_policies_org   ON blueprint.inheritance_policies(org_id);

CREATE INDEX idx_organizations_parent       ON blueprint.organizations(parent_id);
CREATE INDEX idx_organizations_slug         ON blueprint.organizations(slug);
CREATE INDEX idx_org_memberships_user       ON blueprint.org_memberships(user_id);
CREATE INDEX idx_org_memberships_org        ON blueprint.org_memberships(org_id);
CREATE INDEX idx_roles_org                  ON blueprint.roles(org_id);
CREATE INDEX idx_wit_class                  ON blueprint.work_item_types(class_id);
CREATE INDEX idx_wit_org                    ON blueprint.work_item_types(owner_org_id);
CREATE INDEX idx_wit_fields_type            ON blueprint.work_item_type_fields(work_item_type_id);
CREATE INDEX idx_wit_relationships_parent   ON blueprint.work_item_type_relationships(parent_type_id);
CREATE INDEX idx_wit_relationships_child    ON blueprint.work_item_type_relationships(child_type_id);
CREATE INDEX idx_stages_workflow            ON blueprint.stages(workflow_id);
CREATE INDEX idx_stages_class               ON blueprint.stages(stage_class);
CREATE INDEX idx_stage_transitions_from     ON blueprint.stage_transitions(from_stage_id);
CREATE INDEX idx_stage_transitions_to       ON blueprint.stage_transitions(to_stage_id);
CREATE INDEX idx_transition_role_restrict   ON blueprint.stage_transition_role_restrictions(stage_transition_id);
CREATE INDEX idx_checklists_stage           ON blueprint.stage_checklists(stage_id);
CREATE INDEX idx_checklist_items_list       ON blueprint.checklist_items(checklist_id);
CREATE INDEX idx_exit_criteria_stage        ON blueprint.exit_criteria(stage_id);
CREATE INDEX idx_transition_actions_transition ON blueprint.transition_actions(stage_transition_id);
CREATE INDEX idx_transition_actions_type      ON blueprint.transition_actions(action_type);
CREATE INDEX idx_transition_actions_spawn_type ON blueprint.transition_actions(spawn_work_item_type_id);

CREATE INDEX idx_connections_source_org     ON blueprint.connections(source_org_id);
CREATE INDEX idx_connections_target_org     ON blueprint.connections(target_org_id);
CREATE INDEX idx_connections_trigger_stage  ON blueprint.connections(trigger_stage_id);

-- =============================================================================
-- END BLUEPRINT SCHEMA v1.2
-- =============================================================================
