// tests/exit-criteria-context-entry.test.js
//
// Unit-style test for the `context_entry_exists` codified exit-criteria
// condition. Runs against the DB directly via db/postgres.js (no HTTP server
// needed) because evaluateExitCriteria() queries the database, not the API.
//
// Setup creates a throwaway work item in the Gladius Development org (109) and a
// throwaway criterion on the Backlog stage (636, which carries no other
// criteria, keeping the test isolated). Assertions look at the specific
// criterion by id, so other criteria on the stage can't affect the result.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { evaluateExitCriteria } from '../runtime/exitCriteria.js'
import { createWorkItem } from '../runtime/workItems.js'
import { createContextEntry } from '../runtime/contextEntries.js'

const ORG_ID   = 109   // Gladius Development
const TYPE_ID  = 140   // Tech Debt (workflow 138, entry stage = Backlog 636)
const STAGE_ID = 636   // Backlog — no other criteria, isolates this test
const AGENT_ID = 309   // agent@flowos.internal

describe('exit criteria: context_entry_exists', () => {
  let workItemId
  let criterionId

  const setCondition = (cond) =>
    query('UPDATE blueprint.exit_criteria SET codified_condition = $2 WHERE id = $1',
      [criterionId, JSON.stringify(cond)])

  // The specific criterion's result, isolated from any others on the stage.
  const mine = (res) => res.all.find((c) => c.id === criterionId)

  before(async () => {
    const wi = await createWorkItem(
      { title: 'context_entry_exists test ' + Date.now(), work_item_type_id: TYPE_ID, owner_org_id: ORG_ID },
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
      STAGE_ID,
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
    if (criterionId) await query('DELETE FROM blueprint.exit_criteria WHERE id = $1', [criterionId]).catch(() => {})
    if (workItemId) await query('DELETE FROM runtime.work_items WHERE id = $1', [workItemId]).catch(() => {})
  })

  it('fails when no matching context entry exists', async () => {
    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
    assert.equal(mine(res).passed, false)
  })

  it('passes once a matching context entry exists', async () => {
    await createContextEntry(workItemId,
      { type: 'discovery', title: 'Scope & Understanding', content: 'temp', authorId: AGENT_ID, isAgent: true })
    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
    assert.equal(mine(res).passed, true)
  })

  it('respects min_count', async () => {
    await setCondition({ type: 'context_entry_exists', entry_type: 'discovery', min_count: 2 })
    let res = await evaluateExitCriteria(workItemId, STAGE_ID)
    assert.equal(mine(res).passed, false, 'one entry should not satisfy min_count 2')

    await createContextEntry(workItemId,
      { type: 'discovery', title: 'Scope 2', content: 'temp2', authorId: AGENT_ID, isAgent: true })
    res = await evaluateExitCriteria(workItemId, STAGE_ID)
    assert.equal(mine(res).passed, true, 'two entries should satisfy min_count 2')
  })

  it('ignores entries of a different type', async () => {
    await setCondition({ type: 'context_entry_exists', entry_type: 'design', min_count: 1 })
    const res = await evaluateExitCriteria(workItemId, STAGE_ID)
    assert.equal(mine(res).passed, false, 'no design entries present → should fail')
  })
})
