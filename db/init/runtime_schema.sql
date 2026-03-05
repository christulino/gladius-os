-- =============================================================================
-- FLOW OS — RUNTIME SCHEMA v0.4
-- PostgreSQL
-- Work item instances and all activity data.
-- No structural definitions live here — those are in the blueprint schema.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS runtime;

-- =============================================================================
-- WORK ITEMS
-- Instances of blueprint.work_item_types.
-- The core unit of the system. Everything else is attached to or derived from this.
--
-- Key principles:
--   - No required assignee. Work is tracked, not people.
--   - Timing is sacred. Every state change is timestamped.
--   - No hard deletes. Work items are cancelled, not destroyed.
--   - Unlimited hierarchy. A work item can have a parent and children.
--   - Origin reference. If this item was spawned or created from another, we know.
-- =============================================================================

CREATE TABLE runtime.work_items (
    id                      SERIAL PRIMARY KEY,
    uri                     TEXT NOT NULL UNIQUE,           -- flowos://org-slug/work-items/uuid

    -- Blueprint references
    work_item_type_id       INTEGER NOT NULL,               -- blueprint.work_item_types.id
    workflow_id             INTEGER NOT NULL,               -- blueprint.workflows.id (snapshot at creation)
    owner_org_id            INTEGER NOT NULL,               -- blueprint.organizations.id

    -- Identity
    title                   TEXT NOT NULL,
    description             TEXT,

    -- Current state
    current_stage_id        INTEGER NOT NULL,               -- blueprint.stages.id
    current_substate        TEXT,                           -- 'waiting' | 'active' | 'review' — micro-state
    spawn_state             TEXT NOT NULL DEFAULT 'active',
    -- 'pending'  = created but missing required fields, not yet in workflow
    -- 'active'   = normal, in workflow
    -- 'cancelled'= terminal, cancelled with reason
    -- 'done'     = terminal, completed

    -- Service class (Kanban policy)
    service_class_id        INTEGER,                        -- blueprint.service_classes.id
    -- NULL defaults to 'standard' at application layer

    due_date                TIMESTAMPTZ,                    -- For fixed-date service class items

    -- Hierarchy
    parent_id               INTEGER REFERENCES runtime.work_items(id),
    -- NULL = top-level work item

    -- Origin — where did this work item come from?
    origin_work_item_id     INTEGER REFERENCES runtime.work_items(id),
    -- NULL = created directly by a user
    -- Set when spawned by a transition_action or connection
    origin_connection_id    INTEGER,                        -- blueprint.connections.id if spawned via connection
    origin_transition_action_id INTEGER,                    -- blueprint.transition_actions.id if spawned via action

    -- Cancellation
    cancelled_at            TIMESTAMPTZ,
    cancelled_reason        TEXT,
    cancelled_by_user_id    INTEGER,                        -- blueprint.users.id

    -- Pending state support
    pending_since           TIMESTAMPTZ,                    -- When item entered pending state
    pending_missing_fields  JSONB,                          -- Which required fields are still empty
    -- ["description", "estimated_hours"]

    -- Custom field values (defined by blueprint.work_item_type_fields)
    -- All field values stored here as JSONB keyed by field_key
    field_values            JSONB NOT NULL DEFAULT '{}',
    -- {"estimated_hours": 8, "priority": "high", "release_version": "2026.03.00"}

    extended_data           JSONB,

    -- Timestamps
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    entered_current_stage_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- STAGE TRANSITION HISTORY
-- Every stage transition a work item has ever made.
-- This is the source of truth for all flow metrics.
-- Never updated — only appended.
-- =============================================================================

CREATE TABLE runtime.stage_transition_history (
    id                      SERIAL PRIMARY KEY,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),

    -- Transition taken
    from_stage_id           INTEGER NOT NULL,               -- blueprint.stages.id
    to_stage_id             INTEGER NOT NULL,               -- blueprint.stages.id
    stage_transition_id     INTEGER,                        -- blueprint.stage_transitions.id (NULL if system-forced)

    -- Timing — the sacred record
    entered_from_stage_at   TIMESTAMPTZ NOT NULL,           -- When work item entered from_stage
    exited_from_stage_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When work item left from_stage

    -- Wall clock time — always recorded regardless of calendar
    time_in_stage_seconds   INTEGER GENERATED ALWAYS AS
                            (EXTRACT(EPOCH FROM (exited_from_stage_at - entered_from_stage_at))::INTEGER)
                            STORED,

    -- Working time — calculated by Node.js using org's business calendar, then stored
    -- NULL until calculated. Recalculated if calendar changes retroactively.
    working_time_in_stage_seconds INTEGER,
    calendar_id             INTEGER,                        -- blueprint.business_calendars.id used for calculation
    -- Storing which calendar was used allows recalculation if calendar changes

    -- Who and why
    transitioned_by_user_id INTEGER,                        -- blueprint.users.id. NULL = system/automated
    transition_reason       TEXT,                           -- Required for cancel/reject transitions
    was_automated           BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE if triggered by connection or action

    -- Substate tracking (if blueprint.stages.measure_substates = true)
    substate_log            JSONB,
    -- [{"substate":"waiting","entered_at":"...","exited_at":"...","seconds":3600},
    --  {"substate":"active","entered_at":"...","exited_at":"...","seconds":7200}]

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at — this record is immutable
);

-- =============================================================================
-- SUBSTATE HISTORY
-- Only populated when blueprint.stages.measure_substates = true.
-- Tracks time in waiting vs. active vs. review sub-states within a stage.
-- Kept separate from transition history for query efficiency.
-- =============================================================================

CREATE TABLE runtime.substate_history (
    id                      SERIAL PRIMARY KEY,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),
    stage_id                INTEGER NOT NULL,               -- blueprint.stages.id
    substate                TEXT NOT NULL,                  -- 'waiting' | 'active' | 'review'
    entered_at              TIMESTAMPTZ NOT NULL,
    exited_at               TIMESTAMPTZ,                    -- NULL = currently in this substate
    duration_seconds        INTEGER GENERATED ALWAYS AS
                            (CASE WHEN exited_at IS NOT NULL
                             THEN EXTRACT(EPOCH FROM (exited_at - entered_at))::INTEGER
                             ELSE NULL END)
                            STORED,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- CHECKLIST COMPLETIONS
-- Runtime state of blueprint checklist items for each work item.
-- One row per checklist item per work item — created when work item enters stage.
-- =============================================================================

CREATE TABLE runtime.checklist_completions (
    id                      SERIAL PRIMARY KEY,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),
    checklist_id            INTEGER NOT NULL,               -- blueprint.stage_checklists.id
    checklist_item_id       INTEGER NOT NULL,               -- blueprint.checklist_items.id
    is_checked              BOOLEAN NOT NULL DEFAULT FALSE,
    checked_at              TIMESTAMPTZ,
    checked_by_user_id      INTEGER,                        -- blueprint.users.id
    note                    TEXT,                           -- Optional note when checking item
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_item_id, checklist_item_id)
);

-- =============================================================================
-- EVIDENCE
-- Attachments proving work completion at a stage.
-- Required when blueprint.stages.requires_evidence = true.
-- Metadata lives here. Binaries live in object storage (S3-compatible).
-- =============================================================================

CREATE TABLE runtime.evidence (
    id                      SERIAL PRIMARY KEY,
    uri                     TEXT NOT NULL UNIQUE,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),
    stage_id                INTEGER NOT NULL,               -- blueprint.stages.id — which stage this evidence is for
    evidence_type           TEXT NOT NULL,                  -- 'photo' | 'file' | 'link' | 'text_note'

    -- For photo and file types
    storage_key             TEXT,                           -- Object storage key: 'evidence/org-slug/uuid.jpg'
    file_name               TEXT,                           -- Original filename
    file_size_bytes         INTEGER,
    mime_type               TEXT,

    -- For link type
    url                     TEXT,
    url_title               TEXT,                           -- Optional display title for the link

    -- For text_note type
    note_text               TEXT,

    -- Who and when
    submitted_by_user_id    INTEGER NOT NULL,               -- blueprint.users.id
    submitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Can be invalidated (e.g. wrong photo uploaded) without deletion
    is_valid                BOOLEAN NOT NULL DEFAULT TRUE,
    invalidated_at          TIMESTAMPTZ,
    invalidated_by_user_id  INTEGER,
    invalidation_reason     TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EXIT CRITERIA STATUS
-- Runtime evaluation state of exit criteria for each work item.
-- Tracks which criteria are met, which are pending, which are waived.
-- Created when work item enters a stage that has exit criteria.
-- =============================================================================

CREATE TABLE runtime.exit_criteria_status (
    id                      SERIAL PRIMARY KEY,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),
    exit_criteria_id        INTEGER NOT NULL,               -- blueprint.exit_criteria.id
    stage_id                INTEGER NOT NULL,               -- blueprint.stages.id

    status                  TEXT NOT NULL DEFAULT 'pending',
    -- 'pending'  = not yet evaluated or not yet met
    -- 'met'      = criteria satisfied, transition allowed
    -- 'waived'   = manually overridden by authorized user
    -- 'failed'   = API call failed or codified check returned false

    -- For manual criteria — human acknowledgment
    acknowledged_by_user_id INTEGER,                        -- blueprint.users.id
    acknowledged_at         TIMESTAMPTZ,

    -- For codified criteria — last evaluation result
    last_evaluated_at       TIMESTAMPTZ,
    evaluation_result       JSONB,                          -- Raw result of last evaluation

    -- For API criteria — last call result
    last_api_called_at      TIMESTAMPTZ,
    api_response_code       INTEGER,
    api_response_body       JSONB,

    -- Waiver
    waived_by_user_id       INTEGER,                        -- blueprint.users.id
    waived_at               TIMESTAMPTZ,
    waiver_reason           TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_item_id, exit_criteria_id)
);

-- =============================================================================
-- TRANSITION ACTION LOG
-- Execution record for every transition action that fires.
-- Immutable audit trail. Never updated.
-- =============================================================================

CREATE TABLE runtime.transition_action_log (
    id                      SERIAL PRIMARY KEY,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),
    transition_action_id    INTEGER NOT NULL,               -- blueprint.transition_actions.id
    stage_transition_history_id INTEGER NOT NULL REFERENCES runtime.stage_transition_history(id),

    action_type             TEXT NOT NULL,                  -- 'api_call' | 'spawn' | 'optional_spawn' | 'notify'
    executed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    was_accepted            BOOLEAN,
    -- NULL = not applicable (api_call, notify)
    -- TRUE = user accepted optional_spawn prompt
    -- FALSE = user declined optional_spawn prompt

    -- API call result
    api_endpoint            TEXT,
    api_response_code       INTEGER,
    api_response_body       JSONB,
    api_failed              BOOLEAN,
    api_failure_reason      TEXT,

    -- Spawn result
    spawned_work_item_id    INTEGER REFERENCES runtime.work_items(id),
    -- NULL if spawn was declined or failed

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WORK ITEM USER RELATIONSHIPS
-- Models the relationship between users and work items semantically.
-- Replaces the common anti-pattern of a single 'assignee' field.
-- Multiple users can have different relationship types to the same work item.
-- =============================================================================

CREATE TABLE runtime.work_item_user_relationships (
    id                      SERIAL PRIMARY KEY,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),
    user_id                 INTEGER NOT NULL,               -- blueprint.users.id
    relationship_type       TEXT NOT NULL,
    -- 'requested_by'  = submitted the request
    -- 'owns'          = accountable for the outcome (typically one)
    -- 'working_on'    = actively doing the work (can be many)
    -- 'reviewing'     = currently in review substate for this item
    -- 'approved_by'   = signed off / approved
    -- 'watching'      = subscribed to updates, no active role
    assigned_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by_user_id     INTEGER,                        -- Who made this assignment. NULL = system
    unassigned_at           TIMESTAMPTZ,                    -- NULL = still active relationship
    unassigned_reason       TEXT,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (work_item_id, user_id, relationship_type)
);

CREATE INDEX idx_wiur_work_item     ON runtime.work_item_user_relationships(work_item_id);
CREATE INDEX idx_wiur_user          ON runtime.work_item_user_relationships(user_id);
CREATE INDEX idx_wiur_type          ON runtime.work_item_user_relationships(relationship_type);
-- Key query: "show me all work items this user is working_on across all orgs"
CREATE INDEX idx_wiur_user_type     ON runtime.work_item_user_relationships(user_id, relationship_type, is_active);


-- Threaded comments on work items.
-- Separate from evidence — comments are discussion, evidence is proof.
-- =============================================================================

CREATE TABLE runtime.work_item_comments (
    id                      SERIAL PRIMARY KEY,
    uri                     TEXT NOT NULL UNIQUE,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),
    parent_comment_id       INTEGER REFERENCES runtime.work_item_comments(id),
    -- NULL = top-level comment. Set = reply in thread.
    author_user_id          INTEGER NOT NULL,               -- blueprint.users.id
    body                    TEXT NOT NULL,
    is_system_generated     BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE for automated activity comments
    is_edited               BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- FLOW METRICS SNAPSHOTS
-- Derived metrics cached for board and dashboard performance.
-- Recomputed on each stage transition — never manually entered.
-- Source of truth is always stage_transition_history.
-- This table is a performance cache only — can be rebuilt from history at any time.
-- =============================================================================

CREATE TABLE runtime.flow_metrics_snapshots (
    id                      SERIAL PRIMARY KEY,
    work_item_id            INTEGER NOT NULL REFERENCES runtime.work_items(id),

    -- Computed at last transition
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Lead time: from work item created_at to now (or done_at if terminal)
    lead_time_seconds           INTEGER,                    -- Wall clock
    lead_time_working_seconds   INTEGER,                    -- Working time per org calendar

    -- Cycle time: from first 'working' stage entry to now (or done_at)
    cycle_time_seconds          INTEGER,                    -- Wall clock
    cycle_time_working_seconds  INTEGER,                    -- Working time per org calendar

    -- Time blocked: total seconds spent in stages with stage_type = 'waiting'
    total_wait_seconds          INTEGER,                    -- Wall clock
    total_wait_working_seconds  INTEGER,                    -- Working time per org calendar

    -- Flow efficiency: working cycle_time / working lead_time as a percentage
    -- Uses working time for meaningful comparison across orgs with different schedules
    flow_efficiency_pct         NUMERIC(5,2),

    -- Current stage SLA status
    current_stage_sla_hours NUMERIC,                        -- From blueprint.stages.sla_hours
    current_stage_elapsed_hours NUMERIC,                    -- Hours in current stage
    sla_status              TEXT,
    -- 'on_track' | 'at_risk' | 'breached' | 'no_sla'

    -- Stage entry time (denormalized from work_items for query performance)
    entered_current_stage_at TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ORG FLOW METRICS
-- Aggregate metrics per org per time window.
-- Recomputed on a schedule (daily/hourly depending on org size).
-- Used for dashboards and health monitors.
-- =============================================================================

CREATE TABLE runtime.org_flow_metrics (
    id                      SERIAL PRIMARY KEY,
    org_id                  INTEGER NOT NULL,               -- blueprint.organizations.id
    workflow_id             INTEGER,                        -- blueprint.workflows.id. NULL = all workflows
    window_start            TIMESTAMPTZ NOT NULL,
    window_end              TIMESTAMPTZ NOT NULL,
    window_type             TEXT NOT NULL,                  -- 'daily' | 'weekly' | 'monthly'

    -- Throughput: items completed in window
    throughput_count        INTEGER NOT NULL DEFAULT 0,

    -- Arrival rate: items created in window
    arrival_rate_count      INTEGER NOT NULL DEFAULT 0,

    -- Average cycle time across completed items in window
    avg_cycle_time_seconds  INTEGER,

    -- Average lead time across completed items in window
    avg_lead_time_seconds   INTEGER,

    -- WIP at end of window
    wip_count               INTEGER,

    -- Queue depth at end of window (items in waiting stages)
    queue_depth_count       INTEGER,

    -- Average flow efficiency across completed items
    avg_flow_efficiency_pct NUMERIC(5,2),

    -- Takt time: window_seconds / arrival_rate_count
    takt_time_seconds       INTEGER,

    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, workflow_id, window_start, window_type)
);

-- =============================================================================
-- REPLENISHMENT LOG
-- Record of every replenishment event — when items were pulled from
-- backlog into ready stage, by whom or by what schedule.
-- =============================================================================

CREATE TABLE runtime.replenishment_log (
    id                      SERIAL PRIMARY KEY,
    replenishment_policy_id INTEGER NOT NULL,               -- blueprint.replenishment_policies.id
    org_id                  INTEGER NOT NULL,               -- blueprint.organizations.id
    executed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_by_user_id     INTEGER,                        -- blueprint.users.id. NULL = scheduled/automated
    was_automated           BOOLEAN NOT NULL DEFAULT FALSE,

    -- Results
    items_evaluated         INTEGER NOT NULL DEFAULT 0,     -- Items in backlog considered
    items_pulled            INTEGER NOT NULL DEFAULT 0,     -- Items actually moved to ready stage
    items_skipped           INTEGER NOT NULL DEFAULT 0,     -- Items not pulled (WIP limit reached etc.)
    pulled_work_item_ids    INTEGER[],                      -- Array of work_item ids that were pulled

    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- NOTIFICATIONS / ACTIVITY FEED
-- In-app alerts generated by system events.
-- Separate from comments — notifications are system-generated,
-- comments are user-generated discussion.
--
-- Events that generate notifications:
--   - Work item assigned (work_item_user_relationships created)
--   - Stage transition on a watched item
--   - Exit criteria blocked (item cannot move forward)
--   - Spawn created (your request generated a downstream work item)
--   - Optional spawn accepted/declined
--   - SLA breached
--   - Comment on a watched item
--   - Pending work item requires your attention
-- =============================================================================

CREATE TABLE runtime.notifications (
    id                      SERIAL PRIMARY KEY,
    uri                     TEXT NOT NULL UNIQUE,
    user_id                 INTEGER NOT NULL,               -- blueprint.users.id — who receives this
    notification_type       TEXT NOT NULL,
    -- 'assignment'     | 'stage_transition' | 'criteria_blocked'
    -- 'spawn_created'  | 'sla_breached'     | 'comment_added'
    -- 'pending_action' | 'item_cancelled'   | 'approval_needed'

    -- What triggered this notification
    work_item_id            INTEGER REFERENCES runtime.work_items(id),
    source_user_id          INTEGER,                        -- blueprint.users.id — who caused the event. NULL = system
    stage_transition_history_id INTEGER REFERENCES runtime.stage_transition_history(id),

    -- Content
    title                   TEXT NOT NULL,                  -- 'Your request is blocked'
    body                    TEXT,                           -- Short description of what happened
    action_url              TEXT,                           -- Deep link to the relevant item/stage

    -- State
    is_read                 BOOLEAN NOT NULL DEFAULT FALSE,
    read_at                 TIMESTAMPTZ,
    is_dismissed            BOOLEAN NOT NULL DEFAULT FALSE,
    dismissed_at            TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification preferences per user
-- Controls which event types generate notifications and via which channel
CREATE TABLE runtime.notification_preferences (
    id                      SERIAL PRIMARY KEY,
    user_id                 INTEGER NOT NULL,               -- blueprint.users.id
    notification_type       TEXT NOT NULL,                  -- Matches notifications.notification_type
    channel                 TEXT NOT NULL DEFAULT 'in_app', -- 'in_app' | 'email' | 'webhook'
    is_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, notification_type, channel)
);

-- =============================================================================
-- BOARD VIEW STATE
-- Saved board configurations per user per org/workflow.
-- Boards are inherently personal — two users looking at the same org's work
-- may want very different filters, column widths, and groupings.
-- System-level board configs (shared defaults) are also supported.
-- =============================================================================

CREATE TABLE runtime.board_views (
    id                      SERIAL PRIMARY KEY,
    uri                     TEXT NOT NULL UNIQUE,
    name                    TEXT NOT NULL,                  -- 'My Active Work' | 'Sprint Board' | 'Release View'
    owner_user_id           INTEGER,                        -- blueprint.users.id. NULL = shared/system board
    org_id                  INTEGER NOT NULL,               -- blueprint.organizations.id
    workflow_id             INTEGER,                        -- blueprint.workflows.id. NULL = all workflows

    -- Scope
    is_personal             BOOLEAN NOT NULL DEFAULT TRUE,  -- TRUE = only visible to owner_user_id
    is_shared               BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = visible to all org members
    is_default              BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = shown by default to new org members

    -- Filter configuration
    -- Stored as JSONB — flexible enough to handle any filter combination
    -- without needing a separate filter rows table
    filters                 JSONB,
    -- {
    --   "stage_classes": ["in-progress", "review"],
    --   "service_class_ids": [1, 2],
    --   "work_item_type_ids": [3, 4],
    --   "relationship_type": "working_on",   -- show only items I'm working on
    --   "sla_status": ["at_risk", "breached"],
    --   "spawn_states": ["active"],
    --   "due_before": "2026-04-01"
    -- }

    -- Column/display configuration
    column_config           JSONB,
    -- {
    --   "group_by": "stage_class",           -- 'stage' | 'stage_class' | 'service_class'
    --   "card_size": "compact",              -- 'compact' | 'normal' | 'detailed'
    --   "show_metrics": true,                -- show SLA indicators on cards
    --   "show_substate_columns": true,       -- expand micro-state sub-columns
    --   "collapsed_stages": [5, 7]           -- stage ids that are collapsed
    -- }

    -- Sort
    sort_config             JSONB,
    -- {"field": "entered_current_stage_at", "direction": "asc"}

    last_used_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- SEARCH INDEX HINTS
-- Lightweight table that tells the search layer what to index and how.
-- Full-text search itself is handled externally (PostgreSQL tsvector,
-- Elasticsearch, or similar) — this table drives what gets fed to it.
--
-- Indexed resources:
--   - Work items (title, description, field_values)
--   - Comments
--   - Organizations
--   - Service catalog items
--
-- On each write to those tables, the application queues an index update.
-- This table tracks the queue state so nothing is missed.
-- =============================================================================

CREATE TABLE runtime.search_index_queue (
    id                      SERIAL PRIMARY KEY,
    resource_type           TEXT NOT NULL,
    -- 'work_item' | 'comment' | 'org' | 'catalog_item'
    resource_id             INTEGER NOT NULL,
    operation               TEXT NOT NULL,                  -- 'index' | 'reindex' | 'delete'
    status                  TEXT NOT NULL DEFAULT 'pending',-- 'pending' | 'processing' | 'done' | 'failed'
    queued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at            TIMESTAMPTZ,
    error_message           TEXT,
    retry_count             INTEGER NOT NULL DEFAULT 0
);

-- =============================================================================
-- INDEXES — REMAINING RUNTIME TABLES
-- =============================================================================

CREATE INDEX idx_notifications_user         ON runtime.notifications(user_id);
CREATE INDEX idx_notifications_work_item    ON runtime.notifications(work_item_id);
CREATE INDEX idx_notifications_unread       ON runtime.notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notif_prefs_user           ON runtime.notification_preferences(user_id);
CREATE INDEX idx_board_views_user           ON runtime.board_views(owner_user_id);
CREATE INDEX idx_board_views_org            ON runtime.board_views(org_id);
CREATE INDEX idx_board_views_shared         ON runtime.board_views(org_id, is_shared) WHERE is_shared = TRUE;
CREATE INDEX idx_search_queue_status        ON runtime.search_index_queue(status, queued_at);
CREATE INDEX idx_search_queue_resource      ON runtime.search_index_queue(resource_type, resource_id);



-- Work items — primary access patterns
CREATE INDEX idx_wi_owner_org          ON runtime.work_items(owner_org_id);
CREATE INDEX idx_wi_type               ON runtime.work_items(work_item_type_id);
CREATE INDEX idx_wi_current_stage      ON runtime.work_items(current_stage_id);
CREATE INDEX idx_wi_parent             ON runtime.work_items(parent_id);
CREATE INDEX idx_wi_origin             ON runtime.work_items(origin_work_item_id);
CREATE INDEX idx_wi_spawn_state        ON runtime.work_items(spawn_state);
CREATE INDEX idx_wi_service_class      ON runtime.work_items(service_class_id);
CREATE INDEX idx_wi_due_date           ON runtime.work_items(due_date);

-- Board query — most common: all active items in org, grouped by stage and service class
-- Covers: owner_org_id filter + stage column + service class swimlane + substate sub-column
CREATE INDEX idx_wi_board              ON runtime.work_items(owner_org_id, current_stage_id, service_class_id, spawn_state, current_substate);

-- Transition history — never updated, heavily queried for metrics
CREATE INDEX idx_sth_work_item         ON runtime.stage_transition_history(work_item_id);
CREATE INDEX idx_sth_from_stage        ON runtime.stage_transition_history(from_stage_id);
CREATE INDEX idx_sth_to_stage          ON runtime.stage_transition_history(to_stage_id);
CREATE INDEX idx_sth_exited_at         ON runtime.stage_transition_history(exited_from_stage_at);

-- Substate history
CREATE INDEX idx_ssh_work_item         ON runtime.substate_history(work_item_id);
CREATE INDEX idx_ssh_stage             ON runtime.substate_history(stage_id);

-- Evidence
CREATE INDEX idx_evidence_work_item    ON runtime.evidence(work_item_id);
CREATE INDEX idx_evidence_stage        ON runtime.evidence(stage_id);

-- Exit criteria status
CREATE INDEX idx_ecs_work_item         ON runtime.exit_criteria_status(work_item_id);
CREATE INDEX idx_ecs_criteria          ON runtime.exit_criteria_status(exit_criteria_id);
CREATE INDEX idx_ecs_status            ON runtime.exit_criteria_status(status);

-- Checklist completions
CREATE INDEX idx_cc_work_item          ON runtime.checklist_completions(work_item_id);
CREATE INDEX idx_cc_checklist          ON runtime.checklist_completions(checklist_id);

-- Transition action log
CREATE INDEX idx_tal_work_item         ON runtime.transition_action_log(work_item_id);
CREATE INDEX idx_tal_action            ON runtime.transition_action_log(transition_action_id);
CREATE INDEX idx_tal_spawned           ON runtime.transition_action_log(spawned_work_item_id);

-- Comments
CREATE INDEX idx_comments_work_item    ON runtime.work_item_comments(work_item_id);
CREATE INDEX idx_comments_parent       ON runtime.work_item_comments(parent_comment_id);

-- Flow metrics
CREATE INDEX idx_fms_work_item         ON runtime.flow_metrics_snapshots(work_item_id);
CREATE INDEX idx_fms_sla_status        ON runtime.flow_metrics_snapshots(sla_status);
CREATE INDEX idx_ofm_org               ON runtime.org_flow_metrics(org_id);
CREATE INDEX idx_ofm_window            ON runtime.org_flow_metrics(window_start, window_end);

-- Replenishment log
CREATE INDEX idx_rlog_policy           ON runtime.replenishment_log(replenishment_policy_id);
CREATE INDEX idx_rlog_org              ON runtime.replenishment_log(org_id);

-- =============================================================================
-- END RUNTIME SCHEMA v0.4
-- =============================================================================
