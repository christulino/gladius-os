import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

describe('Comments API', () => {
  let workItemId

  before(async () => {
    // Always create a dedicated work item so this test is isolated from other fixtures
    const { data: orgs } = await api('/organizations')
    const { data: types } = await api('/work-item-types')
    assert.ok(orgs.rows.length > 0, 'Need at least one org')
    assert.ok(types.rows.length > 0, 'Need at least one work item type')
    const { data: wi } = await api('/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Comment Test Item ' + Date.now(),
        work_item_type_id: types.rows[0].id,
        owner_org_id: orgs.rows[0].id,
      }),
    })
    workItemId = wi.id
    assert.ok(workItemId, 'Should have a work item to test with')
  })

  // ── List (empty) ──

  it('should return comments array for a work item', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/comments`)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.rows), 'Should return rows array')
    assert.equal(typeof data.count, 'number')
  })

  // ── Create comment ──

  let firstCommentId

  it('should create a comment', async () => {
    const body = 'Test comment ' + Date.now()
    const { status, data } = await api(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
    assert.equal(status, 201)
    assert.ok(data.id, 'Should return comment id')
    assert.equal(data.body, body)
    assert.ok(data.uri, 'Should have a URI')
    firstCommentId = data.id
  })

  it('should show the new comment in the list', async () => {
    const { data } = await api(`/work-items/${workItemId}/comments`)
    const found = data.rows.find(c => c.id === firstCommentId)
    assert.ok(found, 'New comment should appear in list')
    assert.ok(found.author_name, 'Comment should have author name')
    assert.ok(found.created_at, 'Comment should have created_at')
  })

  // ── Reply ──

  let replyId

  it('should create a reply to a comment', async () => {
    const replyBody = 'Reply to comment ' + Date.now()
    const { status, data } = await api(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: replyBody, parent_comment_id: firstCommentId }),
    })
    assert.equal(status, 201)
    assert.equal(data.parent_comment_id, firstCommentId)
    replyId = data.id
  })

  it('should show reply with parent_comment_id in list', async () => {
    const { data } = await api(`/work-items/${workItemId}/comments`)
    const reply = data.rows.find(c => c.id === replyId)
    assert.ok(reply, 'Reply should appear in list')
    assert.equal(reply.parent_comment_id, firstCommentId)
  })

  // ── Validation ──

  it('should reject empty comment body', async () => {
    const { status } = await api(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: '' }),
    })
    assert.ok(status >= 400, 'Should reject empty body')
  })

  it('should reject whitespace-only comment body', async () => {
    const { status } = await api(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: '   ' }),
    })
    assert.ok(status >= 400, 'Should reject whitespace-only body')
  })

  // ── Multiple comments ──

  it('should support multiple comments on the same work item', async () => {
    const bodies = ['Comment A', 'Comment B', 'Comment C']
    for (const body of bodies) {
      const { status } = await api(`/work-items/${workItemId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      assert.equal(status, 201)
    }

    const { data } = await api(`/work-items/${workItemId}/comments`)
    assert.ok(data.count >= 5, 'Should have at least 5 comments (2 from earlier + 3 new)')
  })

  it('should return comments in chronological order', async () => {
    const { data } = await api(`/work-items/${workItemId}/comments`)
    for (let i = 1; i < data.rows.length; i++) {
      const prev = new Date(data.rows[i - 1].created_at)
      const curr = new Date(data.rows[i].created_at)
      assert.ok(curr >= prev, 'Comments should be in chronological order')
    }
  })

  // ── Edit comment ──

  it('should edit a comment body via PATCH', async () => {
    const newBody = 'Edited body ' + Date.now()
    const { status, data } = await api(`/work-items/${workItemId}/comments/${firstCommentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: newBody }),
    })
    assert.equal(status, 200)
    assert.equal(data.body, newBody)
    assert.equal(data.is_edited, true)
  })

  it('should show edited flag and new body in list after PATCH', async () => {
    const { data } = await api(`/work-items/${workItemId}/comments`)
    const c = data.rows.find(r => r.id === firstCommentId)
    assert.ok(c, 'Comment should still be in list')
    assert.ok(c.body.startsWith('Edited body'), 'Body should reflect edit')
    assert.equal(c.is_edited, true)
  })

  it('should reject PATCH with empty body', async () => {
    const { status } = await api(`/work-items/${workItemId}/comments/${firstCommentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: '' }),
    })
    assert.ok(status >= 400)
  })

  it('should return 404 for PATCH on non-existent comment', async () => {
    const { status } = await api(`/work-items/${workItemId}/comments/999999999`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'x' }),
    })
    assert.equal(status, 404)
  })

  // ── Delete comment ──

  it('should delete a comment via DELETE', async () => {
    const { status, data } = await api(`/work-items/${workItemId}/comments/${firstCommentId}`, {
      method: 'DELETE',
    })
    assert.equal(status, 200)
    assert.equal(data.deleted, true)
    assert.equal(data.id, firstCommentId)
  })

  it('should no longer appear in list after DELETE', async () => {
    const { data } = await api(`/work-items/${workItemId}/comments`)
    const gone = data.rows.find(r => r.id === firstCommentId)
    assert.equal(gone, undefined, 'Deleted comment should not be in list')
  })

  it('should return 404 for DELETE on non-existent comment', async () => {
    const { status } = await api(`/work-items/${workItemId}/comments/999999999`, {
      method: 'DELETE',
    })
    assert.equal(status, 404)
  })

  // ── Work item updated_at ──

  it('should update work item updated_at when comment is added', async () => {
    const { data: before } = await api(`/work-items/${workItemId}`)
    const beforeTime = new Date(before.updated_at)

    // Small delay to ensure timestamp difference
    await new Promise(r => setTimeout(r, 50))

    await api(`/work-items/${workItemId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Should update timestamp ' + Date.now() }),
    })

    const { data: after } = await api(`/work-items/${workItemId}`)
    const afterTime = new Date(after.updated_at)
    assert.ok(afterTime >= beforeTime, 'Work item updated_at should be updated')
  })
})
