-- db/migrations/023_drop_neo4j_sync_subscriber.sql
-- Neo4j sync was removed (graph/sync.js is a no-op stub; no subscriber module
-- registers 'neo4j-sync' anymore). This leftover row in runtime.event_subscribers
-- was still advancing its cursor for events nothing reads. Delete it.
-- Idempotent: DELETE is naturally safe to run more than once.
DELETE FROM runtime.event_subscribers WHERE name = 'neo4j-sync';
