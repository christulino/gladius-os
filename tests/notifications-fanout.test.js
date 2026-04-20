import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { loadMatrix, isEnabled } from '../runtime/notifications/matrix.js'
import { renderSummary } from '../runtime/notifications/summaries.js'
import { extractMentions } from '../runtime/notifications/mentions.js'

describe('notifications/matrix', () => {
  let testUserId
  before(async () => {
    const { rows } = await query(
      `INSERT INTO blueprint.users (uri, email, password_hash, display_name, is_active)
       VALUES ('flowos://system/users/matrix-test', 'matrix-test@flowos.local', 'x', 'Matrix Test', true)
       RETURNING id`
    )
    testUserId = rows[0].id
  })
  after(async () => {
    await query('DELETE FROM blueprint.user_notification_overrides WHERE user_id = $1', [testUserId])
    await query('DELETE FROM blueprint.users WHERE id = $1', [testUserId])
  })

  it('loads defaults from blueprint.notification_defaults', async () => {
    const m = await loadMatrix(testUserId)
    assert.equal(m.isEnabled('owns', 'work_item.transitioned'), true)
    assert.equal(m.isEnabled('watching', 'work_item.edited'), true)
    assert.equal(m.isEnabled('owns', 'work_item.edited'), false)
  })

  it('overrides shadow the default', async () => {
    await query(
      `INSERT INTO blueprint.user_notification_overrides (user_id, relationship_type, event_type, enabled)
       VALUES ($1, 'watching', 'work_item.edited', false)`,
      [testUserId]
    )
    const m = await loadMatrix(testUserId)
    assert.equal(m.isEnabled('watching', 'work_item.edited'), false)
  })

  it('isEnabled is a pure function over a loaded matrix', () => {
    const m = {
      defaults:  new Map([['watching|work_item.edited', true]]),
      overrides: new Map([['watching|work_item.edited', false]]),
    }
    assert.equal(isEnabled(m, 'watching', 'work_item.edited'), false)
    assert.equal(isEnabled(m, 'owns', 'work_item.unknown'), false)
  })
})

describe('notifications/summaries', () => {
  const baseWorkItem = { id: 42, display_key: 'BUG.42', title: 'Login is broken' }

  it('renders work_item.transitioned summary', () => {
    const s = renderSummary(
      { event_type: 'work_item.transitioned', payload: { from_stage_name: 'Triage', to_stage_name: 'In Progress' } },
      baseWorkItem,
    )
    assert.match(s, /BUG\.42/)
    assert.match(s, /Triage/)
    assert.match(s, /In Progress/)
  })

  it('renders work_item.commented summary with truncated body', () => {
    const long = 'x'.repeat(200)
    const s = renderSummary(
      { event_type: 'work_item.commented', payload: { body: long, author_name: 'Chris' } },
      baseWorkItem,
    )
    assert.match(s, /Chris/)
    assert.match(s, /BUG\.42/)
    assert.ok(s.length < 180, 'summary should truncate')
  })

  it('falls back to a generic summary for unknown event types', () => {
    const s = renderSummary(
      { event_type: 'work_item.whatever', payload: {} },
      baseWorkItem,
    )
    assert.match(s, /BUG\.42/)
  })
})

describe('notifications/mentions', () => {
  it('extracts @handles from comment text', () => {
    const ids = extractMentions('hey @alice and @bob, look at this', {
      alice: 10, bob: 11, carol: 12,
    })
    assert.deepEqual(ids.sort((a, b) => a - b), [10, 11])
  })

  it('ignores unknown handles', () => {
    const ids = extractMentions('@mystery wrote this', { alice: 10 })
    assert.deepEqual(ids, [])
  })

  it('deduplicates repeated mentions', () => {
    const ids = extractMentions('@alice @alice @alice', { alice: 10 })
    assert.deepEqual(ids, [10])
  })

  it('handles empty / null input', () => {
    assert.deepEqual(extractMentions('', {}), [])
    assert.deepEqual(extractMentions(null, {}), [])
  })
})
