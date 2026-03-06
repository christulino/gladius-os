/**
 * db/seeds/seed_test_data.js
 * Creates a test user, org membership, and work item for development testing.
 * Run with: node db/seeds/seed_test_data.js
 *
 * DO NOT run in production.
 */

import 'dotenv/config'
import { query, getClient } from '../../db/postgres.js'
import { generateUri }      from '../../core/uri.js'

async function seedTestData() {
  console.log('🧪 Seeding test data...\n')

  const client = await getClient()

  try {
    await client.query('BEGIN')

    // Get system org
    const orgResult = await client.query(
      "SELECT id, slug FROM blueprint.organizations WHERE slug = 'system'"
    )
    const org = orgResult.rows[0]
    console.log(`  Using org: ${org.slug} (id: ${org.id})`)

    // Get member role
    const roleResult = await client.query(
      "SELECT id FROM blueprint.roles WHERE name = 'member' AND org_id = $1",
      [org.id]
    )
    const roleId = roleResult.rows[0].id

    // Get Task work item type
    const typeResult = await client.query(
      "SELECT id FROM blueprint.work_item_types WHERE name = 'Task'"
    )
    const workItemTypeId = typeResult.rows[0].id

    // Get the Inbox stage (entry stage of Simple Task workflow)
    const stageResult = await client.query(`
      SELECT s.id, s.name FROM blueprint.stages s
      JOIN blueprint.workflows w ON w.id = s.workflow_id
      WHERE w.name = 'Simple Task' AND s.is_entry_stage = true
    `)
    const entryStage = stageResult.rows[0]
    console.log(`  Entry stage: ${entryStage.name} (id: ${entryStage.id})`)

    // Get Standard service class
    const scResult = await client.query(
      "SELECT id FROM blueprint.service_classes WHERE name = 'Standard'"
    )
    const serviceClassId = scResult.rows[0].id

    // Create test user
    const userUri = generateUri('system', 'users')
    const userResult = await client.query(`
      INSERT INTO blueprint.users (uri, email, display_name, is_active)
      VALUES ($1, 'chris@flowos.dev', 'Chris Tulino', true)
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id, email, display_name
    `, [userUri])
    const user = userResult.rows[0]
    console.log(`  ✓ User: ${user.display_name} (id: ${user.id})`)

    // Create org membership
    await client.query(`
      INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (user_id, org_id) DO NOTHING
    `, [user.id, org.id, roleId])
    console.log(`  ✓ Membership: ${user.display_name} → system org (member)`)

    // Get Simple Task workflow id
    const wfResult = await client.query(
      "SELECT id FROM blueprint.workflows WHERE name = 'Simple Task'"
    )
    const workflowId = wfResult.rows[0].id

    // Create a test work item
    const workItemUri = generateUri('system', 'work-items')
    const workItemResult = await client.query(`
      INSERT INTO runtime.work_items (
        uri, work_item_type_id, owner_org_id,
        workflow_id, current_stage_id, current_substate,
        service_class_id, spawn_state,
        title, field_values,
        entered_current_stage_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,'active',$6,'active',$7,$8,NOW(),NOW(),NOW())
      RETURNING id, uri, title
    `, [
      workItemUri,
      workItemTypeId,
      org.id,
      workflowId,
      entryStage.id,
      serviceClassId,
      'Fix the login button on mobile',
      JSON.stringify({ estimate_hours: 2 }),
    ])
    const workItem = workItemResult.rows[0]
    console.log(`  ✓ Work item: "${workItem.title}" (id: ${workItem.id})`)
    console.log(`    URI: ${workItem.uri}`)

    // Get the In Progress stage so we know what to transition to
    const inProgressResult = await client.query(`
      SELECT s.id, s.name FROM blueprint.stages s
      JOIN blueprint.workflows w ON w.id = s.workflow_id
      WHERE w.name = 'Simple Task' AND s.name = 'In Progress'
    `)
    const inProgressStage = inProgressResult.rows[0]

    await client.query('COMMIT')

    console.log('\n✅ Test data ready.\n')
    console.log('Test this transition:')
    console.log(`  Work item URI: ${workItem.uri}`)
    console.log(`  Work item ID:  ${workItem.id}`)
    console.log(`  Current stage: ${entryStage.name} (id: ${entryStage.id})`)
    console.log(`  Transition to: ${inProgressStage.name} (id: ${inProgressStage.id})`)
    console.log(`  User ID:       ${user.id}`)
    console.log(`
Test prepare endpoint:
  curl "http://localhost:3000/v1/work-items/${encodeURIComponent(workItem.uri)}/transition/prepare?to_stage_id=${inProgressStage.id}"

Test execute endpoint:
  curl -X POST "http://localhost:3000/v1/work-items/${encodeURIComponent(workItem.uri)}/transition" \\
    -H "Content-Type: application/json" \\
    -d '{"to_stage_id": ${inProgressStage.id}}'
`)

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n❌ Failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
    process.exit(0)
  }
}

seedTestData()
