/**
 * tests/helpers/poolTeardown.js
 *
 * Closes the shared PostgreSQL pool (db/postgres.js) so a `node --test`
 * process that touched it can exit on its own.
 *
 * WHY (DEBT.26643): db/postgres.js's pool has min:2 and no idleTimeoutMillis,
 * by design for the long-lived server process. Every `node --test` process
 * that imports it -- directly, or transitively via tests/helpers/testOrg.js,
 * testStage.js, or cleanup.js -- keeps a live connection open and never
 * exits on its own; it sits as a zombie until manually killed. This is a
 * test-infrastructure-only fix: the running server's pool is untouched.
 *
 * Node's test runner spawns one child process per test file (isolation:
 * 'process'), so each process that touches the pool must close it itself --
 * there is no single global hook that spans files. The shared piece is this
 * function, not the registration: each test file calls closePool() from its
 * OWN root-level `after()`, appended as the LAST top-level statement in the
 * file so it registers -- and therefore runs -- after any of the file's own
 * cleanup hooks (root-level `after()` hooks run in registration order; see
 * tests/helpers/README or DEBT.26643 PR description for the empirical check).
 * Closing the pool before a teardown hook's DELETE queries run would break
 * that cleanup, so ordering matters here.
 *
 * USAGE (last lines of a test file):
 *
 *   import { closePool } from './helpers/poolTeardown.js'
 *   ...
 *   // Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
 *   after(closePool)
 */

import { pool } from '../../db/postgres.js'

let closed = false

/**
 * Idempotently closes the shared PG pool. Safe to call more than once
 * (e.g. if a file registers it from more than one place) -- only the
 * first call actually ends the pool.
 */
export async function closePool() {
  if (closed) return
  closed = true
  await pool.end()
}
