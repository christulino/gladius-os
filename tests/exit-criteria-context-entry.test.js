// tests/exit-criteria-context-entry.test.js
//
// Unit-style test for the `context_entry_exists` codified exit-criteria
// condition. Runs against the DB directly via db/postgres.js (no HTTP server
// needed) because evaluateExitCriteria() queries the database, not the API.
//
// Setup creates a throwaway work item and a throwaway criterion on a
// throwaway stage, both owned by an ephemeral org (see createTestOrg() /
// createTestStage()) — never on a live dogfood workflow's stages. Inserting
// an active codified exit criterion onto a shared stage would gate every
// real item passing through it, not just this test's own data, so this
// test gets its own private workflow + stage. Assertions look at the
// specific criterion by id, so other criteria on the stage can't affect
// the result.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { evaluateExitCriteria } from '../runtime/exitCriteria.js'
import { createWorkItem } from '../runtime/workItems.js'
import { createContextEntry } from '../runtime/contextEntries.js'
import { createTestOrg } from './helpers/testOrg.js'
import { createTestStage } from './helpers/testStage.js'

const AGENT_ID = 309   // agent@flowos.internal

describe('exit criteria: context_entry_exists', () => {
  let workItemId
  let criterionId
  let testOrg
  let stageId

  const setCondition = (cond) =>
    query('UPDATE blueprint.exit_criteria SET codified_condition = $2 WHERE id = $1',
      [criterionId, JSON.stringify(cond)])

  // The specific criterion's result, isolated from any others on the stage.
  const mine = (res) => res.all.find((c) => c.id === criterionId)

  before(async () => {
    testOrg = await createTestOrg()
    ;({ stageId } = await createTestStage(testOrg.orgId, { stageClass: 'intake' }))

    const wi = await createWorkItem(
      { title: 'context_entry_exists test ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId },
      AGENT_ID,
    )
    workItemId = wi.id
    assert.ok(workItemId, 'failed to create temp work item')

    const { rows } = await query(`
      INSERT INTO blueprint.exit_criteria
        (uri, stage_id, name, description, criteria_tier, codified_condition, is_blocking, is_active)
      VALUES ($1, $2, $3, $4, 'codified', $5, true, true)
      RETURNING id
    `, [
      'flowos://test/criteria/ce-' + Date.now(),
      stageId,
      'TEST discovery entry exists',
      'temporary test criterion',
      JSON.stringify({ type: 'context_entry_exists', entry_type: 'discovery', min_count: 1 }),
    ])
    criterionId = rows[0].id
  })

  after(async () => {
    if (workItemId) {
      // Delete child rows first — createWorkItem auto-creates an owner relationship,
      // and evaluation/search populate dependent tables that FK to work_items.
      for (const sql of [
        'DELETE FROM runtime.exit_criteria_status WHERE work_item_id = $1',
        'DELETE FROM runtime.context_entries WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_search WHERE work_item_id = $1',
      ]) {
        await query(sql, [workItemId]).catch(() => {})
      }
    }
    if (workItemId) await query('DELETE FROM runtime.work_items WHERE id = $1', [workItemId]).catch(() => {})
    // testOrg.teardown() deletes exit_criteria/stages/workflows owned by the
    // ephemeral org, which covers criterionId and stageId — no separate cleanup needed.
    if (testOrg) await testOrg.teardown()
  })

  it('fails when no matching context entry exists', async () => {
    const res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, false)
  })

  it('passes once a matching context entry exists', async () => {
    await createContextEntry(workItemId,
      { type: 'discovery', title: 'Scope & Understanding', content: 'temp', authorId: AGENT_ID, isAgent: true })
    const res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, true)
  })

  it('respects min_count', async () => {
    await setCondition({ type: 'context_entry_exists', entry_type: 'discovery', min_count: 2 })
    let res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, false, 'one entry should not satisfy min_count 2')

    await createContextEntry(workItemId,
      { type: 'discovery', title: 'Scope 2', content: 'temp2', authorId: AGENT_ID, isAgent: true })
    res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, true, 'two entries should satisfy min_count 2')
  })

  it('ignores entries of a different type', async () => {
    await setCondition({ type: 'context_entry_exists', entry_type: 'design', min_count: 1 })
    const res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, false, 'no design entries present → should fail')
  })
})
