-- Migration 022: enforce the journal entry-type taxonomy on runtime.context_entries
-- Adds a CHECK constraint so the DB rejects unknown types even when callers
-- bypass the application layer (runtime/contextTypes.js).
--
-- blueprint.org_context is intentionally NOT constrained here: its types are
-- freely named by the org (e.g. "architecture", "domain", "process").
--
-- Valid types: nfr, discovery, acceptance, design, decision, note, test-plan, playbook
-- Keep in sync with runtime/contextTypes.js and mcp/toolsManifest.js.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'runtime'
      AND table_name   = 'context_entries'
      AND constraint_name = 'context_entries_type_check'
  ) THEN
    ALTER TABLE runtime.context_entries
      ADD CONSTRAINT context_entries_type_check
      CHECK (type IN ('nfr','discovery','acceptance','design','decision','note','test-plan','playbook'));
  END IF;
END;
$$;
