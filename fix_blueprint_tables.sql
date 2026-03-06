-- fix_blueprint_tables.sql
-- Adds missing blueprint tables: exit_criteria, transition_actions, connections
-- Run with: docker exec -i flowos-postgres psql -U flowos -d flowos < fix_blueprint_tables.sql

CREATE TABLE blueprint.exit_criteria (
    id                  SERIAL PRIMARY KEY,
    uri                 TEXT NOT NULL UNIQUE,
    stage_id            INTEGER NOT NULL REFERENCES blueprint.stages(id),
    name                TEXT NOT NULL,
    description         TEXT,
    criteria_tier       TEXT NOT NULL,
    display_order       INTEGER NOT NULL DEFAULT 0,
    codified_condition  JSONB,
    api_endpoint        TEXT,
    api_method          TEXT DEFAULT 'GET',
    api_payload_template JSONB,
    api_success_condition JSONB,
    api_timeout_seconds INTEGER DEFAULT 10,
    is_blocking         BOOLEAN NOT NULL DEFAULT TRUE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE blueprint.transition_actions (
    id                      SERIAL PRIMARY KEY,
    uri                     TEXT NOT NULL UNIQUE,
    stage_transition_id     INTEGER NOT NULL REFERENCES blueprint.stage_transitions(id),
    name                    TEXT NOT NULL,
    description             TEXT,
    action_type             TEXT NOT NULL,
    execution_timing        TEXT NOT NULL DEFAULT 'post',
    display_order           INTEGER NOT NULL DEFAULT 0,
    api_endpoint            TEXT,
    api_method              TEXT DEFAULT 'POST',
    api_headers             JSONB,
    api_payload_template    JSONB,
    api_timeout_seconds     INTEGER DEFAULT 10,
    api_on_failure          TEXT DEFAULT 'log',
    spawn_work_item_type_id INTEGER REFERENCES blueprint.work_item_types(id),
    spawn_target_org_id     INTEGER REFERENCES blueprint.organizations(id),
    spawn_field_mapping     JSONB,
    optional_spawn_prompt   TEXT,
    optional_spawn_default  BOOLEAN DEFAULT FALSE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE blueprint.connections (
    id                          SERIAL PRIMARY KEY,
    uri                         TEXT NOT NULL UNIQUE,
    name                        TEXT NOT NULL,
    description                 TEXT,
    source_org_id               INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    source_work_item_type_id    INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    trigger_stage_id            INTEGER NOT NULL REFERENCES blueprint.stages(id),
    trigger_on                  TEXT NOT NULL DEFAULT 'enter',
    target_org_id               INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    target_work_item_type_id    INTEGER NOT NULL REFERENCES blueprint.work_item_types(id),
    field_mapping               JSONB,
    pending_required_fields     JSONB,
    allow_rejection             BOOLEAN NOT NULL DEFAULT TRUE,
    rejection_returns_to_stage_id INTEGER REFERENCES blueprint.stages(id),
    relationship_kind           TEXT NOT NULL DEFAULT 'spawn',
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
