-- Migration 012: Notifications
-- Adds notification defaults, per-user channels, overrides, notifications table,
-- delivery outbox, and is_agent flag on users.

-- =============================================================================
-- is_agent flag on users
-- =============================================================================

ALTER TABLE blueprint.users
  ADD COLUMN IF NOT EXISTS is_agent BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- Default matrix (seeded, structural)
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.notification_defaults (
  relationship_type TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (relationship_type, event_type)
);

-- Seed the matrix. See spec §Default Matrix.
INSERT INTO blueprint.notification_defaults (relationship_type, event_type, enabled)
VALUES
  ('watching',   'work_item.created',             true),
  ('watching',   'work_item.edited',              true),
  ('owns',       'work_item.transitioned',        true),
  ('working_on', 'work_item.transitioned',        true),
  ('watching',   'work_item.transitioned',        true),
  ('requester',  'work_item.transitioned',        true),
  ('owns',       'work_item.substate_changed',    true),
  ('working_on', 'work_item.substate_changed',    true),
  ('watching',   'work_item.substate_changed',    true),
  ('owns',       'work_item.assigned',            true),
  ('working_on', 'work_item.assigned',            true),
  ('reviewing',  'work_item.assigned',            true),
  ('watching',   'work_item.assigned',            true),
  ('owns',       'work_item.commented',           true),
  ('working_on', 'work_item.commented',           true),
  ('reviewing',  'work_item.commented',           true),
  ('watching',   'work_item.commented',           true),
  ('requester',  'work_item.commented',           true),
  ('mentioned',  'work_item.commented',           true),
  ('owns',       'work_item.spawned',             true),
  ('watching',   'work_item.spawned',             true),
  ('requester',  'work_item.spawned',             true),
  ('owns',       'exit_criteria.acknowledged',    true),
  ('working_on', 'exit_criteria.acknowledged',    true),
  ('reviewing',  'exit_criteria.acknowledged',    true),
  ('watching',   'exit_criteria.acknowledged',    true),
  ('owns',       'exit_criteria.unacknowledged',  true),
  ('working_on', 'exit_criteria.unacknowledged',  true),
  ('reviewing',  'exit_criteria.unacknowledged',  true),
  ('watching',   'exit_criteria.unacknowledged',  true),
  ('owns',       'exit_criteria.waived',          true),
  ('working_on', 'exit_criteria.waived',          true),
  ('reviewing',  'exit_criteria.waived',          true),
  ('watching',   'exit_criteria.waived',          true),
  ('requester',  'exit_criteria.waived',          true),
  ('owns',       'work_item.linked',              true),
  ('watching',   'work_item.linked',              true)
ON CONFLICT (relationship_type, event_type) DO NOTHING;

-- =============================================================================
-- Per-user channel config (hybrid: typed columns + config JSONB)
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.user_notification_channels (
  user_id          INTEGER     NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  channel          TEXT        NOT NULL CHECK (channel IN ('in_app','email','webhook','agent')),
  is_enabled       BOOLEAN     NOT NULL DEFAULT true,
  digest           TEXT        NOT NULL DEFAULT 'realtime'
                                 CHECK (digest IN ('realtime','hourly','daily')),
  next_digest_at   TIMESTAMPTZ,
  config           JSONB       NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, channel)
);

-- =============================================================================
-- Per-user matrix overrides (sparse)
-- =============================================================================

CREATE TABLE IF NOT EXISTS blueprint.user_notification_overrides (
  user_id           INTEGER NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  relationship_type TEXT    NOT NULL,
  event_type        TEXT    NOT NULL,
  enabled           BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, relationship_type, event_type)
);

-- =============================================================================
-- In-app inbox
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.notifications (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       INTEGER     NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  event_id      BIGINT      NOT NULL REFERENCES runtime.events(id) ON DELETE CASCADE,
  work_item_id  INTEGER     REFERENCES runtime.work_items(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,
  reasons       TEXT[]      NOT NULL,
  summary       TEXT        NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON runtime.notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_workitem
  ON runtime.notifications (user_id, work_item_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON runtime.notifications (user_id, id DESC);

-- =============================================================================
-- Delivery outbox
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime.notification_deliveries (
  id               BIGSERIAL   PRIMARY KEY,
  notification_id  BIGINT      NOT NULL REFERENCES runtime.notifications(id) ON DELETE CASCADE,
  channel          TEXT        NOT NULL CHECK (channel IN ('email','webhook','agent')),
  status           TEXT        NOT NULL CHECK (status IN ('pending','sent','failed')) DEFAULT 'pending',
  attempt_count    INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_pending
  ON runtime.notification_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_deliveries_notification
  ON runtime.notification_deliveries (notification_id);

-- Seed the subscriber row so the processor picks it up on next boot.
INSERT INTO runtime.event_subscribers (name, last_processed_event_id)
VALUES ('notifications', COALESCE((SELECT MAX(id) FROM runtime.events), 0))
ON CONFLICT (name) DO NOTHING;
