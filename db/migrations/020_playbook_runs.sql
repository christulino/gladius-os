-- Migration 020: playbook_runs observability table
-- Tracks every playbook execution: status lifecycle, model, tokens, entries written, errors.

CREATE TABLE IF NOT EXISTS runtime.playbook_runs (
  id              bigserial PRIMARY KEY,
  work_item_id    integer   NOT NULL REFERENCES runtime.work_items(id) ON DELETE CASCADE,
  stage_id        integer   NOT NULL REFERENCES blueprint.stages(id)   ON DELETE CASCADE,
  playbook_id     integer   REFERENCES blueprint.stage_playbooks(id)   ON DELETE SET NULL,
  status          text      NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'success', 'failed')),
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  stop_reason     text,
  entries_written integer,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_playbook_runs_work_item
  ON runtime.playbook_runs (work_item_id, started_at DESC);
