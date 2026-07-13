// tests/staleness-detector.test.js
//
// Tests for context staleness detection.
//
// Coverage:
//   extractKeywords  — pure; no DB
//   findOverlap      — pure; no DB
//   checkContextStaleness — DB integration
//   GET /work-items/:id/staleness endpoint

import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { query }                  from '../db/postgres.js'
import { extractKeywords, findOverlap, checkContextStaleness } from '../runtime/stalenessDetector.js'
import { createWorkItem }         from '../runtime/workItems.js'
import { createAuthApi }          from './helpers/auth.js'
import { createTestOrg }          from './helpers/testOrg.js'
import { createTestStage }        from './helpers/testStage.js'

const AGENT_ID = 309   // agent@flowos.internal

const api = createAuthApi()

// ── extractKeywords ─────────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('returns empty set for empty string', () => {
    assert.equal(extractKeywords('').size, 0)
  })

  it('returns empty set for null', () => {
    assert.equal(extractKeywords(null).size, 0)
  })

  it('strips punctuation and lowercases', () => {
    const kw = extractKeywords('Authentication, Service! TIMEOUT.')
    assert.ok(kw.has('authentication'), 'should have authentication')
    assert.ok(kw.has('service'),        'should have service')
    assert.ok(kw.has('timeout'),        'should have timeout')
  })

  it('removes stop words', () => {
    const kw = extractKeywords('the authentication service and the timeout')
    assert.ok(!kw.has('the'),  'should not have stop word "the"')
    assert.ok(!kw.has('and'),  'should not have stop word "and"')
    assert.ok(kw.has('authentication'), 'should have authentication')
  })

  it('filters words shorter than 4 chars', () => {
    const kw = extractKeywords('fix bug via API call')
    assert.ok(!kw.has('fix'), 'should not have "fix" (3 chars)')
    assert.ok(!kw.has('bug'), 'should not have "bug" (3 chars)')
    assert.ok(!kw.has('via'), 'should not have "via" (3 chars)')
    assert.ok(kw.has('call'),  'should have "call" (4 chars)')
  })

  it('deduplicates keywords', () => {
    const kw = extractKeywords('authentication authentication service')
    assert.equal(kw.size, 2, 'set should deduplicate')
  })
})

// ── findOverlap ─────────────────────────────────────────────────────────────

describe('findOverlap', () => {
  it('returns empty array when no overlap', () => {
    const keywords = new Set(['authentication', 'timeout'])
    const item = { title: 'Add dark mode', description: 'UI colour change' }
    assert.deepEqual(findOverlap(item, keywords), [])
  })

  it('finds overlap in title', () => {
    const keywords = new Set(['authentication', 'timeout'])
    const item = { title: 'Fix authentication timeout', description: null }
    const matches = findOverlap(item, keywords)
    assert.ok(matches.includes('authentication'))
    assert.ok(matches.includes('timeout'))
  })

  it('finds overlap in description', () => {
    const keywords = new Set(['pagination'])
    const item = { title: 'API speed', description: 'Improve pagination performance' }
    const matches = findOverlap(item, keywords)
    assert.ok(matches.includes('pagination'))
  })

  it('is case-insensitive', () => {
    const keywords = new Set(['authentication'])
    const item = { title: 'AUTHENTICATION service', description: null }
    const matches = findOverlap(item, keywords)
    assert.ok(matches.includes('authentication'))
  })
})

// ── checkContextStaleness (DB integration) ──────────────────────────────────

describe('checkContextStaleness', () => {
  let testOrg
  let planningStageId
  let itemId
  let shippedId

  before(async () => {
    testOrg = await createTestOrg()

    // Dedicated throwaway triage-class stage — used purely as an FK target
    // for the synthetic stage_transition_history rows below; the query in
    // stalenessDetector.js only cares about stage_class = 'triage', not
    // which workflow the stage actually belongs to.
    ;({ stageId: planningStageId } = await createTestStage(testOrg.orgId, { stageClass: 'triage' }))

    // Create the main work item
    const item = await createWorkItem(
      {
        title: '__staleness test item ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id: testOrg.orgId,
      },
      AGENT_ID,
    )
    itemId = item.id

    // Create a shipped item in the same org with overlapping domain keywords
    const shipped = await createWorkItem(
      {
        title: '__staleness shipped authentication service ' + Date.now(),
        description: 'Fixed token expiry in the authentication module',
        work_item_type_id: testOrg.typeId,
        owner_org_id: testOrg.orgId,
      },
      AGENT_ID,
    )
    shippedId = shipped.id

    // Mark the shipped item as done
    await query(
      `UPDATE runtime.work_items
       SET spawn_state = 'done', resolved_at = now()
       WHERE id = $1`,
      [shippedId],
    )
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('returns checked=false when no planning stage history exists', async () => {
    const result = await checkContextStaleness(itemId, testOrg.orgId)
    assert.equal(result.checked, false, 'no planning history → checked should be false')
    assert.equal(result.staleCount, 0)
  })

  it('returns staleCount=0 when planning history exists but no entries', async () => {
    if (!planningStageId) return // skip if triage stage not found

    // Insert a fake planning-stage history window ending 5 minutes ago
    await query(`
      INSERT INTO runtime.stage_transition_history
        (work_item_id, from_stage_id, to_stage_id,
         entered_from_stage_at, exited_from_stage_at,
         transitioned_by_user_id)
      VALUES ($1, $2, $2,
              now() - INTERVAL '2 hours',
              now() - INTERVAL '5 minutes',
              $3)
    `, [itemId, planningStageId, AGENT_ID])

    const result = await checkContextStaleness(itemId, testOrg.orgId)
    assert.equal(result.checked, true)
    assert.equal(result.staleCount, 0, 'no planning entries → staleCount should be 0')
  })

  it('detects staleness and writes a note when planning entries overlap shipped items', async () => {
    if (!planningStageId) return // skip if triage stage not found

    // Insert a planning-stage window: 3 hours ago → 1 hour ago
    const { rows: existingHistory } = await query(
      `SELECT id FROM runtime.stage_transition_history
       WHERE work_item_id = $1 AND from_stage_id = $2`,
      [itemId, planningStageId],
    )
    let planningHistoryId
    if (existingHistory.length) {
      planningHistoryId = existingHistory[0].id
      // Update the existing record to cover the window we need
      await query(
        `UPDATE runtime.stage_transition_history
         SET entered_from_stage_at = now() - INTERVAL '3 hours',
             exited_from_stage_at  = now() - INTERVAL '1 hour'
         WHERE id = $1`,
        [planningHistoryId],
      )
    } else {
      const { rows } = await query(`
        INSERT INTO runtime.stage_transition_history
          (work_item_id, from_stage_id, to_stage_id,
           entered_from_stage_at, exited_from_stage_at,
           transitioned_by_user_id)
        VALUES ($1, $2, $2,
                now() - INTERVAL '3 hours',
                now() - INTERVAL '1 hour',
                $3)
        RETURNING id
      `, [itemId, planningStageId, AGENT_ID])
      planningHistoryId = rows[0].id
    }

    // Write a planning context entry with overlapping keywords
    // (must fall inside the planning window: between now-3h and now-1h)
    await query(`
      INSERT INTO runtime.context_entries
        (work_item_id, type, title, content, created_at, author_id, is_agent)
      VALUES ($1, 'discovery', 'Auth service scope',
              'The authentication module handles token validation and expiry.',
              now() - INTERVAL '2 hours', $2, true)
    `, [itemId, AGENT_ID])

    const result = await checkContextStaleness(itemId, testOrg.orgId)
    assert.equal(result.checked, true, 'should have run the check')
    assert.ok(result.staleCount > 0, `expected staleCount > 0, got ${result.staleCount}`)

    // Verify a staleness note entry was written to the journal
    const { rows: notes } = await query(
      `SELECT * FROM runtime.context_entries
       WHERE work_item_id = $1 AND type = 'note' AND is_agent = true
       ORDER BY created_at DESC LIMIT 1`,
      [itemId],
    )
    assert.ok(notes.length > 0, 'should have written a staleness note entry')
    assert.ok(notes[0].title.includes('Staleness check'), 'note title should mention Staleness check')
    assert.ok(notes[0].content.includes('authentication'), 'note should reference matching keyword')
  })
})

// ── GET /work-items/:id/staleness endpoint ───────────────────────────────────

describe('GET /work-items/:id/staleness', () => {
  let testOrg
  let endpointItemId

  before(async () => {
    testOrg = await createTestOrg()

    const item = await createWorkItem(
      {
        title: '__staleness endpoint test ' + Date.now(),
        work_item_type_id: testOrg.typeId,
        owner_org_id: testOrg.orgId,
      },
      AGENT_ID,
    )
    endpointItemId = item.id
  })

  after(async () => {
    await testOrg.teardown()
  })

  it('returns 200 with checked and staleCount for a valid work item', async () => {
    const { status, data } = await api(`/work-items/${endpointItemId}/staleness`)
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`)
    assert.equal(data.workItemId, endpointItemId)
    assert.ok('checked' in data,    'response should have checked field')
    assert.ok('staleCount' in data, 'response should have staleCount field')
    assert.ok('checkedAt' in data,  'response should have checkedAt field')
  })

  it('returns 404 for a non-existent work item', async () => {
    const { status } = await api('/work-items/999999999/staleness')
    assert.equal(status, 404)
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
