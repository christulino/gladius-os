-- db/migrations/018_drop_jql.sql
-- Replace saved_filters.jql TEXT with filter_params JSONB.
-- Existing rows are migrated as { "keyword": <jql_string> } so they remain
-- searchable as full-text keyword queries.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'blueprint'
      AND table_name = 'saved_filters'
      AND column_name = 'jql'
  ) THEN
    ALTER TABLE blueprint.saved_filters ADD COLUMN IF NOT EXISTS filter_params JSONB;
    UPDATE blueprint.saved_filters
      SET filter_params = jsonb_build_object('keyword', jql)
     WHERE filter_params IS NULL;
    ALTER TABLE blueprint.saved_filters ALTER COLUMN filter_params SET NOT NULL;
    ALTER TABLE blueprint.saved_filters DROP COLUMN jql;
  END IF;
END $$;
