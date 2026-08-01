/**
 * tests/helpers/testUser.js
 *
 * Provisions ephemeral test users for integration-test isolation. Tests that
 * need an actor ID (event actor_id, context-entry author_id, waiving user)
 * should use this instead of hardcoding dogfood user IDs.
 *
 * WHY: ~7 integration test files hardcoded live-dogfood user IDs — 112 (Chris),
 * 309 (agent@flowos.internal), 8 (a translator-usage test user). Those rows
 * exist only on the long-lived dogfood database. On a freshly-seeded or CI
 * database (which seeds users 1 and 2 only) every insert that referenced them
 * failed with FK violation 23503, so the full suite could not run in CI
 * (DEBT.26841). Provisioning the actor makes each file self-sufficient.
 *
 * TEARDOWN ORDER MATTERS. blueprint.users is referenced by
 * runtime.context_entries (author_id, resolved_by) and blueprint.org_context
 * (author_id) with NO on-delete action — those are RESTRICT, so deleting a
 * user still referenced by a context entry raises 23503. Work-item deletion
 * CASCADEs context_entries and org deletion CASCADEs org_context, so users
 * must be dropped AFTER the org that owns their writes. `createTestOrg`
 * sequences this for you; standalone callers must do it themselves.
 *
 * USAGE (standalone):
 *
 *   import { createTestUser } from './helpers/testUser.js'
 *
 *   let actor
 *   before(async () => { actor = await createTestUser() })
 *   after(async ()  => { await actor.teardown() })
 *   // ... actor.id
 *
 * USAGE (via createTestOrg — preferred, handles ordering):
 *
 *   testOrg = await createTestOrg()
 *   testOrg.userId       // human actor
 *   testOrg.agentUserId  // agent actor (is_agent = true)
 */

import { randomUUID } from 'node:crypto'
import { query } from '../../db/postgres.js'

/**
 * Create an ephemeral user row.
 *
 * Uses a direct INSERT rather than the HTTP API: there is no user-creation
 * endpoint (users arrive via /auth/setup or the seed), and these rows exist
 * purely to satisfy actor FKs.
 *
 * `email` and `uri` are both UNIQUE NOT NULL, so both are UUID-suffixed —
 * Date.now() alone collides when files run concurrently.
 *
 * @param {{ isAgent?: boolean, isAdmin?: boolean, orgId?: number|null }} [opts]
 *   orgId — when set, also grants org membership (needed only by tests whose
 *   code path resolves org visibility for the actor).
 * @returns {Promise<{ id: number, email: string, teardown: () => Promise<void> }>}
 */
export async function createTestUser({ isAgent = false, isAdmin = false, orgId = null } = {}) {
  const uid         = randomUUID()
  const email       = `test-user-${uid}@flowos.test`
  const displayName = isAgent ? 'Test Agent' : 'Test Actor'

  const { rows } = await query(`
    INSERT INTO blueprint.users (uri, email, display_name, is_agent, is_admin, is_active)
    VALUES ($1, $2, $3, $4, $5, true)
    RETURNING id
  `, [
    `flowos://test/users/${uid}`,
    email,
    displayName,
    isAgent,
    isAdmin,
  ])

  const id = rows[0].id

  if (orgId) {
    // role_id is NOT NULL. Resolve by name rather than hardcoding an ID —
    // hardcoded IDs are the very defect this helper exists to remove.
    const { rows: roleRows } = await query(
      `SELECT id FROM blueprint.roles WHERE name = 'Team Member' LIMIT 1`,
    )
    const { rows: anyRole } = roleRows.length
      ? { rows: roleRows }
      : await query('SELECT id FROM blueprint.roles ORDER BY id LIMIT 1')
    if (!anyRole.length) throw new Error('createTestUser: no roles seeded')

    await query(`
      INSERT INTO blueprint.org_memberships (org_id, user_id, role_id, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (user_id, org_id) DO NOTHING
    `, [orgId, id, anyRole[0].id])
  }

  return { id, email, displayName, teardown: () => dropTestUser(id) }
}

/**
 * Delete an ephemeral user, clearing the references that would otherwise
 * block it.
 *
 * runtime.events.actor_id is ON DELETE SET NULL and needs no help. The
 * RESTRICT-style references (context_entries, org_context) are normally gone
 * already via work-item / org cascade; they are nulled or cleared here so a
 * standalone caller — one with no test org to cascade from — can still tear
 * down cleanly. translator_usage has no cascade path at all and is always
 * deleted here.
 *
 * Errors are swallowed per-statement so a partial cleanup cannot mask a test
 * assertion failure (same convention as cleanup.js / testOrg.js).
 *
 * @param {number} userId
 */
async function dropTestUser(userId) {
  const soft = async (sql, params) => {
    try { await query(sql, params) } catch { /* intentional — same policy as cleanup.js */ }
  }

  await soft('DELETE FROM runtime.translator_usage WHERE user_id = $1', [userId])
  await soft('DELETE FROM runtime.notifications    WHERE user_id = $1', [userId])
  await soft('DELETE FROM runtime.work_item_user_relationships WHERE user_id = $1', [userId])
  await soft('UPDATE runtime.context_entries SET resolved_by = NULL WHERE resolved_by = $1', [userId])
  await soft('DELETE FROM runtime.context_entries WHERE author_id = $1', [userId])
  await soft('DELETE FROM blueprint.org_context   WHERE author_id = $1', [userId])
  await soft(`
    DELETE FROM blueprint.org_membership_roles
    WHERE org_membership_id IN (SELECT id FROM blueprint.org_memberships WHERE user_id = $1)
  `, [userId])
  await soft('DELETE FROM blueprint.org_memberships WHERE user_id = $1', [userId])

  await soft('DELETE FROM blueprint.users WHERE id = $1', [userId])
}
