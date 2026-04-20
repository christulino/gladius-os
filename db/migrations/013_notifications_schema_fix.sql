-- Migration 013: Fix runtime.notifications to match the plan-012 spec
-- The table existed before migration 012 ran, so CREATE TABLE IF NOT EXISTS
-- silently skipped it. This migration drops the old structure and creates
-- the correct one. The table is empty so there is no data to preserve.

-- =============================================================================
-- Drop stale notification_deliveries first (FK references notifications)
-- =============================================================================

DROP TABLE IF EXISTS runtime.notification_deliveries;

-- =============================================================================
-- Drop old notifications table and recreate with correct schema
-- =============================================================================

DROP TABLE IF EXISTS runtime.notifications;

CREATE TABLE runtime.notifications (
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
-- Recreate delivery outbox (now references the correct notifications.id type)
-- =============================================================================

CREATE TABLE runtime.notification_deliveries (
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
