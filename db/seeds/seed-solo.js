/**
 * db/seeds/seed-solo.js
 * Lightweight "seed-and-go" for solo installers.
 *
 * Creates everything needed to start tracking work immediately:
 *   1. System foundations (org types, system org, roles, permissions,
 *      service classes, WIT classes, base workflows, WIT types)
 *   2. "Feature Development" workflow (Backlog → Todo → Discovery →
 *      Planning → Dev/Test → Review → Done)
 *   3. User org "My Workspace" + admin membership
 *   4. "Feature" WIT type scoped to the user org
 *   5. Agent user (headless service account for MCP / playbook execution)
 *   6. Org AI model (requires GLADIUS_ENCRYPTION_KEY + ANTHROPIC_API_KEY)
 *   7. Canonical Discovery + Planning stage playbooks
 *
 * Usage:
 *   npm run seed:solo
 *
 * Environment variables (all optional — sensible defaults apply):
 *   GLADIUS_SOLO_EMAIL      admin email       (default: admin@example.com)
 *   GLADIUS_SOLO_PASSWORD   admin password    (generated + printed if not set)
 *   GLADIUS_SOLO_NAME       admin name        (default: Admin)
 *   GLADIUS_ENCRYPTION_KEY  32-byte hex key   (required for AI model row)
 *   ANTHROPIC_API_KEY       Anthropic API key (required for AI model row)
 */

import 'dotenv/config'
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { getClient } from '../../db/postgres.js'
import { generateSystemUri, generateUri } from '../../core/uri.js'

import { orgTypes }            from './data/orgTypes.js'
import { roles }               from './data/roles.js'
import { permissions }         from './data/permissions.js'
import { rolePermissions }     from './data/rolePermissions.js'
import { serviceClasses }      from './data/serviceClasses.js'
import { workItemTypeClasses } from './data/workItemTypeClasses.js'
import { workflows }           from './data/workflows.js'
import { workItemTypes }       from './data/workItemTypes.js'

// ─── Feature Development workflow ─────────────────────────────────────────────
// Kanban-native workflow for AI-assisted software development.
// Mirrors the Gladius dogfood board: Backlog → Todo → Discovery →
// Planning → Dev/Test → Review → Done.
const FEATURE_DEV_WORKFLOW = {
  name: 'Feature Development',
  description:
    'Kanban workflow for AI-assisted software feature development. ' +
    'Includes discovery and planning stages for structured problem framing.',
  is_system_default: true,
  version: '1.0.0',
  stages: [
    {
      key: 'backlog', name: 'Backlog',
      stage_class: 'intake', stage_type: 'waiting',
      display_order: 1, is_entry_stage: true,
    },
    {
      key: 'todo', name: 'Todo',
      stage_class: 'queued', stage_type: 'waiting',
      display_order: 2, has_waiting_queue: true,
    },
    {
      key: 'discovery', name: 'Discovery',
      stage_class: 'in-progress', stage_type: 'working',
      display_order: 3,
    },
    {
      key: 'planning', name: 'Planning',
      stage_class: 'in-progress', stage_type: 'working',
      display_order: 4,
    },
    {
      key: 'dev_test', name: 'Dev/Test',
      stage_class: 'in-progress', stage_type: 'working',
      display_order: 5,
    },
    {
      key: 'review', name: 'Review',
      stage_class: 'review', stage_type: 'working',
      display_order: 6, requires_review: true,
    },
    {
      key: 'done', name: 'Done',
      stage_class: 'done', stage_type: 'waiting',
      display_order: 7, is_terminal: true,
    },
    {
      key: 'cancelled', name: 'Cancelled',
      stage_class: 'cancelled', stage_type: 'waiting',
      display_order: 8, is_terminal: true,
    },
  ],
  transitions: [
    { from: 'backlog',   to: 'todo',      label: 'Add to Todo',       kind: 'forward' },
    { from: 'todo',      to: 'discovery', label: 'Start Discovery',   kind: 'forward' },
    { from: 'todo',      to: 'planning',  label: 'Skip to Planning',  kind: 'forward' },
    { from: 'discovery', to: 'planning',  label: 'Start Planning',    kind: 'forward' },
    { from: 'planning',  to: 'dev_test',  label: 'Start Dev',         kind: 'forward' },
    { from: 'dev_test',  to: 'review',    label: 'Submit for Review', kind: 'forward' },
    { from: 'review',    to: 'done',      label: 'Approve',           kind: 'forward' },
    { from: 'review',    to: 'dev_test',  label: 'Request Changes',   kind: 'backward', requires_reason: true },
    { from: 'backlog',   to: 'cancelled', label: 'Cancel',            kind: 'forward',  requires_reason: true },
    { from: 'todo',      to: 'cancelled', label: 'Cancel',            kind: 'forward',  requires_reason: true },
    { from: 'dev_test',  to: 'cancelled', label: 'Cancel',            kind: 'forward',  requires_reason: true },
  ],
}

// ─── Canonical playbook content ────────────────────────────────────────────────

const DISCOVERY_PLAYBOOK = `---
trigger: stage_entry
model: sonnet
context:
  pull:
    - discovery
    - acceptance
    - design
    - note
  org:
    - decision
  write:
    - discovery
    - acceptance
---

You are a discovery specialist helping frame a software work item before development begins.

Review the item description and any available journal context, then write back:
1. A **discovery** entry summarizing what you know, what is unclear, and what needs investigation before development can start.
2. A draft **acceptance** entry listing specific, independently-verifiable conditions that define "done" for this item.

Be concrete and actionable. Discovery notes should guide the planning stage, not recap the title.`

const PLANNING_PLAYBOOK = `---
trigger: stage_entry
model: sonnet
context:
  pull:
    - discovery
    - acceptance
    - design
    - decision
    - note
  org:
    - decision
  write:
    - design
    - note
---

You are a technical lead helping plan implementation for a software work item.

Based on the discovery notes and acceptance criteria already in the journal, write back:
1. A **design** entry outlining the technical approach: what to build, how, and the key architectural decisions.
2. A **note** listing implementation tasks as a numbered checklist, and flagging any blockers, open questions, or risks.

Keep the design pragmatic — clear enough to guide a developer, not an exhaustive specification.`

// ─── Encryption helper ─────────────────────────────────────────────────────────
// Inlined to avoid importing the full runtime module (which requires a live pool).
function encryptApiKey(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join('.')
}

// ─── Seed a single workflow into the DB ────────────────────────────────────────
async function seedWorkflow(client, wf, systemOrgId) {
  const existing = await client.query(
    'SELECT id FROM blueprint.workflows WHERE owner_org_id = $1 AND name = $2',
    [systemOrgId, wf.name]
  )
  let workflowId
  if (existing.rows.length) {
    workflowId = existing.rows[0].id
  } else {
    const uri = generateSystemUri('workflows')
    const r = await client.query(`
      INSERT INTO blueprint.workflows
        (uri, owner_org_id, name, description, version, is_system_default)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id
    `, [uri, systemOrgId, wf.name, wf.description, wf.version, wf.is_system_default ?? false])
    workflowId = r.rows[0].id
  }

  const stageIds = {}
  for (const stage of wf.stages) {
    const ex = await client.query(
      'SELECT id FROM blueprint.stages WHERE workflow_id = $1 AND name = $2',
      [workflowId, stage.name]
    )
    let stageId
    if (ex.rows.length) {
      stageId = ex.rows[0].id
    } else {
      const uri = generateSystemUri('stages')
      const r = await client.query(`
        INSERT INTO blueprint.stages (
          uri, workflow_id, name, stage_class, stage_type,
          display_order, is_entry_stage, is_terminal, sla_hours, wip_limit,
          has_waiting_queue, requires_review, requires_evidence, measure_substates
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id
      `, [
        uri, workflowId,
        stage.name, stage.stage_class, stage.stage_type,
        stage.display_order, stage.is_entry_stage ?? false,
        stage.is_terminal ?? false,
        stage.sla_hours ?? null, stage.wip_limit ?? null,
        stage.has_waiting_queue ?? false,
        stage.requires_review ?? false,
        stage.requires_evidence ?? false,
        stage.measure_substates ?? false,
      ])
      stageId = r.rows[0].id
    }
    stageIds[stage.key] = stageId
  }

  for (const t of wf.transitions) {
    const fromId = stageIds[t.from]
    const toId   = stageIds[t.to]
    if (!fromId || !toId) continue
    await client.query(`
      INSERT INTO blueprint.stage_transitions
        (from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason, is_active)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (from_stage_id, to_stage_id) DO UPDATE
        SET transition_label = EXCLUDED.transition_label
    `, [fromId, toId, t.label, t.kind, t.requires_reason ?? false, true])
  }

  return { workflowId, stageIds }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Gladius solo seed starting...\n')

  // ── Admin credentials ─────────────────────────────────────────────────────
  const adminEmail = (process.env.GLADIUS_SOLO_EMAIL || 'admin@example.com').toLowerCase().trim()
  const adminName  = (process.env.GLADIUS_SOLO_NAME  || 'Admin').trim()
  let   adminPassword = process.env.GLADIUS_SOLO_PASSWORD || ''
  let   generatedPassword = false

  if (!adminPassword) {
    adminPassword = crypto.randomBytes(12).toString('base64url')
    generatedPassword = true
  }

  // ── AI model config ───────────────────────────────────────────────────────
  const encKey       = process.env.GLADIUS_ENCRYPTION_KEY || ''
  const anthropicKey = process.env.ANTHROPIC_API_KEY      || ''
  const seedAiModel  = encKey.length === 64 && anthropicKey.length > 0

  if (!seedAiModel) {
    console.log('  NOTE: GLADIUS_ENCRYPTION_KEY or ANTHROPIC_API_KEY not set.')
    console.log('        AI model row and playbooks will be skipped.')
    console.log('        Set both to enable playbook execution. See .env.example.\n')
  }

  const client = await getClient()

  try {
    await client.query('BEGIN')

    // ==================================================================
    // 1. ORG TYPES
    // ==================================================================
    console.log('  [1/10] Org types...')
    for (const ot of orgTypes) {
      await client.query(`
        INSERT INTO blueprint.org_types (name, slug, sort_order)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
      `, [ot.name, ot.slug, ot.sort_order])
    }
    console.log(`         + ${orgTypes.length} types`)

    // ==================================================================
    // 2. SYSTEM ORG
    // ==================================================================
    console.log('  [2/10] System org...')
    const systemOrgUri = generateSystemUri('orgs')
    const sysOrgR = await client.query(`
      INSERT INTO blueprint.organizations (uri, slug, name, org_type, is_active)
      VALUES ($1, 'system', 'Gladius System', 'system', true)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [systemOrgUri])
    const systemOrgId = sysOrgR.rows[0].id
    console.log(`         + system org (id: ${systemOrgId})`)

    // ==================================================================
    // 3. ROLES
    // ==================================================================
    console.log('  [3/10] Roles...')
    const roleIds = {}
    for (const role of roles) {
      const uri = generateSystemUri('roles')
      const r = await client.query(`
        INSERT INTO blueprint.roles (uri, org_id, name, description, is_system_default)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (org_id, name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id, name
      `, [uri, systemOrgId, role.name, role.description, role.is_system_default])
      roleIds[role.name] = r.rows[0].id
    }
    console.log(`         + ${roles.length} roles`)

    // ==================================================================
    // 4. PERMISSIONS
    // ==================================================================
    console.log('  [4/10] Permissions...')
    const permissionIds = {}
    for (const perm of permissions) {
      const r = await client.query(`
        INSERT INTO blueprint.permissions (slug, name, description, scope, category)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
        RETURNING id, slug
      `, [perm.slug, perm.name, perm.description, perm.scope, perm.category])
      permissionIds[perm.slug] = r.rows[0].id
    }
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
    console.log(`         + ${permissions.length} permissions, role assignments linked`)

    // ==================================================================
    // 5. SERVICE CLASSES
    // ==================================================================
    console.log('  [5/10] Service classes...')
    for (const sc of serviceClasses) {
      const uri = generateSystemUri('service-classes')
      await client.query(`
        INSERT INTO blueprint.service_classes
          (uri, org_id, name, description, priority_order, color,
           max_concurrent, can_bypass_wip, is_date_driven, is_system_default)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
    console.log(`         + ${serviceClasses.length} service classes`)

    // ==================================================================
    // 6. WIT CLASSES
    // ==================================================================
    console.log('  [6/10] WIT classes...')
    const classIds = {}
    for (const cls of workItemTypeClasses) {
      const ex = await client.query(
        'SELECT id FROM blueprint.work_item_type_classes WHERE owner_org_id = $1 AND name = $2',
        [systemOrgId, cls.name]
      )
      if (ex.rows.length) {
        classIds[cls.name] = ex.rows[0].id
      } else {
        const uri = generateSystemUri('work-item-type-classes')
        const r = await client.query(`
          INSERT INTO blueprint.work_item_type_classes
            (uri, owner_org_id, name, description, is_system_default)
          VALUES ($1,$2,$3,$4,$5)
          RETURNING id
        `, [uri, systemOrgId, cls.name, cls.description, cls.is_system_default])
        classIds[cls.name] = r.rows[0].id
      }
    }
    console.log(`         + ${workItemTypeClasses.length} classes`)

    // ==================================================================
    // 7. WORKFLOWS
    // ==================================================================
    console.log('  [7/10] Workflows...')
    const workflowIds = {}
    const stageIdMaps = {}

    for (const wf of [...workflows, FEATURE_DEV_WORKFLOW]) {
      const { workflowId, stageIds } = await seedWorkflow(client, wf, systemOrgId)
      workflowIds[wf.name] = workflowId
      stageIdMaps[wf.name] = stageIds
      console.log(`         + ${wf.name} (${wf.stages.length} stages, ${wf.transitions.length} transitions)`)
    }

    // Set default workflows on WIT classes
    for (const cls of workItemTypeClasses) {
      if (cls.default_workflow_name && workflowIds[cls.default_workflow_name]) {
        await client.query(`
          UPDATE blueprint.work_item_type_classes
          SET default_workflow_id = $1, updated_at = NOW()
          WHERE id = $2
        `, [workflowIds[cls.default_workflow_name], classIds[cls.name]])
      }
    }

    // ==================================================================
    // 8. SYSTEM WIT TYPES
    // ==================================================================
    console.log('  [8/10] System WIT types...')
    for (const wit of workItemTypes) {
      const classId    = classIds[wit.class_name]
      const workflowId = workflowIds[wit.workflow_name]
      if (!classId || !workflowId) continue

      const ex = await client.query(
        'SELECT id, uri FROM blueprint.work_item_types WHERE owner_org_id = $1 AND name = $2 AND version = $3',
        [systemOrgId, wit.name, wit.version]
      )
      let witUri
      if (ex.rows.length) {
        witUri = ex.rows[0].uri
      } else {
        witUri = generateSystemUri('work-item-types')
        await client.query(`
          INSERT INTO blueprint.work_item_types (
            uri, owner_org_id, class_id, name, description,
            version, request_mode, is_published, is_system_default, icon, color
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
          witUri, systemOrgId, classId,
          wit.name, wit.description, wit.version,
          wit.request_mode, wit.is_published,
          wit.is_system_default, wit.icon, wit.color,
        ])
      }
      await client.query(`
        INSERT INTO blueprint.work_item_type_workflows (work_item_type_id, workflow_id, is_current)
        SELECT id, $2, true FROM blueprint.work_item_types WHERE uri = $1
          AND NOT EXISTS (
            SELECT 1 FROM blueprint.work_item_type_workflows
            WHERE work_item_type_id = (SELECT id FROM blueprint.work_item_types WHERE uri = $1)
              AND workflow_id = $2
          )
      `, [witUri, workflowId])
    }
    console.log(`         + ${workItemTypes.length} system WIT types`)

    // ==================================================================
    // 9. USER ORG, ADMIN USER, AGENT USER
    // ==================================================================
    console.log('  [9/10] User org + users...')

    // User org
    const userOrgSlug = 'my-workspace'
    const userOrgUri  = generateUri(userOrgSlug, 'orgs')
    const userOrgR = await client.query(`
      INSERT INTO blueprint.organizations (uri, slug, name, org_type, is_active)
      VALUES ($1, $2, 'My Workspace', 'team', true)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [userOrgUri, userOrgSlug])
    const userOrgId = userOrgR.rows[0].id

    // Admin user
    const passwordHash = await bcrypt.hash(adminPassword, 12)
    const adminUri = generateUri(userOrgSlug, 'users')
    const adminR = await client.query(`
      INSERT INTO blueprint.users (uri, email, display_name, password_hash, is_admin, is_active)
      VALUES ($1, $2, $3, $4, true, true)
      ON CONFLICT (email) DO UPDATE SET
        display_name  = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        is_admin      = true,
        updated_at    = NOW()
      RETURNING id
    `, [adminUri, adminEmail, adminName, passwordHash])
    const adminId = adminR.rows[0].id

    const adminRoleId   = roleIds['Admin']
    const orgAdminRoleId = roleIds['Org Admin']
    if (adminRoleId) {
      await client.query(`
        INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
        VALUES ($1, $2, $3, true) ON CONFLICT (user_id, org_id) DO NOTHING
      `, [adminId, systemOrgId, adminRoleId])
    }
    if (orgAdminRoleId) {
      await client.query(`
        INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
        VALUES ($1, $2, $3, true) ON CONFLICT (user_id, org_id) DO NOTHING
      `, [adminId, userOrgId, orgAdminRoleId])
    }
    console.log(`         + admin: ${adminName} <${adminEmail}> (id: ${adminId})`)

    // Agent user (headless service account — no password)
    const agentEmail = `agent@${userOrgSlug}.internal`
    const agentUri   = generateUri(userOrgSlug, 'users')
    const agentR = await client.query(`
      INSERT INTO blueprint.users (uri, email, display_name, is_active)
      VALUES ($1, $2, 'Gladius Agent', true)
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `, [agentUri, agentEmail])
    const agentId = agentR.rows[0].id
    const memberRoleId = roleIds['Team Member']
    if (memberRoleId) {
      await client.query(`
        INSERT INTO blueprint.org_memberships (user_id, org_id, role_id, is_active)
        VALUES ($1, $2, $3, true) ON CONFLICT (user_id, org_id) DO NOTHING
      `, [agentId, userOrgId, memberRoleId])
    }
    console.log(`         + agent: Gladius Agent <${agentEmail}> (id: ${agentId})`)

    // ==================================================================
    // 10. ORG FEATURE TYPE + AI MODEL + PLAYBOOKS
    // ==================================================================
    console.log('  [10/10] Org WIT type, AI model, playbooks...')

    const featureClassId = classIds['Feature']
    const featureDevWfId = workflowIds['Feature Development']
    const featureWitUri  = generateUri(userOrgSlug, 'work-item-types')
    let featureTypeId

    const exFeat = await client.query(
      `SELECT id FROM blueprint.work_item_types WHERE owner_org_id = $1 AND name = 'Feature'`,
      [userOrgId]
    )
    if (exFeat.rows.length) {
      featureTypeId = exFeat.rows[0].id
    } else {
      const r = await client.query(`
        INSERT INTO blueprint.work_item_types (
          uri, owner_org_id, class_id, name, description,
          version, request_mode, is_published, is_system_default, icon, color, key_prefix
        ) VALUES ($1,$2,$3,'Feature',
          'A user-facing capability tracked through the full development lifecycle.',
          '1.0.0','user_requestable',true,false,'⭐','#8B5CF6','FEAT')
        RETURNING id
      `, [featureWitUri, userOrgId, featureClassId])
      featureTypeId = r.rows[0].id
    }
    await client.query(`
      INSERT INTO blueprint.work_item_type_workflows (work_item_type_id, workflow_id, is_current)
      VALUES ($1, $2, true) ON CONFLICT DO NOTHING
    `, [featureTypeId, featureDevWfId])
    console.log(`         + Feature type (id: ${featureTypeId}, key_prefix: FEAT)`)

    if (seedAiModel) {
      const enc = encryptApiKey(anthropicKey, encKey)
      await client.query(`
        INSERT INTO blueprint.org_ai_models (org_id, name, provider, model, api_key_enc)
        VALUES ($1, 'sonnet', 'anthropic', 'claude-sonnet-4-5', $2)
        ON CONFLICT (org_id, name) DO UPDATE SET
          model = EXCLUDED.model, api_key_enc = EXCLUDED.api_key_enc, updated_at = NOW()
      `, [userOrgId, enc])
      console.log('         + AI model "sonnet" (claude-sonnet-4-5)')

      // Discovery playbook
      const discoveryStageId = stageIdMaps['Feature Development']['discovery']
      const exDisc = await client.query(
        'SELECT id FROM blueprint.stage_playbooks WHERE stage_id = $1 AND name = $2',
        [discoveryStageId, 'Discovery: Frame the Problem']
      )
      if (!exDisc.rows.length) {
        await client.query(
          `INSERT INTO blueprint.stage_playbooks (stage_id, name, content)
           VALUES ($1, $2, $3)`,
          [discoveryStageId, 'Discovery: Frame the Problem', DISCOVERY_PLAYBOOK]
        )
      }

      // Planning playbook
      const planningStageId = stageIdMaps['Feature Development']['planning']
      const exPlan = await client.query(
        'SELECT id FROM blueprint.stage_playbooks WHERE stage_id = $1 AND name = $2',
        [planningStageId, 'Planning: Design & Task Breakdown']
      )
      if (!exPlan.rows.length) {
        await client.query(
          `INSERT INTO blueprint.stage_playbooks (stage_id, name, content)
           VALUES ($1, $2, $3)`,
          [planningStageId, 'Planning: Design & Task Breakdown', PLANNING_PLAYBOOK]
        )
      }
      console.log('         + 2 playbooks (Discovery, Planning)')
    }

    await client.query('COMMIT')

    // ==================================================================
    // SUMMARY
    // ==================================================================
    console.log('\nSolo seed complete.\n')
    console.log('  ─────────────────────────────────────────────────────────')
    console.log(`  Org:           My Workspace (slug: my-workspace)`)
    console.log(`  Admin email:   ${adminEmail}`)
    if (generatedPassword) {
      console.log(`  Admin password (SAVE THIS — shown once):`)
      console.log(`    ${adminPassword}`)
    }
    console.log(`  Agent user:    Gladius Agent <${agentEmail}> (id: ${agentId})`)
    console.log(`  Workflow:      Feature Development (8 stages)`)
    console.log(`  WIT type:      Feature (key_prefix: FEAT)`)
    if (seedAiModel) {
      console.log('  AI model:      sonnet → claude-sonnet-4-5')
      console.log('  Playbooks:     Discovery: Frame the Problem')
      console.log('                 Planning: Design & Task Breakdown')
    } else {
      console.log('  AI model:      skipped (set GLADIUS_ENCRYPTION_KEY + ANTHROPIC_API_KEY)')
    }
    console.log('  ─────────────────────────────────────────────────────────')
    console.log('\n  Next steps:')
    console.log('    1. npm run dev')
    console.log('    2. Open http://localhost:3000/admin/')
    console.log(`    3. Log in as ${adminEmail}`)
    if (generatedPassword) {
      console.log('    4. Change your password in Settings -> Profile')
    }
    console.log()

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nSolo seed failed — rolled back.\n', err)
    process.exit(1)
  } finally {
    client.release()
    process.exit(0)
  }
}

seed()
