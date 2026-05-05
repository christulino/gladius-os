-- db/migrations/014_search_v1.sql
-- Search v1: tsvector index, saved filters, reserved JQL keys, translator usage log.
-- Idempotent.

-- 1. Search index denorm
CREATE TABLE IF NOT EXISTS runtime.work_item_search (
  work_item_id      INTEGER PRIMARY KEY REFERENCES runtime.work_items(id) ON DELETE CASCADE,
  search_doc        tsvector NOT NULL,
  title_text        TEXT NOT NULL DEFAULT '',
  description_text  TEXT NOT NULL DEFAULT '',
  custom_text       TEXT NOT NULL DEFAULT '',
  comments_text     TEXT NOT NULL DEFAULT '',
  refreshed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_item_search_doc
  ON runtime.work_item_search USING GIN (search_doc);

-- 2. Trigram support for substring matches on key/title
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_work_items_title_trgm
  ON runtime.work_items USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_work_items_display_key_trgm
  ON runtime.work_items USING GIN (display_key gin_trgm_ops);

-- 3. Saved filters
CREATE TABLE IF NOT EXISTS blueprint.saved_filters (
  id              SERIAL PRIMARY KEY,
  uri             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  jql             TEXT NOT NULL,
  owner_user_id   INTEGER NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  share_scope     TEXT NOT NULL CHECK (share_scope IN ('private', 'org', 'global')),
  owner_org_id    INTEGER REFERENCES blueprint.organizations(id) ON DELETE CASCADE,
  sort_spec       JSONB NOT NULL DEFAULT '{}'::jsonb,
  column_spec     JSONB NOT NULL DEFAULT '{}'::jsonb,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT saved_filters_scope_consistency CHECK (
    (share_scope = 'org'     AND owner_org_id IS NOT NULL) OR
    (share_scope = 'private' AND owner_org_id IS NULL)     OR
    (share_scope = 'global'  AND owner_org_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_owner ON blueprint.saved_filters(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_saved_filters_org   ON blueprint.saved_filters(owner_org_id) WHERE owner_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_filters_scope ON blueprint.saved_filters(share_scope);

-- 4. Reserved JQL field keys
CREATE TABLE IF NOT EXISTS blueprint.reserved_field_keys (
  field_key TEXT PRIMARY KEY,
  reason    TEXT NOT NULL DEFAULT 'JQL native field'
);

INSERT INTO blueprint.reserved_field_keys (field_key, reason) VALUES
  ('id','JQL native'), ('key','JQL native'), ('title','JQL native'),
  ('description','JQL native'), ('text','JQL native'),
  ('status','JQL native'), ('stage_class','JQL native'), ('substate','JQL native'),
  ('org','JQL native'), ('type','JQL native'), ('workflow','JQL native'),
  ('priority','JQL native'), ('tags','JQL native'),
  ('assignee','JQL native'), ('owner','JQL native'), ('requester','JQL native'), ('watcher','JQL native'),
  ('is_expedited','JQL native'), ('work_nature','JQL native'),
  ('due_date','JQL native'), ('created','JQL native'), ('updated','JQL native'),
  ('started','JQL native'), ('resolved','JQL native'),
  ('parent','JQL native'), ('origin','JQL native'),
  ('estimate','JQL native'), ('estimate_unit','JQL native')
ON CONFLICT (field_key) DO NOTHING;

-- 5. Translator usage log
CREATE TABLE IF NOT EXISTS runtime.translator_usage (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  prompt_chars    INTEGER NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('success','parse_fail','non_jql','timeout','upstream_error','rate_limited','budget_exhausted')),
  retry_count     SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_translator_usage_user_day
  ON runtime.translator_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_translator_usage_day
  ON runtime.translator_usage(created_at);

-- 6. Retire orphan
DROP TABLE IF EXISTS runtime.search_index_queue CASCADE;
