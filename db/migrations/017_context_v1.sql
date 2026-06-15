-- db/migrations/017_context_v1.sql
-- Context v1: journal entries, org context library, stage playbooks, org AI models

CREATE TABLE IF NOT EXISTS runtime.context_entries (
  id              SERIAL PRIMARY KEY,
  work_item_id    INTEGER NOT NULL REFERENCES runtime.work_items(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT,
  content         TEXT NOT NULL DEFAULT '',
  visibility      TEXT NOT NULL DEFAULT 'item' CHECK (visibility IN ('item','descendants')),
  tags            TEXT[] NOT NULL DEFAULT '{}',
  author_id       INTEGER REFERENCES blueprint.users(id),
  is_agent        BOOLEAN NOT NULL DEFAULT false,
  is_edited       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_context_entries_work_item ON runtime.context_entries(work_item_id);
CREATE INDEX IF NOT EXISTS idx_context_entries_type      ON runtime.context_entries(type);

CREATE TABLE IF NOT EXISTS blueprint.org_context (
  id          SERIAL PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES blueprint.organizations(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  author_id   INTEGER REFERENCES blueprint.users(id),
  is_edited   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_context_org ON blueprint.org_context(org_id);

CREATE TABLE IF NOT EXISTS blueprint.stage_playbooks (
  id          SERIAL PRIMARY KEY,
  stage_id    INTEGER REFERENCES blueprint.stages(id) ON DELETE CASCADE,
  wit_type_id INTEGER REFERENCES blueprint.work_item_types(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stage_playbooks_has_scope CHECK (stage_id IS NOT NULL OR wit_type_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stage_playbooks_stage   ON blueprint.stage_playbooks(stage_id);
CREATE INDEX IF NOT EXISTS idx_stage_playbooks_type    ON blueprint.stage_playbooks(wit_type_id);

CREATE TABLE IF NOT EXISTS blueprint.org_ai_models (
  id           SERIAL PRIMARY KEY,
  org_id       INTEGER NOT NULL REFERENCES blueprint.organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'anthropic',
  model        TEXT NOT NULL,
  api_key_enc  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

INSERT INTO blueprint.notification_defaults (relationship_type, event_type, enabled)
VALUES
  ('owns',       'work_item.context_entry_added', true),
  ('working_on', 'work_item.context_entry_added', true),
  ('reviewing',  'work_item.context_entry_added', true),
  ('watching',   'work_item.context_entry_added', true)
ON CONFLICT (relationship_type, event_type) DO NOTHING;
