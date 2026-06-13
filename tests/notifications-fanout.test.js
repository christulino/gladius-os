import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query, getClient } from '../db/postgres.js'
import { close as closeNeo4j } from '../db/neo4j.js'
import { loadMatrix, isEnabled } from '../runtime/notifications/matrix.js'
import { renderSummary } from '../runtime/notifications/summaries.js'
import { extractMentions } from '../runtime/notifications/mentions.js'
import { emitEvent } from '../core/events.js'
import { notificationsHandler, handlesEventType as notifHandles } from '../runtime/subscribers/notifications.js'

describe('notifications/matrix', () => {
  let testUserId
  before(async () => {
    await query(
      `INSERT INTO blueprint.users (uri, email, password_hash, display_name, is_active)
       VALUES ('flowos://system/users/matrix-test', 'matrix-test@flowos.local', 'x', 'Matrix Test', true)
       ON CONFLICT (uri) DO NOTHING`
    )
    const { rows } = await query(`SELECT id FROM blueprint.users WHERE uri = 'flowos://system/users/matrix-test'`)
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

describe('subscribers/notifications — fanout', () => {
  let ownerId, watcherId, actorId, workItemId

  before(async () => {
    // Use ON CONFLICT DO NOTHING + SELECT so re-runs after a killed test don't fail on duplicate URIs
    await query(`
      INSERT INTO blueprint.users (uri, email, password_hash, display_name, is_active)
      VALUES
        ('flowos://system/users/fanout-owner',   'fanout-owner@x',   'x', 'Owner',   true),
        ('flowos://system/users/fanout-watcher', 'fanout-watcher@x', 'x', 'Watcher', true),
        ('flowos://system/users/fanout-actor',   'fanout-actor@x',   'x', 'Actor',   true)
      ON CONFLICT (uri) DO NOTHING
    `)
    const { rows: users } = await query(`
      SELECT id FROM blueprint.users WHERE uri = ANY($1) ORDER BY uri
    `, [['flowos://system/users/fanout-actor', 'flowos://system/users/fanout-owner', 'flowos://system/users/fanout-watcher']])
    ;[actorId, ownerId, watcherId] = users.map(u => u.id)

    // Create a fresh work item so we control exactly which relationships exist.
    // Grabbing an existing item risks picking up orphaned relationships from prior test runs
    // that will cause FK violations when notificationsHandler tries to insert for those users.
    const { rows: wi } = await query(`
      INSERT INTO runtime.work_items (
        uri, work_item_type_id, workflow_id, owner_org_id, title,
        current_stage_id, spawn_state, field_values, tags, estimate_unit, origin,
        entered_current_stage_at, created_at, updated_at
      )
      SELECT
        'flowos://test/work-items/fanout-test', t.id, wtw.workflow_id, o.id,
        'Fanout Test Item', s.id, 'active', '{}', '{}', 'points', 'manual',
        now(), now(), now()
      FROM blueprint.work_item_types t
      JOIN blueprint.work_item_type_workflows wtw ON wtw.work_item_type_id = t.id AND wtw.is_current = true
      CROSS JOIN (SELECT id FROM blueprint.organizations LIMIT 1) o
      JOIN blueprint.stages s ON s.workflow_id = wtw.workflow_id
      ORDER BY t.id ASC, s.display_order ASC
      LIMIT 1
      ON CONFLICT (uri) DO UPDATE SET updated_at = now()
      RETURNING id
    `)
    workItemId = wi[0].id

    await query(`
      INSERT INTO runtime.work_item_user_relationships (work_item_id, user_id, relationship_type)
      VALUES ($1, $2, 'owns'), ($1, $3, 'watching'), ($1, $4, 'watching')
      ON CONFLICT (work_item_id, user_id, relationship_type) DO NOTHING
    `, [workItemId, ownerId, watcherId, actorId])
  })

  after(async () => {
    // Delete relationships first (no CASCADE on work_item_id FK), then work item
    // (CASCADE removes notifications). Users last — work item already gone so no FK conflict.
    await query(`DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = $1`, [workItemId])
    await query(`DELETE FROM runtime.work_items WHERE id = $1`, [workItemId])
    await query(`DELETE FROM blueprint.users WHERE id = ANY($1)`, [[ownerId, watcherId, actorId]])
    // emitEvent → eventProcessor → neo4jSync → db/neo4j creates a driver at module load.
    // Close it here (in the last describe's after) so the worker exits cleanly.
    await closeNeo4j()
  })

  it('writes one notifications row per eligible recipient, excluding actor', async () => {
    const c = await getClient()
    let eventId
    try {
      await c.query('BEGIN')
      eventId = await emitEvent(c, {
        eventType: 'work_item.transitioned',
        entityId:  workItemId,
        actorId:   actorId,
        payload:   { from_stage_name: 'A', to_stage_name: 'B' },
      })
      await c.query('COMMIT')
    } finally { c.release() }

    const event = (await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])).rows[0]
    await notificationsHandler(event)

    const { rows } = await query(
      'SELECT user_id, reasons FROM runtime.notifications WHERE event_id = $1 ORDER BY user_id',
      [eventId]
    )
    const userIds = rows.map(r => r.user_id)
    assert.ok(userIds.includes(ownerId),   'owner must receive notification')
    assert.ok(userIds.includes(watcherId), 'watcher must receive notification')
    assert.ok(!userIds.includes(actorId),  'actor must be suppressed')
  })

  it('collapses dedup: owner + requester -> one row with both reasons', async () => {
    await query('UPDATE runtime.work_items SET requester_id = $1 WHERE id = $2', [ownerId, workItemId])

    const c = await getClient()
    let eventId
    try {
      await c.query('BEGIN')
      eventId = await emitEvent(c, {
        eventType: 'work_item.commented',
        entityId:  workItemId,
        actorId:   actorId,
        payload:   { body: 'a thing', author_name: 'Actor' },
      })
      await c.query('COMMIT')
    } finally { c.release() }

    const event = (await query('SELECT * FROM runtime.events WHERE id = $1', [eventId])).rows[0]
    await notificationsHandler(event)

    const { rows } = await query(
      'SELECT reasons FROM runtime.notifications WHERE event_id = $1 AND user_id = $2',
      [eventId, ownerId]
    )
    assert.equal(rows.length, 1, 'dedup: exactly one row for owner')
    assert.ok(rows[0].reasons.includes('owns'),      'reasons must include owns')
    assert.ok(rows[0].reasons.includes('requester'), 'reasons must include requester')
  })

  it('handlesEventType covers every seeded event type', async () => {
    const { rows } = await query('SELECT DISTINCT event_type FROM blueprint.notification_defaults')
    for (const r of rows) assert.equal(notifHandles(r.event_type), true, r.event_type)
    assert.equal(notifHandles('test.random'), false)
  })
})

