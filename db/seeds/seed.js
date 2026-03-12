/**
 * db/seeds/seed.js
 * Seeds ALL data into a fresh PostgreSQL database:
 *   1. System foundations (org types, system org, roles, permissions, service classes)
 *   2. Base WIT classes and workflows (7 classes, 5+4 workflows)
 *   3. System-default work item types
 *   4. Enterprise org hierarchy (12 orgs)
 *   5. Org-specific work item types (37 types)
 *   6. Sample work items (46 items)
 *   7. Test user + org membership
 *
 * Run: node db/seeds/seed.js
 */

import 'dotenv/config'
import { query, getClient } from '../../db/postgres.js'
import { generateSystemUri, generateUri } from '../../core/uri.js'

// Base data
import { orgTypes }            from './data/orgTypes.js'
import { roles }               from './data/roles.js'
import { permissions }         from './data/permissions.js'
import { rolePermissions }     from './data/rolePermissions.js'
import { serviceClasses }      from './data/serviceClasses.js'
import { workItemTypeClasses } from './data/workItemTypeClasses.js'
import { workflows }           from './data/workflows.js'
import { workItemTypes }       from './data/workItemTypes.js'

// Enterprise data
import { organizations }        from './enterprise/organizations.js'
import { additionalClasses }    from './enterprise/witClasses.js'
import { additionalWorkflows }  from './enterprise/workflows.js'
import { orgWorkItemTypes }     from './enterprise/witTypes.js'
import { workItems }            from './enterprise/workItems.js'
import { users }                from './enterprise/users.js'

async function seed() {
  console.log('🌱 Starting seed...\n')

  const client = await getClient()

  try {
    await client.query('BEGIN')

    // ===================================================================
    // 1. ORG TYPES
    // ===================================================================
    console.log('  Seeding org types...')
    for (const ot of orgTypes) {
      await client.query(`
        INSERT INTO blueprint.org_types (name, slug, sort_order)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
      `, [ot.name, ot.slug, ot.sort_order])
    }
    console.log(`     ✓ ${orgTypes.length} org types`)

    // ===================================================================
    // 2. SYSTEM ORG
    // ===================================================================
    console.log('\n  Creating system org...')
    const systemOrgUri = generateSystemUri('orgs')
    const systemOrgResult = await client.query(`
      INSERT INTO blueprint.organizations
        (uri, slug, name, org_type, is_active)
      VALUES ($1, 'system', 'Flow OS System', 'system', true)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, uri
    `, [systemOrgUri])
    const systemOrgId = systemOrgResult.rows[0].id
    console.log(`     ✓ System org (id: ${systemOrgId})`)

    // ===================================================================
    // 3. ROLES
    // ===================================================================
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
    }
    console.log(`     ✓ ${roles.length} roles`)

    // ===================================================================
    // 4. PERMISSIONS
    // ===================================================================
    console.log('\n  Seeding permissions...')
    const permissionIds = {}
    for (const perm of permissions) {
      const result = await client.query(`
        INSERT INTO blueprint.permissions (slug, name, description, scope, category)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
        RETURNING id, slug
      `, [perm.slug, perm.name, perm.description, perm.scope, perm.category])
      permissionIds[perm.slug] = result.rows[0].id
    }
    console.log(`     ✓ ${permissions.length} permissions`)

    // ===================================================================
    // 5. ROLE PERMISSIONS
    // ===================================================================
    console.log('\n  Seeding role permissions...')
    for (const rp of rolePermissions) {
      const roleId = roleIds[rp.role_name]
      if (!roleId) continue
      for (const slug of rp.permissions) {
        const permId = permissionIds[slug]
        if (!permId) continue
        await client.query(`
          INSERT INTO blueprint.role_permissions (role_id, permission_id, org_id, granted)
          VALUES ($1, $2, NULL, true)
          ON CONFLICT DO NOTHING
        `, [roleId, permId])
      }
    }
    console.log(`     ✓ Role permissions linked`)

    // ===================================================================
    // 6. WORK ITEM TYPE CLASSES (base + enterprise)
    // ===================================================================
    console.log('\n  Seeding work item type classes...')
    const classIds = {}
    const allClasses = [...workItemTypeClasses, ...additionalClasses]

    for (const cls of allClasses) {
      const existing = await client.query(
        'SELECT id FROM blueprint.work_item_type_classes WHERE owner_org_id = $1 AND name = $2',
        [systemOrgId, cls.name]
      )
      if (existing.rows.length) {
        classIds[cls.name] = existing.rows[0].id
      } else {
        const uri = generateSystemUri('work-item-type-classes')
        const result = await client.query(`
          INSERT INTO blueprint.work_item_type_classes
            (uri, owner_org_id, name, description, is_system_default)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `, [uri, systemOrgId, cls.name, cls.description, cls.is_system_default])
        classIds[cls.name] = result.rows[0].id
      }
    }
    console.log(`     ✓ ${allClasses.length} classes (${workItemTypeClasses.length} base + ${additionalClasses.length} enterprise)`)

    // ===================================================================
    // 7. SERVICE CLASSES
    // ===================================================================
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
    }
    console.log(`     ✓ ${serviceClasses.length} service classes`)

    // ===================================================================
    // 8. WORKFLOWS (base + enterprise)
    // ===================================================================
    console.log('\n  Seeding workflows...')
    const workflowIds = {}
    const stageIdMaps = {}
    const allWorkflows = [...workflows, ...additionalWorkflows]

    for (const wf of allWorkflows) {
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
          RETURNING id
        `, [wfUri, systemOrgId, wf.name, wf.description, wf.version, wf.is_system_default])
        workflowId = wfResult.rows[0].id
      }
      workflowIds[wf.name] = workflowId
      stageIdMaps[wf.name] = {}

      // Insert stages
      for (const stage of wf.stages) {
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
            RETURNING id
          `, [
            stageUri, workflowId,
            stage.name, stage.stage_class, stage.stage_type,
            stage.display_order, stage.is_entry_stage ?? false,
            stage.is_terminal ?? false,
            stage.sla_hours ?? null, stage.wip_limit ?? null,
            stage.has_waiting_queue ?? false,
            stage.requires_review ?? false,
            stage.requires_evidence ?? false,
            stage.measure_substates ?? false,
          ])
          stageRowId = stageResult.rows[0].id
        }
        stageIdMaps[wf.name][stage.key] = stageRowId
      }

      // Insert transitions
      for (const t of wf.transitions) {
        const fromId = stageIdMaps[wf.name][t.from]
        const toId = stageIdMaps[wf.name][t.to]
        if (!fromId || !toId) continue
        await client.query(`
          INSERT INTO blueprint.stage_transitions
            (from_stage_id, to_stage_id, transition_label,
             transition_kind, requires_reason, is_active)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (from_stage_id, to_stage_id) DO UPDATE
            SET transition_label = EXCLUDED.transition_label
        `, [fromId, toId, t.label, t.kind, t.requires_reason ?? false, true])
      }
      console.log(`     ✓ ${wf.name} (${wf.stages.length} stages, ${wf.transitions.length} transitions)`)
    }

    // ===================================================================
    // 9. SYSTEM-DEFAULT WORK ITEM TYPES
    // ===================================================================
    console.log('\n  Seeding system work item types...')
    for (const wit of workItemTypes) {
      const classId = classIds[wit.class_name]
      const workflowId = workflowIds[wit.workflow_name]
      if (!classId || !workflowId) continue

      const existingWit = await client.query(
        'SELECT id, uri FROM blueprint.work_item_types WHERE owner_org_id = $1 AND name = $2 AND version = $3',
        [systemOrgId, wit.name, wit.version]
      )

      let witUri
      if (existingWit.rows.length) {
        witUri = existingWit.rows[0].uri
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
      }

      // Link to workflow
      await client.query(`
        INSERT INTO blueprint.work_item_type_workflows
          (work_item_type_id, workflow_id, is_current)
        SELECT id, $2, true
        FROM blueprint.work_item_types WHERE uri = $1
          AND NOT EXISTS (
            SELECT 1 FROM blueprint.work_item_type_workflows
            WHERE work_item_type_id = (SELECT id FROM blueprint.work_item_types WHERE uri = $1)
              AND workflow_id = $2
          )
      `, [witUri, workflowId])
    }
    console.log(`     ✓ ${workItemTypes.length} system types`)

    // ===================================================================
    // 10. ENTERPRISE ORGANIZATIONS (hierarchy)
    // ===================================================================
    console.log('\n  Creating enterprise organizations...')
    const orgIds = { system: systemOrgId }

    // First pass: orgs whose parents already exist
    for (const org of organizations) {
      const parentId = org.parent_slug ? orgIds[org.parent_slug] : null
      if (org.parent_slug && !parentId) continue
      const uri = generateUri(org.slug, 'orgs')
      const result = await client.query(`
        INSERT INTO blueprint.organizations (uri, slug, name, org_type, parent_id, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, org_type = EXCLUDED.org_type, parent_id = EXCLUDED.parent_id
        RETURNING id
      `, [uri, org.slug, org.name, org.org_type, parentId])
      orgIds[org.slug] = result.rows[0].id
    }

    // Second pass: children whose parents were created in first pass
    for (const org of organizations) {
      if (orgIds[org.slug]) continue
      const parentId = org.parent_slug ? orgIds[org.parent_slug] : null
      if (org.parent_slug && !parentId) {
        console.warn(`     ⚠ Skipping ${org.name}: parent "${org.parent_slug}" not found`)
        continue
      }
      const uri = generateUri(org.slug, 'orgs')
      const result = await client.query(`
        INSERT INTO blueprint.organizations (uri, slug, name, org_type, parent_id, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, org_type = EXCLUDED.org_type, parent_id = EXCLUDED.parent_id
        RETURNING id
      `, [uri, org.slug, org.name, org.org_type, parentId])
      orgIds[org.slug] = result.rows[0].id
    }
    console.log(`     ✓ ${organizations.length} enterprise orgs`)

    // ===================================================================
    // 11. ORG-SPECIFIC WORK ITEM TYPES
    // ===================================================================
    console.log('\n  Creating org-specific work item types...')
    const typeIds = {}

    // Load existing types
    const existingTypes = await client.query(`
      SELECT wit.id, wit.name, o.slug AS org_slug
      FROM blueprint.work_item_types wit
      JOIN blueprint.organizations o ON o.id = wit.owner_org_id
    `)
    for (const row of existingTypes.rows) {
      typeIds[`${row.org_slug}:${row.name}`] = row.id
    }

    // Platform ART gets its own types (not in the enterprise witTypes file)
    const allOrgTypes = [
      ...orgWorkItemTypes,
      { org_slug: 'platform-art', name: 'Platform Feature', description: 'Feature for shared platform services — APIs, SDKs, infrastructure.', class_name: 'Feature', workflow_name: 'Standard Feature', icon: '🔩', color: '#8B5CF6', key_prefix: 'PLAT' },
      { org_slug: 'platform-art', name: 'Platform Epic', description: 'Large platform initiative spanning multiple PIs.', class_name: 'Epic', workflow_name: 'Standard Feature', icon: '🎯', color: '#EC4899', key_prefix: 'PEPC' },
      { org_slug: 'platform-art', name: 'Platform Bug', description: 'Defect in shared platform services.', class_name: 'Bug', workflow_name: 'Bug Triage', icon: '🐛', color: '#EF4444', key_prefix: 'PLBG' },
    ]

    for (const wit of allOrgTypes) {
      const key = `${wit.org_slug}:${wit.name}`
      if (typeIds[key]) continue

      const orgId = orgIds[wit.org_slug]
      const classId = classIds[wit.class_name]
      const workflowId = workflowIds[wit.workflow_name]
      if (!orgId || !classId || !workflowId) {
        if (!orgId) console.warn(`     ⚠ Skipping ${wit.name}: org "${wit.org_slug}" not found`)
        if (!classId) console.warn(`     ⚠ Skipping ${wit.name}: class "${wit.class_name}" not found`)
        if (!workflowId) console.warn(`     ⚠ Skipping ${wit.name}: workflow "${wit.workflow_name}" not found`)
        continue
      }

      const uri = generateUri(wit.org_slug, 'work-item-types')
      const result = await client.query(`
        INSERT INTO blueprint.work_item_types (
          uri, owner_org_id, class_id, name, description,
          version, request_mode, is_published, is_system_default,
          icon, color, key_prefix
        ) VALUES ($1,$2,$3,$4,$5,'1.0.0','user_requestable',true,false,$6,$7,$8)
        RETURNING id
      `, [uri, orgId, classId, wit.name, wit.description, wit.icon, wit.color, wit.key_prefix])
      typeIds[key] = result.rows[0].id

      await client.query(`
        INSERT INTO blueprint.work_item_type_workflows (work_item_type_id, workflow_id, is_current)
        VALUES ($1, $2, true) ON CONFLICT DO NOTHING
      `, [result.rows[0].id, workflowId])
    }
    console.log(`     ✓ ${allOrgTypes.length} org-specific types`)

    // ===================================================================
    // 12. USERS + ORG MEMBERSHIPS
    // ===================================================================
    console.log('\n  Creating users...')

    // Admin user (Chris)
    const adminUri = generateUri('system', 'users')
    const adminResult = await client.query(`
      INSERT INTO blueprint.users (uri, email, display_name, is_active)
      VALUES ($1, 'chris@flowos.dev', 'Chris Tulino', true)
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `, [adminUri])
    const adminId = adminResult.rows[0].id
    const adminRoleId = roleIds['Admin']
    if (adminRoleId) {
      await client.query(`
        INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (user_id, org_id) DO NOTHING
      `, [adminId, systemOrgId, adminRoleId])
    }
    console.log(`     ✓ Chris Tulino (admin, id: ${adminId})`)

    // Enterprise users
    for (const u of users) {
      const uUri = generateUri('system', 'users')
      const uResult = await client.query(`
        INSERT INTO blueprint.users (uri, email, display_name, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id
      `, [uUri, u.email, u.display_name])
      const uId = uResult.rows[0].id

      for (const m of u.memberships) {
        const mOrgId = orgIds[m.org_slug]
        const mRoleId = roleIds[m.role_name]
        if (!mOrgId || !mRoleId) continue
        await client.query(`
          INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
          VALUES ($1, $2, $3, true)
          ON CONFLICT (user_id, org_id) DO NOTHING
        `, [uId, mOrgId, mRoleId])
      }
    }
    console.log(`     ✓ ${users.length} enterprise users with memberships`)

    // ===================================================================
    // 13. SAMPLE WORK ITEMS
    // ===================================================================
    console.log('\n  Creating sample work items...')
    const scResult = await client.query(
      "SELECT id FROM blueprint.service_classes WHERE name = 'Standard' LIMIT 1"
    )
    const serviceClassId = scResult.rows[0]?.id

    let created = 0
    let skipped = 0

    for (const wi of workItems) {
      const orgId = orgIds[wi.org_slug]
      if (!orgId) { skipped++; continue }

      // Find the type
      const typeKey = `${wi.org_slug}:${wi.type_name}`
      let typeId = typeIds[typeKey]

      if (!typeId) {
        const typeResult = await client.query(`
          SELECT wit.id FROM blueprint.work_item_types wit
          WHERE wit.name = $1 AND (wit.owner_org_id = $2 OR wit.is_system_default = true)
          ORDER BY CASE WHEN wit.owner_org_id = $2 THEN 0 ELSE 1 END
          LIMIT 1
        `, [wi.type_name, orgId])
        if (typeResult.rows.length) typeId = typeResult.rows[0].id
      }

      if (!typeId) {
        console.warn(`     ⚠ Skipping: "${wi.title}" — type "${wi.type_name}" not found`)
        skipped++
        continue
      }

      // Resolve workflow and entry stage
      const wfResult = await client.query(`
        SELECT w.id AS workflow_id, s.id AS entry_stage_id
        FROM blueprint.work_item_type_workflows wtw
        JOIN blueprint.workflows w ON w.id = wtw.workflow_id
        JOIN blueprint.stages s ON s.workflow_id = w.id AND s.is_entry_stage = true AND s.is_active = true
        WHERE wtw.work_item_type_id = $1 AND wtw.is_current = true
        LIMIT 1
      `, [typeId])

      if (!wfResult.rows.length) { skipped++; continue }
      const { workflow_id, entry_stage_id } = wfResult.rows[0]

      // Display key
      const prefixResult = await client.query(
        'SELECT key_prefix FROM blueprint.work_item_types WHERE id = $1', [typeId]
      )
      const keyPrefix = prefixResult.rows[0]?.key_prefix
      let displayKey = null
      let seqNum = null
      if (keyPrefix) {
        const seqResult = await client.query("SELECT nextval('runtime.work_item_seq') AS seq")
        seqNum = parseInt(seqResult.rows[0].seq)
        displayKey = `${keyPrefix}.${seqNum}`
      }

      const itemUri = generateUri(wi.org_slug, 'work-items')
      await client.query(`
        INSERT INTO runtime.work_items (
          uri, work_item_type_id, owner_org_id,
          workflow_id, current_stage_id, current_substate,
          service_class_id, spawn_state,
          title, sequence_number, display_key,
          entered_current_stage_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'active',$6,'active',$7,$8,$9,NOW(),NOW(),NOW())
      `, [
        itemUri, typeId, orgId, workflow_id, entry_stage_id,
        serviceClassId, wi.title, seqNum, displayKey,
      ])
      created++
    }
    console.log(`     ✓ ${created} work items created${skipped ? `, ${skipped} skipped` : ''}`)

    await client.query('COMMIT')

    console.log('\n✅ Seed complete.\n')
    console.log('Summary:')
    console.log(`  Org types:      ${orgTypes.length}`)
    console.log(`  Organizations:  1 system + ${organizations.length} enterprise`)
    console.log(`  Roles:          ${roles.length}`)
    console.log(`  Permissions:    ${permissions.length}`)
    console.log(`  WIT Classes:    ${allClasses.length} (${workItemTypeClasses.length} base + ${additionalClasses.length} enterprise)`)
    console.log(`  Service Classes: ${serviceClasses.length}`)
    console.log(`  Workflows:      ${allWorkflows.length} (${workflows.length} base + ${additionalWorkflows.length} enterprise)`)
    console.log(`  WIT Types:      ${workItemTypes.length} system + ${allOrgTypes.length} org-specific`)
    console.log(`  Users:          1 admin + ${users.length} enterprise`)
    console.log(`  Work Items:     ${created}`)

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
