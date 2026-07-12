// tests/exit-criteria-waivers.test.js
//
// Tests for exit criteria evaluation: waiver mechanics and additional codified
// condition types not covered by exit-criteria-context-entry.test.js.
//
// Coverage:
//   waiveCriterion         — rejects empty reason, stores waiver metadata
//   evaluateExitCriteria   — manual criterion passes when waived
//                         — no_unresolved_decisions condition (fails/passes based on decisions)
//                         — legacy/unknown criteria_tier (e.g. a pre-existing 'api' row)
//                           fails closed with no outbound request
//
// Note: codified tier waiver short-circuit is tested separately in
// tests/exit-criteria-waiver.test.js (added with DEBT.25479 fix).
//
// The 'api' tier (arbitrary outbound fetch, blocking the transition on
// network failure) was cut in DEBT.25494 — SSRF-shaped liability with zero
// solo use. It can no longer be authored via the API/UI; the test below
// proves evaluation of any lingering/legacy row with that tier value fails
// closed via the "unknown criteria tier" default branch, never fetch().
//
// Runs directly against the DB (no HTTP server needed). Each describe block
// gets its own dedicated throwaway stage (see helpers/testStage.js) owned by
// an ephemeral test org, for isolation.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { evaluateExitCriteria, waiveCriterion } from '../runtime/exitCriteria.js'
import { createWorkItem } from '../runtime/workItems.js'
import { createContextEntry, resolveDecisionEntry } from '../runtime/contextEntries.js'
import { createTestOrg } from './helpers/testOrg.js'
import { createTestStage } from './helpers/testStage.js'

const USER_ID  = 112   // Chris Tulino (waiving user)
const AGENT_ID = 309   // agent@flowos.internal

describe('waiveCriterion', () => {
  let testOrg
  let stageId
  let workItemId
  let criterionId

  before(async () => {
    testOrg = await createTestOrg()
    ;({ stageId } = await createTestStage(testOrg.orgId))

    const wi = await createWorkItem(
      { title: 'waiver test ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId },
      AGENT_ID,
    )
    workItemId = wi.id
    assert.ok(workItemId, 'failed to create test work item')

    const { rows } = await query(`
      INSERT INTO blueprint.exit_criteria
        (uri, stage_id, name, description, criteria_tier, is_blocking, is_active)
      VALUES ($1, $2, $3, $4, 'manual', true, true)
      RETURNING id
    `, [
      'flowos://test/criteria/waiver-manual-' + Date.now(),
      stageId,
      'TEST manual waiver ' + Date.now(),
      'temporary test manual criterion',
    ])
    criterionId = rows[0].id
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('throws when reason is empty', async () => {
    await assert.rejects(
      () => waiveCriterion(workItemId, criterionId, USER_ID, ''),
      /reason is required/i,
      'should throw when reason is blank',
    )
  })

  it('throws when reason is whitespace only', async () => {
    await assert.rejects(
      () => waiveCriterion(workItemId, criterionId, USER_ID, '   '),
      /reason is required/i,
      'should throw when reason is whitespace-only',
    )
  })

  it('stores waiver metadata in exit_criteria_status', async () => {
    const row = await waiveCriterion(workItemId, criterionId, USER_ID, 'Exempt per PM approval')
    assert.equal(row.status, 'waived')
    assert.equal(row.waived_by_user_id, USER_ID)
    assert.ok(row.waiver_reason?.includes('PM approval'), 'waiver reason should be stored')
    assert.ok(row.waived_at, 'waived_at timestamp should be set')
  })

  it('manual criterion passes evaluateExitCriteria when waived', async () => {
    // criterion was waived in the previous test — evaluation should reflect this
    const mine = (res) => res.all.find((c) => c.id === criterionId)
    const res = await evaluateExitCriteria(workItemId, stageId)
    const c = mine(res)
    assert.ok(c, 'criterion should appear in evaluation result')
    assert.equal(c.passed, true, 'waived manual criterion should pass evaluation')
    assert.equal(res.failed.find(f => f.id === criterionId), undefined, 'waived criterion must not appear in failed list')
  })
})

// ── no_unresolved_decisions ───────────────────────────────────────────────────

describe('exit criteria: no_unresolved_decisions condition', () => {
  let testOrg
  let stageId
  let workItemId
  let criterionId
  let decisionEntryId

  const mine = (res) => res.all.find((c) => c.id === criterionId)

  before(async () => {
    testOrg = await createTestOrg()
    ;({ stageId } = await createTestStage(testOrg.orgId))

    const wi = await createWorkItem(
      { title: 'no-decisions test ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId },
      AGENT_ID,
    )
    workItemId = wi.id
    assert.ok(workItemId, 'failed to create test work item')

    const { rows } = await query(`
      INSERT INTO blueprint.exit_criteria
        (uri, stage_id, name, description, criteria_tier, codified_condition, is_blocking, is_active)
      VALUES ($1, $2, $3, $4, 'codified', $5, true, true)
      RETURNING id
    `, [
      'flowos://test/criteria/no-decisions-' + Date.now(),
      stageId,
      'TEST no_unresolved_decisions ' + Date.now(),
      'temporary: blocks until all decisions are resolved',
      JSON.stringify({ type: 'no_unresolved_decisions' }),
    ])
    criterionId = rows[0].id
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('passes when no decision entries exist', async () => {
    const res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, true, 'no decisions → should pass')
  })

  it('fails when an unresolved decision entry exists', async () => {
    const entry = await createContextEntry(workItemId, {
      type: 'decision',
      title: 'Which framework?',
      content: 'TBD',
      authorId: AGENT_ID,
      isAgent: true,
    })
    decisionEntryId = entry.id

    const res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, false, 'unresolved decision → should fail')
    assert.ok(mine(res).reason?.match(/unresolved decision/i), 'reason should mention unresolved decision')
  })

  it('passes again after the decision is resolved', async () => {
    await resolveDecisionEntry(decisionEntryId, workItemId, {
      resolutionText: 'We chose React.',
      resolvedBy: USER_ID,
    })

    const res = await evaluateExitCriteria(workItemId, stageId)
    assert.equal(mine(res).passed, true, 'all decisions resolved → should pass')
  })
})

// ── cut api tier (DEBT.25494) ─────────────────────────────────────────────────

describe('exit criteria: cut api tier (DEBT.25494)', () => {
  let testOrg
  let stageId
  let workItemId
  let criterionId

  const mine = (res) => res.all.find((c) => c.id === criterionId)

  before(async () => {
    testOrg = await createTestOrg()
    ;({ stageId } = await createTestStage(testOrg.orgId))

    const wi = await createWorkItem(
      { title: 'api-tier-cut test ' + Date.now(), work_item_type_id: testOrg.typeId, owner_org_id: testOrg.orgId },
      AGENT_ID,
    )
    workItemId = wi.id
    assert.ok(workItemId, 'failed to create test work item')
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('a lingering/legacy criteria_tier="api" row fails closed with no outbound request', async () => {
    // The column still exists (no data migration was needed — 0 rows had this
    // tier in production), but evaluateSingleCriterion no longer has an 'api'
    // case, so this must NOT attempt a fetch(). It should fail via the
    // "unknown criteria tier" default branch instead.
    const { rows } = await query(`
      INSERT INTO blueprint.exit_criteria
        (uri, stage_id, name, description, criteria_tier, api_endpoint, is_blocking, is_active)
      VALUES ($1, $2, $3, $4, 'api', 'http://169.254.169.254/latest/meta-data/', true, true)
      RETURNING id
    `, [
      'flowos://test/criteria/api-tier-cut-' + Date.now(),
      stageId,
      'TEST legacy api tier ' + Date.now(),
      'temporary: proves the api tier no longer evaluates',
    ])
    criterionId = rows[0].id

    const res = await evaluateExitCriteria(workItemId, stageId)
    const c = mine(res)
    assert.ok(c, 'criterion should be in evaluation result')
    assert.equal(c.passed, false, 'unknown/legacy api tier should fail (fail-closed)')
    assert.ok(
      c.reason?.toLowerCase().includes('unknown'),
      `reason should indicate an unknown criteria tier, not an API/network error; got: "${c.reason}"`,
    )
    assert.equal(res.failed.some(f => f.id === criterionId), true, 'should appear in failed list')
  })
})
