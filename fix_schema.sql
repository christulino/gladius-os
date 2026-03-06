-- fix_schema.sql
-- Adds missing tables that didn't get created during Docker init.
-- Run with: docker exec -i flowos-postgres psql -U flowos -d flowos < fix_schema.sql

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

CREATE TABLE blueprint.work_item_type_workflows (
    id                  SERIAL PRIMARY KEY,
    work_item_type_id   INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    workflow_id         INTEGER NOT NULL REFERENCES blueprint.workflows(id),
    is_current          BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE blueprint.stages (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    workflow_id         INTEGER NOT NULL REFERENCES blueprint.workflows(id),
    name                TEXT NOT NULL,
    description         TEXT,
    stage_class         TEXT NOT NULL,
    stage_type          TEXT NOT NULL,
    display_order       INTEGER NOT NULL DEFAULT 0,
    color               TEXT,
    sla_hours           NUMERIC,
    has_waiting_queue   BOOLEAN NOT NULL DEFAULT FALSE,
    waiting_label       TEXT,
    wip_limit           INTEGER,
    requires_review     BOOLEAN NOT NULL DEFAULT FALSE,
    review_label        TEXT,
    requires_evidence   BOOLEAN NOT NULL DEFAULT FALSE,
    evidence_types      TEXT[],
    min_evidence_count  INTEGER NOT NULL DEFAULT 1,
    measure_substates   BOOLEAN NOT NULL DEFAULT FALSE,
    is_entry_stage      BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal         BOOLEAN NOT NULL DEFAULT FALSE,
    extended_data       JSONB,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE blueprint.stage_transitions (
    id                  SERIAL PRIMARY KEY,
    from_stage_id       INTEGER NOT NULL REFERENCES blueprint.stages(id),
    to_stage_id         INTEGER NOT NULL REFERENCES blueprint.stages(id),
    transition_label    TEXT,
    transition_kind     TEXT NOT NULL DEFAULT 'forward',
    target_workflow_id  INTEGER REFERENCES blueprint.workflows(id),
    requires_reason     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_stage_id, to_stage_id)
);

CREATE TABLE blueprint.stage_transition_role_restrictions (
    id                  SERIAL PRIMARY KEY,
    stage_transition_id INTEGER NOT NULL REFERENCES blueprint.stage_transitions(id),
    role_id             INTEGER NOT NULL REFERENCES blueprint.roles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stage_transition_id, role_id)
);
