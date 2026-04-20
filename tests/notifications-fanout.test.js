import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { loadMatrix, isEnabled } from '../runtime/notifications/matrix.js'

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
