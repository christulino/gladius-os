/**
 * db/seeds/seed.js
 * Seeds system default data into a fresh PostgreSQL database.
 *
 * Run: node db/seeds/seed.js
 *
 * Order matters — foreign key dependencies:
 *   1. System org
 *   2. Roles
 *   3. Work item type classes
 *   4. Service classes
 *   5. Workflows → stages → transitions
 *   6. Work item types (references classes + workflows)
 *
 * This same data is used by core/orgTemplate.js when creating new orgs.
 * Never duplicate seed logic — always import from db/seeds/data/*.
 */

import 'dotenv/config'
import { query, getClient } from '../../db/postgres.js'
import { generateSystemUri, generateUri } from '../../core/uri.js'
import { roles }               from './data/roles.js'
import { serviceClasses }      from './data/serviceClasses.js'
import { workItemTypeClasses }  from './data/workItemTypeClasses.js'
import { workflows }            from './data/workflows.js'
import { workItemTypes }        from './data/workItemTypes.js'

async function seed() {
  console.log('🌱 Starting seed...\n')

  const client = await getClient()

  try {
    await client.query('BEGIN')

    // =========================================================================
    // 1. SYSTEM ORG
    // Home for all system-level entities
    // =========================================================================
    console.log('  Creating system org...')
    const systemOrgUri = generateSystemUri('orgs')
    const systemOrgResult = await client.query(`
      INSERT INTO blueprint.organizations
        (uri, slug, name, org_type, is_active)
      VALUES
        ($1, 'system', 'Flow OS System', 'system', true)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, uri
    `, [systemOrgUri])
    const systemOrgId = systemOrgResult.rows[0].id
    console.log(`     ✓ System org (id: ${systemOrgId})`)

    // =========================================================================
    // 2. ROLES
    // =========================================================================
    console.log('\n  Seeding roles...')
    const roleIds = {}
    for (const role of roles) {
      const uri = generateSystemUri('roles')
      const result = await client.query(`
        INSERT INTO blueprint.roles
          (uri, org_id, name, description, is_system_default)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (org_id, name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id, name
      `, [uri, systemOrgId, role.name, role.description, role.is_system_default])
      roleIds[role.name] = result.rows[0].id
      console.log(`     ✓ Role: ${role.name}`)
    }

    // =========================================================================
    // 3. WORK ITEM TYPE CLASSES
    // =========================================================================
    console.log('\n  Seeding work item type classes...')
    const classIds = {}
    for (const cls of workItemTypeClasses) {
      const uri = generateSystemUri('work-item-type-classes')
      // Check if class already exists before inserting
      const existing = await client.query(
        'SELECT id FROM blueprint.work_item_type_classes WHERE owner_org_id = $1 AND name = $2',
        [systemOrgId, cls.name]
      )
      let classId
      if (existing.rows.length) {
        classId = existing.rows[0].id
      } else {
        const result = await client.query(`
          INSERT INTO blueprint.work_item_type_classes
            (uri, owner_org_id, name, description, is_system_default)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name
        `, [uri, systemOrgId, cls.name, cls.description, cls.is_system_default])
        classId = result.rows[0].id
      }
      classIds[cls.name] = classId
      console.log(`     ✓ Class: ${cls.name}`)
    }

    // =========================================================================
    // 4. SERVICE CLASSES
    // =========================================================================
    console.log('\n  Seeding service classes...')
    for (const sc of serviceClasses) {
      const uri = generateSystemUri('service-classes')
      await client.query(`
        INSERT INTO blueprint.service_classes
          (uri, org_id, name, description, priority_order, color,
           max_concurrent, can_bypass_wip, is_date_driven, is_system_default)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (org_id, name) DO UPDATE SET description = EXCLUDED.description
      `, [
        uri, systemOrgId, sc.name, sc.description,
        sc.priority_order, sc.color,
        sc.max_concurrent ?? null,
        sc.can_bypass_wip ?? false,
        sc.is_date_driven ?? false,
        sc.is_system_default,
      ])
      console.log(`     ✓ Service class: ${sc.name}`)
    }

    // =========================================================================
    // 5. WORKFLOWS → STAGES → TRANSITIONS
    // =========================================================================
    console.log('\n  Seeding workflows...')
    const workflowIds  = {}
    const stageIdMaps  = {}   // workflowName → { stageKey → stageId }

    for (const wf of workflows) {
      // Check if workflow already exists
      const existingWf = await client.query(
        'SELECT id FROM blueprint.workflows WHERE owner_org_id = $1 AND name = $2',
        [systemOrgId, wf.name]
      )
      let workflowId
      if (existingWf.rows.length) {
        workflowId = existingWf.rows[0].id
      } else {
        const wfUri = generateSystemUri('workflows')
        const wfResult = await client.query(`
          INSERT INTO blueprint.workflows
            (uri, owner_org_id, name, description, version, is_system_default)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, name
        `, [wfUri, systemOrgId, wf.name, wf.description, wf.version, wf.is_system_default])
        workflowId = wfResult.rows[0].id
      }
      workflowIds[wf.name] = workflowId
      stageIdMaps[wf.name] = {}
      console.log(`     ✓ Workflow: ${wf.name} (id: ${workflowId})`)

      // Insert stages
      for (const stage of wf.stages) {
        const stageUri = generateSystemUri('stages')
        // Check if stage already exists
        const existingStage = await client.query(
          'SELECT id FROM blueprint.stages WHERE workflow_id = $1 AND name = $2',
          [workflowId, stage.name]
        )
        let stageRowId
        if (existingStage.rows.length) {
          stageRowId = existingStage.rows[0].id
        } else {
          const stageUri = generateSystemUri('stages')
          const stageResult = await client.query(`
            INSERT INTO blueprint.stages (
              uri, workflow_id, name, stage_class, stage_type,
              display_order, is_entry_stage, is_terminal, sla_hours, wip_limit,
              has_waiting_queue, requires_review, requires_evidence, measure_substates
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING id, name
          `, [
            stageUri, workflowId,
            stage.name, stage.stage_class, stage.stage_type,
            stage.display_order, stage.is_entry_stage ?? false,
            stage.is_terminal ?? false,
            stage.sla_hours    ?? null,
            stage.wip_limit    ?? null,
            stage.has_waiting_queue ?? false,
            stage.requires_review   ?? false,
            stage.requires_evidence ?? false,
            stage.measure_substates ?? false,
          ])
          stageRowId = stageResult.rows[0].id
        }
        stageIdMaps[wf.name][stage.key] = stageRowId
        console.log(`       ✓ Stage: ${stage.name}`)
      }

      // Insert transitions
      for (const t of wf.transitions) {
        const fromId = stageIdMaps[wf.name][t.from]
        const toId   = stageIdMaps[wf.name][t.to]
        if (!fromId || !toId) {
          console.warn(`       ⚠ Skipping transition ${t.from} → ${t.to}: stage not found`)
          continue
        }
        await client.query(`
          INSERT INTO blueprint.stage_transitions
            (from_stage_id, to_stage_id, transition_label,
             transition_kind, requires_reason, is_active)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (from_stage_id, to_stage_id) DO UPDATE
            SET transition_label = EXCLUDED.transition_label
        `, [
          fromId, toId,
          t.label, t.kind,
          t.requires_reason ?? false,
          true,
        ])
      }
      console.log(`       ✓ ${wf.transitions.length} transitions`)
    }

    // =========================================================================
    // 6. WORK ITEM TYPES
    // =========================================================================
    console.log('\n  Seeding work item types...')
    for (const wit of workItemTypes) {
      const classId    = classIds[wit.class_name]
      const workflowId = workflowIds[wit.workflow_name]

      if (!classId) {
        console.warn(`     ⚠ Skipping ${wit.name}: class "${wit.class_name}" not found`)
        continue
      }
      if (!workflowId) {
        console.warn(`     ⚠ Skipping ${wit.name}: workflow "${wit.workflow_name}" not found`)
        continue
      }

      const existingWit = await client.query(
        'SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1 AND name = $2 AND version = $3',
        [systemOrgId, wit.name, wit.version]
      )

      let witUri
      if (existingWit.rows.length) {
        console.log(`     ✓ Work item type (already exists): ${wit.name}`)
        witUri = (await client.query('SELECT uri FROM blueprint.work_item_types WHERE id = $1', [existingWit.rows[0].id])).rows[0].uri
      } else {
        witUri = generateSystemUri('work-item-types')
        await client.query(`
          INSERT INTO blueprint.work_item_types (
            uri, owner_org_id, class_id, name, description,
            version, request_mode, is_published, is_system_default,
            icon, color
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
          witUri, systemOrgId, classId,
          wit.name, wit.description, wit.version,
          wit.request_mode, wit.is_published,
          wit.is_system_default, wit.icon, wit.color,
        ])
        console.log(`     ✓ Work item type: ${wit.name}`)
      }

      // Link work item type to workflow (check first — no unique constraint)
      await client.query(`
        INSERT INTO blueprint.work_item_type_workflows
          (work_item_type_id, workflow_id, is_current)
        SELECT id, $2, true
        FROM blueprint.work_item_types
        WHERE uri = $1
          AND NOT EXISTS (
            SELECT 1 FROM blueprint.work_item_type_workflows
            WHERE work_item_type_id = (SELECT id FROM blueprint.work_item_types WHERE uri = $1)
              AND workflow_id = $2
          )
      `, [witUri, workflowId])
    }

    await client.query('COMMIT')
    console.log('\n✅ Seed complete.\n')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n❌ Seed failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
    process.exit(0)
  }
}

seed()
