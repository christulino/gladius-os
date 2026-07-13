// tests/exit-criteria-waiver.test.js
//
// Tests that a waived exit criterion is treated as passed regardless of tier.
// Regression test for: codified/api waivers ignored during evaluation.
//
// Runs against the DB directly (no HTTP server needed). Uses a dedicated
// throwaway stage (see helpers/testStage.js) owned by an ephemeral test org
// for isolation. Criterion is designed to fail on its own — the waiver must
// be what makes it pass.

import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { evaluateExitCriteria, waiveCriterion } from '../runtime/exitCriteria.js'
import { createWorkItem } from '../runtime/workItems.js'
import { createTestOrg } from './helpers/testOrg.js'
import { createTestStage } from './helpers/testStage.js'

const USER_ID = 112   // Chris (waiving user)

describe('exit criteria: waiver respected for all tiers', () => {
  let testOrg
  let stageId
  let workItemId
  let criterionId

  const mine = (res) => res.all.find((c) => c.id === criterionId)

  before(async () => {
    testOrg = await createTestOrg()
    ;({ stageId } = await createTestStage(testOrg.orgId))

    const wi = await createWorkItem(
      { title: 'waiver test ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId },
      USER_ID,
    )
    workItemId = wi.id
    assert.ok(workItemId, 'failed to create temp work item')

    // Codified criterion that will always fail: requires a field that does not exist
    const { rows } = await query(`
      INSERT INTO blueprint.exit_criteria
        (uri, stage_id, name, description, criteria_tier, codified_condition, is_blocking, is_active)
      VALUES ($1, $2, $3, $4, 'codified', $5, true, true)
      RETURNING id
    `, [
      'flowos://test/criteria/waiver-' + Date.now(),
      stageId,
      'TEST waiver criterion',
      'temporary test criterion — always fails unless waived',
      JSON.stringify({ type: 'field_value', field_key: '__nonexistent__', operator: 'exists' }),
    ])
    criterionId = rows[0].id
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('codified criterion fails without a waiver', async () => {
    const res = await evaluateExitCriteria(workItemId, stageId)
    const c = mine(res)
    assert.ok(c, 'criterion not found in evaluation result')
    assert.equal(c.passed, false, 'should fail when condition is not met and not waived')
  })

  it('codified criterion passes after being waived', async () => {
    await waiveCriterion(workItemId, criterionId, USER_ID, 'waiving for test purposes')

    const res = await evaluateExitCriteria(workItemId, stageId)
    const c = mine(res)
    assert.ok(c, 'criterion not found in evaluation result')
    assert.equal(c.passed, true, 'waived criterion should be treated as passed regardless of condition')
    assert.equal(res.passed, true, 'overall evaluation should pass when only criterion is waived')
    assert.equal(res.failed.length, 0, 'waived criterion should not appear in failed list')
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
