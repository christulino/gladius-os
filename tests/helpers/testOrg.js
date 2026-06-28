/**
 * tests/helpers/testOrg.js
 *
 * Provisions an ephemeral test org + work item type for integration-test
 * isolation. All tests that create work items should use this instead of
 * hardcoding owner_org_id=109 or relying on orgs.rows[0].
 *
 * WHY: Integration tests were polluting the live dogfood board (org 109) by
 * hardcoding its ID or grabbing the first org from the API. Cleanup-after
 * hooks are inherently leaky (process kill, throws before the ID array is
 * captured, swallowed errors). This helper is structural isolation: tests
 * write to an ephemeral org, not the live board.
 *
 * USAGE (inside a test file — top-level before/after runs once for the file):
 *
 *   import { before, after } from 'node:test'
 *   import { createTestOrg } from './helpers/testOrg.js'
 *
 *   let testOrg
 *   before(async () => { testOrg = await createTestOrg() })
 *   after(async ()  => { await testOrg.teardown() })
 *
 *   // inside tests:  testOrg.orgId, testOrg.typeId
 */

import { query } from '../../db/postgres.js'
import { deleteWorkItems } from './cleanup.js'
import { createAuthApi } from './auth.js'

const api = createAuthApi()

/**
 * Create a fresh ephemeral org + one Task-class work item type.
 *
 * Setup uses the HTTP API (validates real API paths).
 * Teardown uses direct DB queries (no delete-org API endpoint exists).
 *
 * @returns {Promise<{ orgId: number, typeId: number, teardown: () => Promise<void> }>}
 */
export async function createTestOrg() {
  const ts   = Date.now()
  const slug = `test-org-${ts}`

  // Create org
  const { status: s1, data: org } = await api('/organizations', {
    method: 'POST',
    body: JSON.stringify({ name: `Test Org ${ts}`, slug, org_type: 'team' }),
  })
  if (s1 !== 201) {
    throw new Error(`createTestOrg: org creation failed (${s1}): ${JSON.stringify(org)}`)
  }
  const orgId = org.id

  // Resolve the Task class (simplest class; uses the Simple Task workflow)
  const { data: classes } = await api('/work-item-type-classes')
  const cls = classes.rows.find(c => c.name === 'Task') ?? classes.rows[0]
  if (!cls) throw new Error('createTestOrg: no work item type class found')

  // Create a work item type in the ephemeral org.
  // is_published: true is required — unpublished types can't be used to create work items.
  const { status: s2, data: wit } = await api('/work-item-types', {
    method: 'POST',
    body: JSON.stringify({
      name:         `Test Task ${ts}`,
      class_id:     cls.id,
      owner_org_id: orgId,
      color:        '#6B7280',
      key_prefix:   'TEST',
      is_published: true,
    }),
  })
  if (s2 !== 201) {
    throw new Error(`createTestOrg: type creation failed (${s2}): ${JSON.stringify(wit)}`)
  }
  const typeId = wit.id

  return {
    orgId,
    typeId,
    teardown: () => dropTestOrg(orgId),
  }
}

/**
 * Delete all data owned by the ephemeral org, then delete the org itself.
 *
 * Errors are swallowed per-statement so a partial cleanup failure cannot
 * mask a test assertion failure (same convention as cleanup.js).
 *
 * Deletion order respects FK constraints:
 *   runtime work items → blueprint stage children (exit_criteria, transitions,
 *   checklists) → stages → work item type links → work item types →
 *   workflows → org-level rows → org
 *
 * @param {number} orgId
 */
async function dropTestOrg(orgId) {
  const soft = async (sql, params) => {
    try { await query(sql, params) } catch { /* intentional — same policy as cleanup.js */ }
  }

  // ── 1. Work items (runtime) ────────────────────────────────────────────────
  const { rows: wiRows } = await query(
    'SELECT id FROM runtime.work_items WHERE owner_org_id = $1',
    [orgId],
  )
  if (wiRows.length > 0) {
    await deleteWorkItems(wiRows.map(r => r.id), { strict: false })
  }

  // ── 2. Blueprint stage children (for workflows owned by this org) ──────────
  const { rows: stageRows } = await query(`
    SELECT s.id FROM blueprint.stages s
    JOIN  blueprint.workflows w ON w.id = s.workflow_id
    WHERE w.owner_org_id = $1
  `, [orgId])
  const stageIds = stageRows.map(r => r.id)

  if (stageIds.length > 0) {
    // transition_actions → stage_transitions (must precede stage_transitions delete)
    await soft(`
      DELETE FROM blueprint.transition_actions
      WHERE stage_transition_id IN (
        SELECT id FROM blueprint.stage_transitions
        WHERE from_stage_id = ANY($1::int[])
      )
    `, [stageIds])

    // stage_transition_role_restrictions → stage_transitions
    await soft(`
      DELETE FROM blueprint.stage_transition_role_restrictions
      WHERE stage_transition_id IN (
        SELECT id FROM blueprint.stage_transitions
        WHERE from_stage_id = ANY($1::int[])
      )
    `, [stageIds])

    // replenishment_policies → stages and workflows
    await soft(`
      DELETE FROM blueprint.replenishment_policies
      WHERE source_stage_id = ANY($1::int[]) OR destination_stage_id = ANY($1::int[])
    `, [stageIds])

    // exit_criteria → stages
    await soft(
      'DELETE FROM blueprint.exit_criteria WHERE stage_id = ANY($1::int[])',
      [stageIds],
    )

    // stage_transitions → stages (both columns)
    await soft(`
      DELETE FROM blueprint.stage_transitions
      WHERE from_stage_id = ANY($1::int[]) OR to_stage_id = ANY($1::int[])
    `, [stageIds])

    // checklist_items → stage_checklists → stages
    await soft(`
      DELETE FROM blueprint.checklist_items
      WHERE checklist_id IN (
        SELECT id FROM blueprint.stage_checklists WHERE stage_id = ANY($1::int[])
      )
    `, [stageIds])
    await soft(
      'DELETE FROM blueprint.stage_checklists WHERE stage_id = ANY($1::int[])',
      [stageIds],
    )

    // stages themselves
    await soft('DELETE FROM blueprint.stages WHERE id = ANY($1::int[])', [stageIds])
  }

  // ── 3. Work item type dependencies ────────────────────────────────────────
  await soft(`
    DELETE FROM blueprint.service_catalog_items
    WHERE work_item_type_id IN (SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1)
  `, [orgId])
  await soft(`
    DELETE FROM blueprint.work_item_type_fields
    WHERE work_item_type_id IN (SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1)
  `, [orgId])
  await soft(`
    DELETE FROM blueprint.work_item_type_workflows
    WHERE work_item_type_id IN (SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1)
  `, [orgId])
  await soft(`
    DELETE FROM blueprint.work_item_type_relationships
    WHERE parent_type_id IN (SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1)
       OR child_type_id  IN (SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1)
  `, [orgId])
  await soft(
    'DELETE FROM blueprint.work_item_types WHERE owner_org_id = $1',
    [orgId],
  )

  // ── 4. Workflows (stages deleted above) ────────────────────────────────────
  await soft(
    'DELETE FROM blueprint.workflows WHERE owner_org_id = $1',
    [orgId],
  )

  // ── 5. Org-level tables with non-CASCADE FKs to organizations ─────────────
  //   (These are all no-ops for a fresh test org; included for correctness.)
  await soft(`
    DELETE FROM blueprint.org_membership_roles
    WHERE org_membership_id IN (SELECT id FROM blueprint.org_memberships WHERE org_id = $1)
  `, [orgId])
  await soft('DELETE FROM blueprint.org_memberships              WHERE org_id = $1', [orgId])
  await soft('DELETE FROM blueprint.org_wip_limits               WHERE org_id = $1', [orgId])
  await soft('DELETE FROM blueprint.org_wip_limits_by_class      WHERE org_id = $1', [orgId])
  await soft('DELETE FROM blueprint.org_tags                     WHERE org_id = $1', [orgId])
  await soft('DELETE FROM blueprint.lookup_lists            WHERE org_id = $1', [orgId])
  await soft('DELETE FROM blueprint.business_calendars      WHERE org_id = $1', [orgId])

  // ── 6. Org itself (CASCADE covers: saved_filters, org_context, org_ai_models)
  await query('DELETE FROM blueprint.organizations WHERE id = $1', [orgId])
}
