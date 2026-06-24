-- Migration 021: add execution_owner to stage_playbooks
-- Controls whether the in-server executor or an external agent owns playbook execution.
-- 'in_server' (default): existing behavior preserved.
-- 'agent': in-server executor skips; external agent is responsible.

ALTER TABLE blueprint.stage_playbooks
  ADD COLUMN IF NOT EXISTS execution_owner TEXT NOT NULL DEFAULT 'in_server';

-- Add constraint only if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'blueprint'
      AND table_name = 'stage_playbooks'
      AND constraint_name = 'stage_playbooks_execution_owner_check'
  ) THEN
    ALTER TABLE blueprint.stage_playbooks
      ADD CONSTRAINT stage_playbooks_execution_owner_check
      CHECK (execution_owner IN ('in_server', 'agent'));
  END IF;
END;
$$;
