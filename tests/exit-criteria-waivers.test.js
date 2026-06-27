// tests/exit-criteria-waivers.test.js
//
// Tests for exit criteria evaluation: waiver mechanics and additional codified
// condition types not covered by exit-criteria-context-entry.test.js.
//
// Coverage:
//   waiveCriterion         — rejects empty reason, stores waiver metadata
//   evaluateExitCriteria   — manual criterion passes when waived
//                         — no_unresolved_decisions condition (fails/passes based on decisions)
//                         — api tier with no endpoint configured → blocking failure
//
// Note: codified/api tier waiver short-circuit is tested separately in
// tests/exit-criteria-waiver.test.js (added with DEBT.25479 fix).
//
// Runs directly against the DB (no HTTP server needed). Uses Backlog stage 636
// (no other active criteria by default) for isolation.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { evaluateExitCriteria, waiveCriterion } from '../runtime/exitCriteria.js'
import { createWorkItem } from '../runtime/workItems.js'
import { createContextEntry, resolveDecisionEntry } from '../runtime/contextEntries.js'

const ORG_ID   = 109   // Gladius Development
const TYPE_ID  = 140   // Tech Debt (workflow 138, entry stage = Backlog 636)
const STAGE_ID = 636   // Backlog — safe for isolated test criteria
const USER_ID  = 112   // Chris Tulino (waiving user)
const AGENT_ID = 309   // agent@flowos.internal

describe('waiveCriterion', () => {
  let workItemId
  let criterionId

  before(async () => {
    const wi = await createWorkItem(
      { title: 'waiver test ' + Date.now(), work_item_type_id: TYPE_ID, owner_org_id: ORG_ID },
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
      STAGE_ID,
      'TEST manual waiver ' + Date.now(),
      'temporary test manual criterion',
    ])
    criterionId = rows[0].id
  })

  after(async () => {
    if (workItemId) {
      for (const sql of [
        'DELETE FROM runtime.exit_criteria_status WHERE work_item_id = $1',
        'DELETE FROM runtime.context_entries WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_search WHERE work_item_id = $1',
      ]) await query(sql, [workItemId]).catch(() => {})
    }
    if (criterionId) await query('DELETE FROM blueprint.exit_criteria WHERE id = $1', [criterionId]).catch(() => {})
    if (workItemId) await query('DELETE FROM runtime.work_items WHERE id = $1', [workItemId]).catch(() => {})
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
    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
    const c = mine(res)
    assert.ok(c, 'criterion should appear in evaluation result')
    assert.equal(c.passed, true, 'waived manual criterion should pass evaluation')
    assert.equal(res.failed.find(f => f.id === criterionId), undefined, 'waived criterion must not appear in failed list')
  })
})

// ── no_unresolved_decisions ───────────────────────────────────────────────────

describe('exit criteria: no_unresolved_decisions condition', () => {
  let workItemId
  let criterionId
  let decisionEntryId

  const mine = (res) => res.all.find((c) => c.id === criterionId)

  before(async () => {
    const wi = await createWorkItem(
      { title: 'no-decisions test ' + Date.now(), work_item_type_id: TYPE_ID, owner_org_id: ORG_ID },
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
      STAGE_ID,
      'TEST no_unresolved_decisions ' + Date.now(),
      'temporary: blocks until all decisions are resolved',
      JSON.stringify({ type: 'no_unresolved_decisions' }),
    ])
    criterionId = rows[0].id
  })

  after(async () => {
    if (workItemId) {
      for (const sql of [
        'DELETE FROM runtime.exit_criteria_status WHERE work_item_id = $1',
        'DELETE FROM runtime.context_entries WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_search WHERE work_item_id = $1',
      ]) await query(sql, [workItemId]).catch(() => {})
    }
    if (criterionId) await query('DELETE FROM blueprint.exit_criteria WHERE id = $1', [criterionId]).catch(() => {})
    if (workItemId) await query('DELETE FROM runtime.work_items WHERE id = $1', [workItemId]).catch(() => {})
  })

  it('passes when no decision entries exist', async () => {
    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
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

    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
    assert.equal(mine(res).passed, false, 'unresolved decision → should fail')
    assert.ok(mine(res).reason?.match(/unresolved decision/i), 'reason should mention unresolved decision')
  })

  it('passes again after the decision is resolved', async () => {
    await resolveDecisionEntry(decisionEntryId, workItemId, {
      resolutionText: 'We chose React.',
      resolvedBy: USER_ID,
    })

    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
    assert.equal(mine(res).passed, true, 'all decisions resolved → should pass')
  })
})

// ── api tier ─────────────────────────────────────────────────────────────────

describe('exit criteria: api tier', () => {
  let workItemId
  let criterionId

  const mine = (res) => res.all.find((c) => c.id === criterionId)

  before(async () => {
    const wi = await createWorkItem(
      { title: 'api-tier test ' + Date.now(), work_item_type_id: TYPE_ID, owner_org_id: ORG_ID },
      AGENT_ID,
    )
    workItemId = wi.id
    assert.ok(workItemId, 'failed to create test work item')
  })

  after(async () => {
    if (workItemId) {
      for (const sql of [
        'DELETE FROM runtime.exit_criteria_status WHERE work_item_id = $1',
        'DELETE FROM runtime.context_entries WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_search WHERE work_item_id = $1',
      ]) await query(sql, [workItemId]).catch(() => {})
    }
    if (criterionId) await query('DELETE FROM blueprint.exit_criteria WHERE id = $1', [criterionId]).catch(() => {})
    if (workItemId) await query('DELETE FROM runtime.work_items WHERE id = $1', [workItemId]).catch(() => {})
  })

  it('fails and returns a reason when api_endpoint is not configured', async () => {
    const { rows } = await query(`
      INSERT INTO blueprint.exit_criteria
        (uri, stage_id, name, description, criteria_tier, api_endpoint, is_blocking, is_active)
      VALUES ($1, $2, $3, $4, 'api', NULL, true, true)
      RETURNING id
    `, [
      'flowos://test/criteria/api-no-endpoint-' + Date.now(),
      STAGE_ID,
      'TEST api no endpoint ' + Date.now(),
      'temporary api criterion with no endpoint',
    ])
    criterionId = rows[0].id

    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
    const c = mine(res)
    assert.ok(c, 'criterion should be in evaluation result')
    assert.equal(c.passed, false, 'api criterion with no endpoint should fail')
    assert.ok(c.reason?.toLowerCase().includes('endpoint'), `reason should mention endpoint; got: "${c.reason}"`)
    assert.equal(res.failed.some(f => f.id === criterionId), true, 'should appear in failed list')
  })
})
