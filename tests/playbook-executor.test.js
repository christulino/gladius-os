// tests/playbook-executor.test.js
//
// Tests for the playbook executor — one of the core "AI moat" components.
//
// Coverage:
//   parsePlaybook  — pure-function frontmatter extraction (no DB needed)
//   isValidContextBudget / validateContextBudget — pure-function context_budget
//     validation (no DB needed) — FEAT.26493
//   executePlaybookForStageEntry — early-return paths that create no run record,
//     and the model-not-configured failure path that writes a 'failed' run record.
//
// DB integration tests use the dogfood postgres instance directly.
// No Anthropic SDK calls are triggered — all paths tested stop before the AI call.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { parsePlaybook, isValidContextBudget, validateContextBudget } from '../runtime/stagePlaybooks.js'
import { executePlaybookForStageEntry } from '../runtime/playbookExecutor.js'
import { createWorkItem } from '../runtime/workItems.js'

const ORG_ID   = 109   // Gladius Development
const TYPE_ID  = 140   // Tech Debt (workflow 138, entry stage = Backlog 636)
const STAGE_ID = 636   // Backlog — no active playbooks by default; safe for isolation
const AGENT_ID = 309   // agent@flowos.internal

// ── parsePlaybook ─────────────────────────────────────────────────────────────

describe('parsePlaybook', () => {
  it('returns meta={}, body=full content when no frontmatter is present', () => {
    const content = 'Plain instructions with no frontmatter at all.'
    const { meta, body } = parsePlaybook(content)
    assert.deepEqual(meta, {})
    assert.equal(body, content)
  })

  it('parses YAML frontmatter and separates it from the body', () => {
    const content = [
      '---',
      'model: sonnet',
      'trigger: on_enter',
      'context:',
      '  pull: [discovery, acceptance]',
      '  write: [note, test-plan]',
      'max_tokens: 2048',
      '---',
      'You are an AI agent helping with this stage.',
    ].join('\n')
    const { meta, body } = parsePlaybook(content)
    assert.equal(meta.model, 'sonnet')
    assert.equal(meta.trigger, 'on_enter')
    assert.deepEqual(meta.context.pull, ['discovery', 'acceptance'])
    assert.deepEqual(meta.context.write, ['note', 'test-plan'])
    assert.equal(meta.max_tokens, 2048)
    assert.ok(body.includes('You are an AI agent'))
    assert.ok(!body.includes('---'), 'body must not contain frontmatter delimiters')
  })

  it('falls back to meta={} and body=full content when YAML is malformed', () => {
    const content = [
      '---',
      'model: [unclosed bracket',
      '---',
      'Body here.',
    ].join('\n')
    // Must not throw — invalid YAML falls back gracefully
    const { meta, body } = parsePlaybook(content)
    assert.deepEqual(meta, {})
    assert.ok(typeof body === 'string', 'body should always be a string')
  })

  it('returns empty body string when frontmatter fills the entire content', () => {
    const content = '---\nmodel: claude-3\n---\n'
    const { meta, body } = parsePlaybook(content)
    assert.equal(meta.model, 'claude-3')
    assert.equal(body, '')
  })

  it('recognises stage_entry as a trigger alias for on_enter', () => {
    const content = '---\ntrigger: stage_entry\nmodel: sonnet\n---\nInstructions.'
    const { meta } = parsePlaybook(content)
    assert.equal(meta.trigger, 'stage_entry')
  })

  it('extracts execution_owner from frontmatter', () => {
    const content = '---\nmodel: sonnet\nexecution_owner: agent\n---\nInstructions.'
    const { meta } = parsePlaybook(content)
    assert.equal(meta.execution_owner, 'agent')
  })

  it('extracts context_budget from frontmatter', () => {
    const content = '---\nmodel: sonnet\ncontext_budget: 8000\n---\nInstructions.'
    const { meta } = parsePlaybook(content)
    assert.equal(meta.context_budget, 8000)
  })
})

// ── isValidContextBudget / validateContextBudget (FEAT.26493) ─────────────────

describe('isValidContextBudget', () => {
  it('accepts positive finite numbers', () => {
    assert.equal(isValidContextBudget(1), true)
    assert.equal(isValidContextBudget(2000), true)
    assert.equal(isValidContextBudget(0.5), true)
  })

  it('rejects zero, negative, non-numeric, and non-finite values', () => {
    assert.equal(isValidContextBudget(0), false)
    assert.equal(isValidContextBudget(-5), false)
    assert.equal(isValidContextBudget('2000'), false)
    assert.equal(isValidContextBudget('lots'), false)
    assert.equal(isValidContextBudget(null), false)
    assert.equal(isValidContextBudget(undefined), false)
    assert.equal(isValidContextBudget(NaN), false)
    assert.equal(isValidContextBudget(Infinity), false)
  })
})

describe('validateContextBudget', () => {
  it('is valid when context_budget is absent — the global default applies', () => {
    assert.deepEqual(validateContextBudget({}), { valid: true })
    assert.deepEqual(validateContextBudget({ model: 'sonnet' }), { valid: true })
    assert.deepEqual(validateContextBudget(null), { valid: true })
  })

  it('is valid for a positive numeric context_budget', () => {
    assert.deepEqual(validateContextBudget({ context_budget: 2000 }), { valid: true })
    assert.deepEqual(validateContextBudget({ context_budget: 8000 }), { valid: true })
  })

  it('is invalid for a non-numeric context_budget, with a clear error message', () => {
    const result = validateContextBudget({ context_budget: 'lots' })
    assert.equal(result.valid, false)
    assert.ok(result.error.includes('context_budget'), 'error message must mention context_budget')
  })

  it('is invalid for zero or negative context_budget', () => {
    assert.equal(validateContextBudget({ context_budget: 0 }).valid, false)
    assert.equal(validateContextBudget({ context_budget: -100 }).valid, false)
  })
})

// ── executePlaybookForStageEntry ──────────────────────────────────────────────

describe('executePlaybookForStageEntry', () => {
  let workItemId
  // Tracks IDs of test playbooks created so after() can clean them up
  const testPlaybookIds = []

  const countRunRecords = async () => {
    const { rows } = await query(
      'SELECT id, status, error_message FROM runtime.playbook_runs WHERE work_item_id = $1',
      [workItemId],
    )
    return rows
  }

  before(async () => {
    const wi = await createWorkItem(
      { title: 'executor test ' + Date.now(), work_item_type_id: TYPE_ID, owner_org_id: ORG_ID },
      AGENT_ID,
    )
    workItemId = wi.id
    assert.ok(workItemId, 'failed to create test work item')
  })

  after(async () => {
    // Delete test playbooks
    for (const id of testPlaybookIds) {
      await query('DELETE FROM blueprint.stage_playbooks WHERE id = $1', [id]).catch(() => {})
    }
    if (workItemId) {
      for (const sql of [
        'DELETE FROM runtime.playbook_runs WHERE work_item_id = $1',
        'DELETE FROM runtime.exit_criteria_status WHERE work_item_id = $1',
        'DELETE FROM runtime.context_entries WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_search WHERE work_item_id = $1',
      ]) await query(sql, [workItemId]).catch(() => {})
      await query('DELETE FROM runtime.work_items WHERE id = $1', [workItemId]).catch(() => {})
    }
  })

  it('no-op when no active playbook exists for the stage', async () => {
    // stage 99999 is a non-existent stage ID — getPlaybookForStage returns null,
    // executor returns early before insertRunRecord is called.
    await executePlaybookForStageEntry(workItemId, 99999, ORG_ID, TYPE_ID)
    const runs = await countRunRecords()
    assert.equal(runs.length, 0, 'no run record should be created when there is no playbook')
  })

  it('no-op when playbook has execution_owner=agent', async () => {
    const { rows } = await query(`
      INSERT INTO blueprint.stage_playbooks (stage_id, name, content, is_active, execution_owner)
      VALUES ($1, $2, $3, true, 'agent')
      RETURNING id
    `, [STAGE_ID, '__test agent-owner ' + Date.now(),
        '---\nmodel: sonnet\ntrigger: on_enter\n---\nTest body.'])
    const pbId = rows[0].id
    testPlaybookIds.push(pbId)

    await executePlaybookForStageEntry(workItemId, STAGE_ID, ORG_ID, TYPE_ID)
    const runs = await countRunRecords()
    assert.equal(runs.length, 0, 'no run record when execution_owner=agent')

    // Clean up this playbook so the next test gets a clean slate
    await query('DELETE FROM blueprint.stage_playbooks WHERE id = $1', [pbId])
    testPlaybookIds.splice(testPlaybookIds.indexOf(pbId), 1)
  })

  it('no-op when playbook trigger does not match stage entry', async () => {
    const { rows } = await query(`
      INSERT INTO blueprint.stage_playbooks (stage_id, name, content, is_active, execution_owner)
      VALUES ($1, $2, $3, true, 'in_server')
      RETURNING id
    `, [STAGE_ID, '__test on-exit trigger ' + Date.now(),
        '---\nmodel: sonnet\ntrigger: on_exit\n---\nTest body.'])
    const pbId = rows[0].id
    testPlaybookIds.push(pbId)

    await executePlaybookForStageEntry(workItemId, STAGE_ID, ORG_ID, TYPE_ID)
    const runs = await countRunRecords()
    assert.equal(runs.length, 0, 'no run record when playbook trigger is on_exit')

    await query('DELETE FROM blueprint.stage_playbooks WHERE id = $1', [pbId])
    testPlaybookIds.splice(testPlaybookIds.indexOf(pbId), 1)
  })

  it('writes a failed run record when the model name is not configured for the org', async () => {
    // Use a model name that cannot exist in the org — makes resolveModelConfig return null
    const modelName = '__test_notfound_' + Date.now() + '__'
    const { rows } = await query(`
      INSERT INTO blueprint.stage_playbooks (stage_id, name, content, is_active, execution_owner)
      VALUES ($1, $2, $3, true, 'in_server')
      RETURNING id
    `, [STAGE_ID, '__test model-missing ' + Date.now(),
        `---\nmodel: ${modelName}\ntrigger: on_enter\n---\nTest body.`])
    const pbId = rows[0].id
    testPlaybookIds.push(pbId)

    await executePlaybookForStageEntry(workItemId, STAGE_ID, ORG_ID, TYPE_ID)

    const runs = await countRunRecords()
    assert.equal(runs.length, 1, 'exactly one run record should be created')
    const run = runs[0]
    assert.equal(run.status, 'failed',
      `run status should be 'failed', got '${run.status}'`)
    assert.ok(
      run.error_message?.includes(modelName),
      `error_message should mention the missing model name "${modelName}"; got: "${run.error_message}"`,
    )

    await query('DELETE FROM blueprint.stage_playbooks WHERE id = $1', [pbId])
    testPlaybookIds.splice(testPlaybookIds.indexOf(pbId), 1)
  })
})
