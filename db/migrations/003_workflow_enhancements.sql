-- Migration 003: Workflow enhancements
-- Adds stage_function taxonomy and throughput tracking

-- Stage function: ordered taxonomy for cross-workflow board grouping
-- queue < planning < action < validation < review < deliver
ALTER TABLE blueprint.stages
  ADD COLUMN IF NOT EXISTS stage_function TEXT
  CHECK (stage_function IN ('queue', 'planning', 'action', 'validation', 'review', 'deliver'));

-- Distinguish throughput-counting done stages from non-counting terminal stages
ALTER TABLE blueprint.stages
  ADD COLUMN IF NOT EXISTS counts_toward_throughput BOOLEAN NOT NULL DEFAULT TRUE;

-- Update existing stages: cancelled-class stages don't count toward throughput
UPDATE blueprint.stages SET counts_toward_throughput = FALSE WHERE stage_class = 'cancelled';

-- Default stage_function based on stage_class
UPDATE blueprint.stages SET stage_function = CASE
  WHEN stage_class IN ('intake', 'queued')     THEN 'queue'
  WHEN stage_class IN ('triage')               THEN 'planning'
  WHEN stage_class IN ('in-progress', 'blocked') THEN 'action'
  WHEN stage_class IN ('review')               THEN 'validation'
  WHEN stage_class IN ('approved')             THEN 'review'
  WHEN stage_class IN ('delivery', 'done', 'cancelled') THEN 'deliver'
  ELSE NULL
END
WHERE stage_function IS NULL;

-- Link work item type classes to a default workflow
ALTER TABLE blueprint.work_item_type_classes
  ADD COLUMN IF NOT EXISTS default_workflow_id INTEGER REFERENCES blueprint.workflows(id);
