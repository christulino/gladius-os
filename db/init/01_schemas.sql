-- db/init/01_schemas.sql
-- Runs automatically when the PostgreSQL container starts for the first time.
-- Order matters — blueprint schema must be created before runtime schema.
--
-- To re-run after changes:
--   docker compose down -v   (destroys data)
--   docker compose up -d     (recreates from scratch)

\echo 'Creating blueprint schema...'
\i /docker-entrypoint-initdb.d/blueprint_schema.sql

\echo 'Creating runtime schema...'
\i /docker-entrypoint-initdb.d/runtime_schema.sql

\echo 'Schema creation complete.'
