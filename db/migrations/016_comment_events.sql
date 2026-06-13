-- Migration 016: Add comment_edited / comment_deleted notification defaults
-- and is_edited flag on work_item_comments

ALTER TABLE runtime.work_item_comments
  ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT false;

INSERT INTO blueprint.notification_defaults (relationship_type, event_type, enabled)
VALUES
  ('owns',       'work_item.comment_edited',   true),
  ('working_on', 'work_item.comment_edited',   true),
  ('reviewing',  'work_item.comment_edited',   true),
  ('watching',   'work_item.comment_edited',   true),
  ('owns',       'work_item.comment_deleted',  true),
  ('working_on', 'work_item.comment_deleted',  true),
  ('reviewing',  'work_item.comment_deleted',  true),
  ('watching',   'work_item.comment_deleted',  true)
ON CONFLICT (relationship_type, event_type) DO NOTHING;
