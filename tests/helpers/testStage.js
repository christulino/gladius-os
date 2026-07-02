/**
 * tests/helpers/testStage.js
 *
 * Creates a throwaway workflow + single stage owned by an ephemeral test org
 * (see createTestOrg() in testOrg.js).
 *
 * WHY: createTestOrg() wires new work item types to the shared "Simple Task"
 * workflow (blueprint.workflows id 44), which is reused by several real
 * seeded orgs (Payments Team, Mobile Experience, Cloud Infrastructure, ...).
 * Tests that need to attach blueprint-level rows to a stage_id — exit
 * criteria, stage playbooks — must NOT write onto that shared workflow's
 * stages: an active codified exit criterion or AI playbook inserted there
 * would apply to every org's items passing through it, not just the test's
 * own ephemeral data. This helper gives each test file (or describe block)
 * its own private workflow + stage instead.
 *
 * Ownership is set to the ephemeral org, so createTestOrg()'s teardown()
 * cleans it up automatically: dropTestOrg() deletes blueprint stage children
 * (exit_criteria, transitions, checklists) + stages + workflows owned by
 * orgId, and stage_playbooks CASCADE off stage deletion. No separate
 * teardown call is needed here.
 *
 * USAGE:
 *   const testOrg = await createTestOrg()
 *   const { stageId } = await createTestStage(testOrg.orgId, { stageClass: 'triage' })
 *   // ... use stageId as an FK target for exit_criteria / stage_playbooks / synthetic
 *   //     stage_transition_history rows ...
 *   await testOrg.teardown()  // cleans up the stage + workflow too
 */

import { query } from '../../db/postgres.js'

/**
 * @param {number} orgId
 * @param {{ name?: string, stageClass?: string }} [opts]
 * @returns {Promise<{ workflowId: number, stageId: number }>}
 */
export async function createTestStage(orgId, opts = {}) {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = opts.name ?? `Test Stage ${ts}`
  const stageClass = opts.stageClass ?? 'intake'

  const { rows: wfRows } = await query(`
    INSERT INTO blueprint.workflows (uri, name, owner_org_id)
    VALUES ($1, $2, $3)
    RETURNING id
  `, [`flowos://test/workflows/${ts}`, `Test Workflow ${ts}`, orgId])
  const workflowId = wfRows[0].id

  const { rows: stageRows } = await query(`
    INSERT INTO blueprint.stages (uri, workflow_id, name, stage_class, stage_type, is_entry_stage)
    VALUES ($1, $2, $3, $4, 'queue', true)
    RETURNING id
  `, [`flowos://test/stages/${ts}`, workflowId, name, stageClass])
  const stageId = stageRows[0].id

  return { workflowId, stageId }
}
