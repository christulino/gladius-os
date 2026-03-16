-- Migration 009: Stage-class-level WIP limits
-- Hierarchical WIP: stage_class limits span all stages of that class,
-- stage-level limits (org_wip_limits) apply per-stage. Both are independent.
-- If class limit is 10 and stage limit is 3, both are enforced/warned separately.

CREATE TABLE IF NOT EXISTS blueprint.org_wip_limits_by_class (
    id               SERIAL PRIMARY KEY,
    org_id           INTEGER NOT NULL REFERENCES blueprint.organizations(id),
    stage_class      TEXT NOT NULL,
    wip_limit        INTEGER NOT NULL CHECK (wip_limit > 0),
    enforcement_type TEXT NOT NULL DEFAULT 'soft' CHECK (enforcement_type IN ('soft', 'hard')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, stage_class)
);

CREATE INDEX idx_org_wip_class_org ON blueprint.org_wip_limits_by_class(org_id);
