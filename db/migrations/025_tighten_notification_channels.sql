-- db/migrations/025_tighten_notification_channels.sql
-- Notification delivery was cut down to agent + in_app only (email/webhook
-- channel modules were never built and were removed from scope), but the
-- live CHECK constraints from migration 012 (untouched by 013's table
-- recreation) still permit 'email' and 'webhook' as channel values on both
-- blueprint.user_notification_channels and runtime.notification_deliveries.
-- This tightens both constraints to the channel set the code actually
-- supports:
--   - user_notification_channels: 'in_app', 'agent' (the two channels a user
--     can hold a preference row for; email/webhook were never delivered).
--   - notification_deliveries: 'agent' only (in_app notifications are read
--     directly from runtime.notifications, never routed through the
--     delivery outbox — see runtime/subscribers/notifications.js
--     fetchEnabledOutOfBandChannels, which only ever selects channel='agent').
--
-- Idempotent: legacy rows (if any exist) are re-labelled to 'agent' before
-- the constraint is added, and the constraint is dropped (IF EXISTS) before
-- being re-added with the same definition, so this is safe to re-run.

-- =============================================================================
-- blueprint.user_notification_channels
-- =============================================================================

ALTER TABLE blueprint.user_notification_channels
  DROP CONSTRAINT IF EXISTS user_notification_channels_channel_check;

-- No live code ever wrote 'email'/'webhook' rows, but if any exist (e.g. from
-- manual testing or an older build), disable and re-label them rather than
-- deleting user preference rows outright.
UPDATE blueprint.user_notification_channels
  SET channel = 'agent'
  WHERE channel IN ('email', 'webhook');

ALTER TABLE blueprint.user_notification_channels
  ADD CONSTRAINT user_notification_channels_channel_check
  CHECK (channel IN ('in_app', 'agent'));

-- =============================================================================
-- runtime.notification_deliveries
-- =============================================================================

ALTER TABLE runtime.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;

-- Delivery rows are only ever inserted for channel='agent' (see
-- fetchEnabledOutOfBandChannels). Any legacy 'email'/'webhook' delivery rows
-- are dead outbox entries that will never be picked up by a live channel
-- module — delete them rather than re-labelling, since re-labelling would
-- fabricate a delivery attempt that never happened.
DELETE FROM runtime.notification_deliveries
  WHERE channel IN ('email', 'webhook');

ALTER TABLE runtime.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('agent'));
