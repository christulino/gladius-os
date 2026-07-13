import { describe, it, before, after } from 'node:test'
import { closePool } from './helpers/poolTeardown.js'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { searchIndexHandler, handlesEventType } from '../runtime/subscribers/searchIndex.js'

describe('searchIndex subscriber', () => {
  let workItemId

  before(async () => {
    const r = await query(`
      INSERT INTO runtime.work_items (uri, title, description, owner_org_id, work_item_type_id, workflow_id, current_stage_id)
      SELECT 'flowos://test/work_item/' || gen_random_uuid()::text,
             'INDEX TEST item', 'A description with the word zorglesplat',
             o.id, wit.id, wf.id, st.id
      FROM blueprint.organizations o, blueprint.work_item_types wit, blueprint.workflows wf, blueprint.stages st
      WHERE st.workflow_id = wf.id
      LIMIT 1
      RETURNING id
    `)
    workItemId = r.rows[0].id
  })

  after(async () => {
    if (workItemId) {
      await query('DELETE FROM runtime.work_items WHERE id = $1', [workItemId])
    }
  })

  it('handles work_item.created and friends', () => {
    assert.equal(handlesEventType('work_item.created'), true)
    assert.equal(handlesEventType('work_item.edited'), true)
    assert.equal(handlesEventType('work_item.commented'), true)
    assert.equal(handlesEventType('work_item.comment_edited'), true)
    assert.equal(handlesEventType('work_item.comment_deleted'), true)
    assert.equal(handlesEventType('work_item.transitioned'), false)
  })

  it('builds a search_doc row on work_item.created', async () => {
    await searchIndexHandler({
      event_type: 'work_item.created',
      entity_id: workItemId,
      entity_type: 'work_item',
    })
    const r = await query('SELECT title_text, description_text, search_doc::text FROM runtime.work_item_search WHERE work_item_id = $1', [workItemId])
    assert.equal(r.rowCount, 1)
    assert.equal(r.rows[0].title_text, 'INDEX TEST item')
    assert.match(r.rows[0].description_text, /zorglesplat/)
    assert.match(r.rows[0].search_doc, /zorglesplat/)
  })

  it('rebuilds on work_item.edited', async () => {
    await query('UPDATE runtime.work_items SET title = $1 WHERE id = $2', ['UPDATED title with quibblestick', workItemId])
    await searchIndexHandler({ event_type: 'work_item.edited', entity_id: workItemId, entity_type: 'work_item' })
    const r = await query('SELECT title_text FROM runtime.work_item_search WHERE work_item_id = $1', [workItemId])
    assert.match(r.rows[0].title_text, /quibblestick/)
  })

  it('includes comments_text after work_item.commented', async () => {
    await query(`
      INSERT INTO runtime.work_item_comments (uri, work_item_id, body, author_user_id)
      VALUES ('flowos://test/comments/' || gen_random_uuid(), $1, 'a comment about flibbertigibbets', 1)
    `, [workItemId])
    await searchIndexHandler({ event_type: 'work_item.commented', entity_id: workItemId, entity_type: 'work_item' })
    const r = await query('SELECT comments_text FROM runtime.work_item_search WHERE work_item_id = $1', [workItemId])
    assert.match(r.rows[0].comments_text, /flibbertigibbets/)
  })

  it('reflects comment delete', async () => {
    await query('DELETE FROM runtime.work_item_comments WHERE work_item_id = $1', [workItemId])
    await searchIndexHandler({ event_type: 'work_item.comment_deleted', entity_id: workItemId, entity_type: 'work_item' })
    const r = await query('SELECT comments_text FROM runtime.work_item_search WHERE work_item_id = $1', [workItemId])
    assert.equal(r.rows[0].comments_text, '')
  })
})

// Close the shared PG pool so this test process can exit cleanly (DEBT.26643).
after(closePool)
