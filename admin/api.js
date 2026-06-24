/**
 * admin/api.js
 * Admin-only API endpoints for the Data Browser and Test Harness.
 * Mounted at /admin/api by server.js
 *
 * These endpoints are for development and internal tooling only.
 * In production these should be behind authentication.
 */

import { Router }     from 'express'
import { query, getClient } from '../db/postgres.js'
import { getBuffer, sseHandler } from './logger.js'
import { generateUri } from '../core/uri.js'
import { createWorkItem, ValidationError } from '../runtime/workItems.js'
import { getWorkItemHistory } from '../runtime/workItemHistory.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
import { writeFile }  from 'fs/promises'
import { mkdir }      from 'fs/promises'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'
import multer from 'multer'
import {
  listAttachments,
  createFileAttachment,
  createLinkAttachment,
  deleteAttachment,
  getAttachment,
} from '../runtime/attachments.js'
import { getStorage, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB } from '../core/storage/index.js'
import {
  listContextEntries,
  createContextEntry,
  updateContextEntry,
  deleteContextEntry,
  resolveDecisionEntry,
  reopenDecisionEntry,
} from '../runtime/contextEntries.js'
import { listOrgContext, createOrgContext, updateOrgContext, deleteOrgContext } from '../runtime/orgContext.js'
import { assembleContext, formatContextForPrompt } from '../runtime/contextAssembler.js'
import { listPlaybooks, createPlaybook, updatePlaybook, deletePlaybook } from '../runtime/stagePlaybooks.js'
import { listOrgAiModels, createOrgAiModel, updateOrgAiModel, deleteOrgAiModel, resolveModelConfig } from '../runtime/orgAiModels.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
})

const router = Router()

// Compare two values for equality, tolerating JSONB/array/date oddities.
function valuesEqual(a, b) {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Date) return a.toISOString() === new Date(b).toISOString()
  if (b instanceof Date) return new Date(a).toISOString() === b.toISOString()
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => valuesEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return String(a) === String(b)
}

// Allowed raw tables — explicit whitelist for safety
const ALLOWED_TABLES = {
  // blueprint
  'blueprint.organizations':                 'blueprint',
  'blueprint.users':                         'blueprint',
  'blueprint.roles':                         'blueprint',
  'blueprint.org_memberships':               'blueprint',
  'blueprint.work_item_type_classes':        'blueprint',
  'blueprint.work_item_types':               'blueprint',
  'blueprint.work_item_type_fields':         'blueprint',
  'blueprint.service_classes':               'blueprint',
  'blueprint.workflows':                     'blueprint',
  'blueprint.stages':                        'blueprint',
  'blueprint.stage_transitions':             'blueprint',
  'blueprint.exit_criteria':                 'blueprint',
  'blueprint.transition_actions':            'blueprint',
  'blueprint.connections':                   'blueprint',
  'blueprint.business_calendars':            'blueprint',
  'blueprint.visibility_rules':              'blueprint',
  'blueprint.service_catalog_items':         'blueprint',
  'blueprint.org_wip_limits':               'blueprint',
  'blueprint.work_item_class_fields':       'blueprint',
  'blueprint.lookup_lists':                'blueprint',
  'blueprint.lookup_values':               'blueprint',
  // runtime
  'runtime.work_items':                      'runtime',
  'runtime.stage_transition_history':        'runtime',
  'runtime.work_item_user_relationships':    'runtime',
  'runtime.work_item_comments':              'runtime',
  'runtime.evidence':                        'runtime',
  'runtime.notifications':                   'runtime',
  'runtime.flow_metrics_snapshots':          'runtime',
  'runtime.transition_action_log':           'runtime',
  'runtime.work_item_links':                'runtime',
}

// JQL reserved-key validator. Custom field keys must not collide with the
// 28 native JQL identifiers seeded in blueprint.reserved_field_keys.
async function assertNotReservedFieldKey(fieldKey) {
  const r = await query('SELECT 1 FROM blueprint.reserved_field_keys WHERE field_key = $1', [fieldKey])
  if (r.rowCount > 0) {
    const err = new Error(`'${fieldKey}' is a reserved JQL identifier and cannot be used as a custom field key`)
    err.status = 400
    err.code = 'RESERVED_FIELD_KEY'
    err.expose = true
    throw err
  }
}

// =============================================================================
// ORG TYPES
// =============================================================================

router.get('/org-types', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, name, slug, description, sort_order, is_active, created_at
      FROM blueprint.org_types
      ORDER BY sort_order ASC, name ASC
    `)
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/org-types', async (req, res, next) => {
  try {
    const { name, slug, description, sort_order } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    if (!slug?.trim()) return res.status(400).json({ error: 'slug is required' })

    const result = await query(`
      INSERT INTO blueprint.org_types (name, slug, description, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name.trim(), slug.trim().toLowerCase(), description?.trim() || null, sort_order ?? 0])

    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' })
    next(err)
  }
})

router.patch('/org-types/:id', async (req, res, next) => {
  try {
    const { name, slug, description, sort_order, is_active } = req.body
    const result = await query(`
      UPDATE blueprint.org_types
      SET
        name        = COALESCE($1, name),
        slug        = COALESCE($2, slug),
        description = COALESCE($3, description),
        sort_order  = COALESCE($4, sort_order),
        is_active   = COALESCE($5, is_active),
        updated_at  = NOW()
      WHERE id = $6
      RETURNING *
    `, [
      name?.trim() || null,
      slug?.trim().toLowerCase() || null,
      description !== undefined ? (description?.trim() || null) : null,
      sort_order ?? null,
      is_active ?? null,
      req.params.id,
    ])
    if (!result.rows.length) return res.status(404).json({ error: 'Org type not found' })
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' })
    next(err)
  }
})

// =============================================================================
// ROLES
// =============================================================================

router.get('/roles', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        r.id, r.uri, r.name, r.description, r.is_system_default, r.is_active,
        r.org_id, o.name AS org_name, o.slug AS org_slug,
        (
          SELECT json_agg(json_build_object(
            'slug', p.slug, 'name', p.name, 'scope', p.scope, 'granted', rp.granted
          ) ORDER BY p.scope, p.slug)
          FROM blueprint.role_permissions rp
          JOIN blueprint.permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = r.id AND rp.org_id IS NULL
        ) AS permissions
      FROM blueprint.roles r
      JOIN blueprint.organizations o ON o.id = r.org_id
      ORDER BY r.org_id ASC, r.is_system_default DESC, r.name ASC
    `)
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/roles', async (req, res, next) => {
  try {
    const { name, description, org_id } = req.body
    if (!name?.trim())  return res.status(400).json({ error: 'name is required' })
    if (!org_id)        return res.status(400).json({ error: 'org_id is required' })

    const orgCheck = await query('SELECT id, slug FROM blueprint.organizations WHERE id = $1', [org_id])
    if (!orgCheck.rows.length) return res.status(404).json({ error: 'Organization not found' })

    const uri = generateUri(orgCheck.rows[0].slug, 'roles')
    const result = await query(`
      INSERT INTO blueprint.roles (uri, org_id, name, description, is_system_default)
      VALUES ($1, $2, $3, $4, false)
      RETURNING *
    `, [uri, org_id, name.trim(), description?.trim() || null])

    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A role with that name already exists in this org' })
    next(err)
  }
})

router.patch('/roles/:id', async (req, res, next) => {
  try {
    const { name, description, is_active } = req.body
    const result = await query(`
      UPDATE blueprint.roles
      SET name        = COALESCE($1, name),
          description = COALESCE($2, description),
          is_active   = COALESCE($3, is_active),
          updated_at  = NOW()
      WHERE id = $4
      RETURNING *
    `, [name?.trim() || null, description !== undefined ? (description?.trim() || null) : null, is_active ?? null, req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Role not found' })
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A role with that name already exists in this org' })
    next(err)
  }
})

// =============================================================================
// PERMISSIONS
// =============================================================================

router.get('/permissions', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, slug, name, description, scope, category
      FROM blueprint.permissions
      WHERE is_active = true
      ORDER BY scope ASC, category ASC, name ASC
    `)
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// GET /admin/api/role-permissions?role_id=N&org_id=N
// Returns the effective permission set for a role, with override status.
router.get('/role-permissions', async (req, res, next) => {
  try {
    const { role_id, org_id } = req.query
    if (!role_id) return res.status(400).json({ error: 'role_id is required' })

    // Get all permissions with global default and optional org override
    const result = await query(`
      SELECT
        p.id AS permission_id, p.slug, p.name, p.scope, p.category,
        global_rp.granted AS global_granted,
        org_rp.granted    AS org_granted,
        -- Effective: org override wins if it exists
        COALESCE(org_rp.granted, global_rp.granted, false) AS effective_granted,
        (org_rp.id IS NOT NULL) AS has_org_override
      FROM blueprint.permissions p
      LEFT JOIN blueprint.role_permissions global_rp
        ON global_rp.permission_id = p.id
        AND global_rp.role_id = $1
        AND global_rp.org_id IS NULL
      LEFT JOIN blueprint.role_permissions org_rp
        ON org_rp.permission_id = p.id
        AND org_rp.role_id = $1
        AND org_rp.org_id = $2
      WHERE p.is_active = true
      ORDER BY p.scope ASC, p.category ASC, p.name ASC
    `, [role_id, org_id || null])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// PUT /admin/api/role-permissions
// Bulk replace role permissions for a role+org scope.
// Deletes existing rows for that scope then inserts the new set.
// Body: { role_id, org_id (nullable), permissions: [{slug, granted}] }
router.put('/role-permissions', async (req, res, next) => {
  try {
    const { role_id, org_id, permissions: perms } = req.body
    if (!role_id)              return res.status(400).json({ error: 'role_id is required' })
    if (!Array.isArray(perms)) return res.status(400).json({ error: 'permissions array is required' })

    const slugToId = await query('SELECT id, slug FROM blueprint.permissions WHERE is_active = true')
    const permMap  = Object.fromEntries(slugToId.rows.map(r => [r.slug, r.id]))

    // Delete existing entries for this role+org scope, then re-insert
    if (org_id) {
      await query(
        'DELETE FROM blueprint.role_permissions WHERE role_id = $1 AND org_id = $2',
        [role_id, org_id]
      )
    } else {
      await query(
        'DELETE FROM blueprint.role_permissions WHERE role_id = $1 AND org_id IS NULL',
        [role_id]
      )
    }

    let inserted = 0
    for (const { slug, granted } of perms) {
      const permId = permMap[slug]
      if (!permId) continue
      await query(
        'INSERT INTO blueprint.role_permissions (role_id, permission_id, org_id, granted) VALUES ($1, $2, $3, $4)',
        [role_id, permId, org_id || null, granted]
      )
      inserted++
    }

    res.json({ updated: inserted })
  } catch (err) { next(err) }
})

// =============================================================================
// ORGANIZATIONS
// =============================================================================

router.get('/organizations', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        o.id, o.uri, o.slug, o.name, o.org_type,
        o.description, o.parent_id, o.is_active, o.created_at, o.done_retention_days,
        p.name AS parent_name,
        (SELECT COUNT(*) FROM blueprint.org_memberships om WHERE om.org_id = o.id AND om.is_active = true) AS member_count,
        (SELECT COUNT(*) FROM runtime.work_items wi WHERE wi.owner_org_id = o.id) AS work_item_count
      FROM blueprint.organizations o
      LEFT JOIN blueprint.organizations p ON p.id = o.parent_id
      ORDER BY o.id ASC
    `)
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/organizations', async (req, res, next) => {
  try {
    const { name, slug, org_type, parent_id, description } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    if (!slug?.trim()) return res.status(400).json({ error: 'slug is required' })
    if (!org_type)     return res.status(400).json({ error: 'org_type is required' })

    // Validate org_type against lookup table
    const typeCheck = await query('SELECT slug FROM blueprint.org_types WHERE slug = $1 AND is_active = true', [org_type])
    if (!typeCheck.rows.length) return res.status(400).json({ error: `Unknown org_type: ${org_type}` })

    const uri = generateUri(slug.trim().toLowerCase(), 'orgs')
    const result = await query(`
      INSERT INTO blueprint.organizations (uri, slug, name, description, org_type, parent_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [uri, slug.trim().toLowerCase(), name.trim(), description?.trim() || null, org_type, parent_id || null])

    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' })
    next(err)
  }
})

router.patch('/organizations/:id', async (req, res, next) => {
  try {
    const { name, description, org_type, parent_id, is_active, done_retention_days } = req.body
    const fields = []
    const vals   = []
    if (name                !== undefined) { fields.push(`name = $${fields.length + 1}`);                vals.push(name.trim()) }
    if (description         !== undefined) { fields.push(`description = $${fields.length + 1}`);         vals.push(description || null) }
    if (org_type            !== undefined) { fields.push(`org_type = $${fields.length + 1}`);            vals.push(org_type) }
    if (parent_id           !== undefined) { fields.push(`parent_id = $${fields.length + 1}`);           vals.push(parent_id || null) }
    if (is_active           !== undefined) { fields.push(`is_active = $${fields.length + 1}`);           vals.push(is_active === true || is_active === 'true') }
    if (done_retention_days !== undefined) { fields.push(`done_retention_days = $${fields.length + 1}`); vals.push(Math.max(0, parseInt(done_retention_days) || 0)) }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' })
    vals.push(parseInt(req.params.id))
    const result = await query(
      `UPDATE blueprint.organizations SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// =============================================================================
// WORK ITEMS
// =============================================================================

router.get('/work-items', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200)
    const offset = parseInt(req.query.offset) || 0

    const result = await query(`
      SELECT
        wi.id, wi.uri, wi.title,
        wi.spawn_state, wi.current_substate,
        wi.created_at, wi.updated_at, wi.entered_current_stage_at,
        wit.name  AS work_item_type_name,
        s.name    AS current_stage_name,
        s.stage_class AS current_stage_class,
        s.is_terminal AS is_terminal,
        sc.name   AS service_class_name,
        sc.color  AS service_class_color,
        o.name    AS org_name,
        o.slug    AS org_slug,
        wi.field_values,
        wi.pending_missing_fields,
        wi.parent_id
      FROM runtime.work_items wi
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.stages s            ON s.id   = wi.current_stage_id
      JOIN blueprint.organizations o     ON o.id   = wi.owner_org_id
      LEFT JOIN blueprint.service_classes sc ON sc.id = wi.service_class_id
      ORDER BY wi.id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset])

    const countResult = await query('SELECT COUNT(*) FROM runtime.work_items')

    res.json({
      rows:   result.rows,
      count:  result.rowCount,
      total:  parseInt(countResult.rows[0].count),
      limit,
      offset,
    })
  } catch (err) { next(err) }
})

// =============================================================================
// WORKFLOWS WITH STAGES
// =============================================================================

router.get('/workflows', async (req, res, next) => {
  try {
    const workflows = await query(`
      SELECT w.id, w.uri, w.name, w.description, w.version,
             w.is_system_default, w.is_active, w.created_at,
             o.name AS owner_org_name
      FROM blueprint.workflows w
      JOIN blueprint.organizations o ON o.id = w.owner_org_id
      WHERE w.is_active = true
      ORDER BY w.id ASC
    `)

    const stages = await query(`
      SELECT s.*, w.name AS workflow_name,
        (SELECT COUNT(*) FROM blueprint.stage_transitions st WHERE st.from_stage_id = s.id) AS outbound_transitions,
        (SELECT COUNT(*) FROM blueprint.exit_criteria ec WHERE ec.stage_id = s.id AND ec.is_active = true) AS exit_criteria_count
      FROM blueprint.stages s
      JOIN blueprint.workflows w ON w.id = s.workflow_id
      WHERE s.is_active = true
      ORDER BY s.workflow_id ASC, s.display_order ASC
    `)

    const transitions = await query(`
      SELECT st.*,
        fs.name AS from_stage_name,
        ts.name AS to_stage_name
      FROM blueprint.stage_transitions st
      JOIN blueprint.stages fs ON fs.id = st.from_stage_id AND fs.is_active = true
      JOIN blueprint.stages ts ON ts.id = st.to_stage_id AND ts.is_active = true
      ORDER BY st.from_stage_id ASC
    `)

    // Nest stages and transitions under workflows
    const stagesByWorkflow      = {}
    const transitionsByWorkflow = {}

    for (const stage of stages.rows) {
      if (!stagesByWorkflow[stage.workflow_id]) stagesByWorkflow[stage.workflow_id] = []
      stagesByWorkflow[stage.workflow_id].push(stage)
    }

    for (const t of transitions.rows) {
      // Find workflow via from_stage
      const stage = stages.rows.find(s => s.id === t.from_stage_id)
      if (!stage) continue
      if (!transitionsByWorkflow[stage.workflow_id]) transitionsByWorkflow[stage.workflow_id] = []
      transitionsByWorkflow[stage.workflow_id].push(t)
    }

    const result = workflows.rows.map(wf => ({
      ...wf,
      stages:      stagesByWorkflow[wf.id]      || [],
      transitions: transitionsByWorkflow[wf.id] || [],
    }))

    res.json({ rows: result, count: result.length })
  } catch (err) { next(err) }
})

// =============================================================================
// USERS AND MEMBERSHIPS
// =============================================================================

router.get('/users', async (req, res, next) => {
  try {
    const users = await query(`
      SELECT u.id, u.uri, u.email, u.display_name,
             u.is_active, u.is_system, u.created_at
      FROM blueprint.users u
      ORDER BY u.id ASC
    `)

    const memberships = await query(`
      SELECT om.user_id, om.org_id, om.is_active,
             o.name AS org_name, o.slug AS org_slug,
             r.name AS role_name
      FROM blueprint.org_memberships om
      JOIN blueprint.organizations o ON o.id = om.org_id
      JOIN blueprint.roles r         ON r.id = om.role_id
      ORDER BY om.user_id ASC
    `)

    const membershipsByUser = {}
    for (const m of memberships.rows) {
      if (!membershipsByUser[m.user_id]) membershipsByUser[m.user_id] = []
      membershipsByUser[m.user_id].push(m)
    }

    const result = users.rows.map(u => ({
      ...u,
      memberships: membershipsByUser[u.id] || [],
    }))

    res.json({ rows: result, count: result.length })
  } catch (err) { next(err) }
})

router.patch('/users/:id', async (req, res, next) => {
  try {
    const { display_name, email, avatar_url, is_system, is_active } = req.body
    const result = await query(`
      UPDATE blueprint.users
      SET display_name = COALESCE($1, display_name),
          email        = COALESCE($2, email),
          avatar_url   = COALESCE($3, avatar_url),
          is_system    = COALESCE($4, is_system),
          is_active    = COALESCE($5, is_active),
          updated_at   = NOW()
      WHERE id = $6
      RETURNING *
    `, [
      display_name?.trim() || null,
      email?.trim().toLowerCase() || null,
      avatar_url !== undefined ? (avatar_url?.trim() || null) : null,
      is_system ?? null,
      is_active ?? null,
      req.params.id,
    ])
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' })
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' })
    next(err)
  }
})

router.post('/users', async (req, res, next) => {
  try {
    const { email, display_name, avatar_url, is_system, org_id, role_id } = req.body
    if (!email?.trim())        return res.status(400).json({ error: 'email is required' })
    if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' })

    const orgSlug = 'system' // URIs for users always scoped to system in absence of auth
    const uri = generateUri(orgSlug, 'users')

    const userResult = await query(`
      INSERT INTO blueprint.users (uri, email, display_name, avatar_url, is_system)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [uri, email.trim().toLowerCase(), display_name.trim(), avatar_url?.trim() || null, is_system ?? false])

    const user = userResult.rows[0]

    // Optional first membership
    if (org_id && role_id) {
      await query(`
        INSERT INTO blueprint.org_memberships (user_id, org_id, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, org_id) DO NOTHING
      `, [user.id, org_id, role_id])
    }

    res.status(201).json(user)
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' })
    next(err)
  }
})

// =============================================================================
// ORG MEMBERS
// =============================================================================

router.get('/org-members', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })
    const result = await query(`
      SELECT om.id, om.user_id, om.org_id, om.role_id, om.joined_at, om.is_active,
             u.display_name, u.email, u.avatar_url,
             r.name AS role_name
      FROM blueprint.org_memberships om
      JOIN blueprint.users u ON u.id = om.user_id
      JOIN blueprint.roles r ON r.id = om.role_id
      WHERE om.org_id = $1 AND om.is_active = true
      ORDER BY u.display_name ASC
    `, [orgId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/org-members', async (req, res, next) => {
  try {
    const { org_id, user_id, role_id } = req.body
    if (!org_id || !user_id || !role_id) return res.status(400).json({ error: 'org_id, user_id, and role_id are required' })
    const result = await query(`
      INSERT INTO blueprint.org_memberships (user_id, org_id, role_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, org_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true
      RETURNING *
    `, [user_id, org_id, role_id])
    res.status(201).json(result.rows[0])
  } catch (err) { next(err) }
})

router.patch('/org-members/:id', async (req, res, next) => {
  try {
    const { role_id } = req.body
    if (!role_id) return res.status(400).json({ error: 'role_id is required' })
    const result = await query(`
      UPDATE blueprint.org_memberships SET role_id = $1 WHERE id = $2 AND is_active = true RETURNING *
    `, [role_id, req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Membership not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.delete('/org-members/:id', async (req, res, next) => {
  try {
    const result = await query(`
      UPDATE blueprint.org_memberships SET is_active = false WHERE id = $1 RETURNING *
    `, [req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Membership not found' })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// =============================================================================
// ORG WORKFLOWS
// =============================================================================

router.get('/org-workflows', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })
    const [wfResult, stagesResult] = await Promise.all([
      query(`
        SELECT DISTINCT w.id, w.name, w.is_active, w.is_system_default
        FROM blueprint.workflows w
        JOIN blueprint.work_item_type_workflows witw ON witw.workflow_id = w.id AND witw.is_current = true
        JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
        WHERE wit.owner_org_id = $1 AND wit.is_active = true
        ORDER BY w.name ASC
      `, [orgId]),
      query(`
        SELECT s.id, s.name, s.stage_class, s.display_order, s.has_waiting_queue,
               s.is_entry_stage, s.is_terminal, s.workflow_id
        FROM blueprint.stages s
        WHERE s.workflow_id IN (
          SELECT DISTINCT witw.workflow_id
          FROM blueprint.work_item_type_workflows witw
          JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
          WHERE wit.owner_org_id = $1 AND wit.is_active = true AND witw.is_current = true
        )
        AND s.is_active = true AND s.stage_class != 'cancelled'
        ORDER BY s.display_order ASC
      `, [orgId]),
    ])
    // Attach stages to each workflow
    const workflows = wfResult.rows.map(w => ({
      ...w,
      stages: stagesResult.rows.filter(s => s.workflow_id === w.id),
    }))
    res.json({ rows: workflows, count: workflows.length })
  } catch (err) { next(err) }
})

// =============================================================================
// WORK ITEM TYPE CLASSES
// =============================================================================

router.get('/work-item-type-classes', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        c.id, c.uri, c.name, c.description, c.is_system_default, c.is_active,
        c.owner_org_id, o.name AS owner_org_name,
        c.default_workflow_id, w.name AS default_workflow_name,
        (SELECT COUNT(*) FROM blueprint.work_item_types wit WHERE wit.class_id = c.id AND wit.is_active = true) AS type_count
      FROM blueprint.work_item_type_classes c
      JOIN blueprint.organizations o ON o.id = c.owner_org_id
      LEFT JOIN blueprint.workflows w ON w.id = c.default_workflow_id
      ORDER BY c.is_system_default DESC, c.name ASC
    `)
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.patch('/work-item-type-classes/:id', async (req, res, next) => {
  try {
    const { name, description, is_active, default_workflow_id } = req.body
    const result = await query(`
      UPDATE blueprint.work_item_type_classes
      SET name                = COALESCE($1, name),
          description         = COALESCE($2, description),
          is_active           = COALESCE($3, is_active),
          default_workflow_id = $4,
          updated_at          = NOW()
      WHERE id = $5
      RETURNING *
    `, [
      name?.trim() || null,
      description !== undefined ? (description?.trim() || null) : null,
      is_active ?? null,
      default_workflow_id !== undefined ? (default_workflow_id || null) : undefined,
      req.params.id,
    ])
    if (!result.rows.length) return res.status(404).json({ error: 'Class not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.post('/work-item-type-classes', async (req, res, next) => {
  try {
    const { name, description, owner_org_id, default_workflow_id } = req.body
    if (!name?.trim())   return res.status(400).json({ error: 'name is required' })
    if (!owner_org_id)   return res.status(400).json({ error: 'owner_org_id is required' })

    const orgCheck = await query('SELECT slug FROM blueprint.organizations WHERE id = $1', [owner_org_id])
    if (!orgCheck.rows.length) return res.status(404).json({ error: 'Organization not found' })

    const uri = generateUri(orgCheck.rows[0].slug, 'work-item-type-classes')
    const result = await query(`
      INSERT INTO blueprint.work_item_type_classes (uri, name, description, owner_org_id, is_system_default, default_workflow_id)
      VALUES ($1, $2, $3, $4, false, $5)
      RETURNING *
    `, [uri, name.trim(), description?.trim() || null, owner_org_id, default_workflow_id || null])

    res.status(201).json(result.rows[0])
  } catch (err) { next(err) }
})

// =============================================================================
// WORK ITEM TYPES
// =============================================================================

router.get('/work-item-types', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        wit.id, wit.uri, wit.name, wit.description, wit.version,
        wit.request_mode, wit.is_published, wit.is_system_default, wit.is_active,
        wit.icon, wit.color, wit.key_prefix,
        wit.class_id, c.name AS class_name, c.default_workflow_id AS class_default_workflow_id,
        wit.owner_org_id, o.name AS owner_org_name, o.slug AS owner_org_slug,
        witw.workflow_id, w.name AS workflow_name
      FROM blueprint.work_item_types wit
      JOIN blueprint.work_item_type_classes c ON c.id = wit.class_id
      JOIN blueprint.organizations o ON o.id = wit.owner_org_id
      LEFT JOIN blueprint.work_item_type_workflows witw ON witw.work_item_type_id = wit.id AND witw.is_current = true
      LEFT JOIN blueprint.workflows w ON w.id = witw.workflow_id
      ORDER BY o.name ASC, wit.name ASC
    `)
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.patch('/work-item-types/:id', async (req, res, next) => {
  try {
    const { name, description, request_mode, icon, color, is_published, is_active, key_prefix, workflow_id } = req.body
    const result = await query(`
      UPDATE blueprint.work_item_types
      SET name         = COALESCE($1, name),
          description  = COALESCE($2, description),
          request_mode = COALESCE($3, request_mode),
          icon         = COALESCE($4, icon),
          color        = COALESCE($5, color),
          is_published = COALESCE($6, is_published),
          is_active    = COALESCE($7, is_active),
          key_prefix   = COALESCE($8, key_prefix),
          updated_at   = NOW()
      WHERE id = $9
      RETURNING *
    `, [
      name?.trim() || null,
      description !== undefined ? (description?.trim() || null) : null,
      request_mode || null,
      icon !== undefined ? (icon?.trim() || null) : null,
      color !== undefined ? (color?.trim() || null) : null,
      is_published ?? null,
      is_active ?? null,
      key_prefix !== undefined ? (key_prefix?.trim().toUpperCase() || null) : null,
      req.params.id,
    ])
    if (!result.rows.length) return res.status(404).json({ error: 'Work item type not found' })

    // Update workflow assignment if provided
    if (workflow_id !== undefined) {
      const wfId = workflow_id ? parseInt(workflow_id) : null
      if (wfId) {
        // Deactivate existing, insert new as current
        await query('UPDATE blueprint.work_item_type_workflows SET is_current = false WHERE work_item_type_id = $1', [req.params.id])
        await query(`
          INSERT INTO blueprint.work_item_type_workflows (work_item_type_id, workflow_id, is_current)
          VALUES ($1, $2, true)
          ON CONFLICT (work_item_type_id, workflow_id) DO UPDATE SET is_current = true
        `, [req.params.id, wfId])
      } else {
        // Clear workflow
        await query('UPDATE blueprint.work_item_type_workflows SET is_current = false WHERE work_item_type_id = $1', [req.params.id])
      }
    }

    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.post('/work-item-types', async (req, res, next) => {
  try {
    const { name, description, class_id, owner_org_id, request_mode, icon, color, is_published, key_prefix } = req.body
    if (!name?.trim())   return res.status(400).json({ error: 'name is required' })
    if (!class_id)       return res.status(400).json({ error: 'class_id is required' })
    if (!owner_org_id)   return res.status(400).json({ error: 'owner_org_id is required' })

    const orgCheck = await query('SELECT slug FROM blueprint.organizations WHERE id = $1', [owner_org_id])
    if (!orgCheck.rows.length) return res.status(404).json({ error: 'Organization not found' })

    const classCheck = await query('SELECT id, default_workflow_id FROM blueprint.work_item_type_classes WHERE id = $1', [class_id])
    if (!classCheck.rows.length) return res.status(404).json({ error: 'Work item type class not found' })

    const client = await getClient()
    let witRow
    try {
      await client.query('BEGIN')

      const uri = generateUri(orgCheck.rows[0].slug, 'work-item-types')
      const result = await client.query(`
        INSERT INTO blueprint.work_item_types
          (uri, name, description, class_id, owner_org_id, request_mode, icon, color, is_published, is_system_default, key_prefix)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10)
        RETURNING *
      `, [
        uri, name.trim(), description?.trim() || null,
        class_id, owner_org_id,
        request_mode || 'user_requestable',
        icon?.trim() || null,
        color?.trim() || null,
        is_published ?? false,
        key_prefix?.trim().toUpperCase() || null,
      ])
      witRow = result.rows[0]

      // Auto-link class default workflow if available
      const defaultWorkflowId = classCheck.rows[0].default_workflow_id
      if (defaultWorkflowId) {
        await client.query(`
          INSERT INTO blueprint.work_item_type_workflows (work_item_type_id, workflow_id, is_current)
          VALUES ($1, $2, true)
          ON CONFLICT DO NOTHING
        `, [witRow.id, defaultWorkflowId])
      }

      // Copy class fields to type fields (including custom field engine columns)
      const classFields = await client.query(`
        SELECT field_key, field_label, field_type, field_options, field_group,
               is_required, display_order, lookup_list_id, constraints, default_value
        FROM blueprint.work_item_class_fields
        WHERE class_id = $1 AND is_active = true
        ORDER BY display_order ASC
      `, [class_id])

      for (const f of classFields.rows) {
        await client.query(`
          INSERT INTO blueprint.work_item_type_fields
            (work_item_type_id, field_key, field_label, field_type, field_options, field_group,
             is_required, display_order, is_active, inherited_from_class_id,
             lookup_list_id, constraints, default_value)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12)
          ON CONFLICT DO NOTHING
        `, [witRow.id, f.field_key, f.field_label, f.field_type, f.field_options, f.field_group,
            f.is_required, f.display_order, class_id,
            f.lookup_list_id, f.constraints ? JSON.stringify(f.constraints) : null,
            f.default_value !== null ? JSON.stringify(f.default_value) : null])
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.status(201).json(witRow)
  } catch (err) { next(err) }
})

// =============================================================================
// TRANSITION HISTORY
// =============================================================================

router.get('/transition-history', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0

    const result = await query(`
      SELECT
        sth.id, sth.work_item_id,
        wi.title       AS work_item_title,
        wi.uri         AS work_item_uri,
        fs.name        AS from_stage_name,
        fs.stage_class AS from_stage_class,
        ts.name        AS to_stage_name,
        ts.stage_class AS to_stage_class,
        sth.entered_from_stage_at,
        sth.exited_from_stage_at,
        sth.time_in_stage_seconds,
        sth.working_time_in_stage_seconds,
        sth.transition_reason,
        sth.was_automated,
        sth.created_at,
        u.display_name AS transitioned_by
      FROM runtime.stage_transition_history sth
      JOIN runtime.work_items wi ON wi.id   = sth.work_item_id
      JOIN blueprint.stages   fs ON fs.id   = sth.from_stage_id
      JOIN blueprint.stages   ts ON ts.id   = sth.to_stage_id
      LEFT JOIN blueprint.users u ON u.id   = sth.transitioned_by_user_id
      ORDER BY sth.id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset])

    const countResult = await query('SELECT COUNT(*) FROM runtime.stage_transition_history')

    res.json({
      rows:   result.rows,
      count:  result.rowCount,
      total:  parseInt(countResult.rows[0].count),
      limit,
      offset,
    })
  } catch (err) { next(err) }
})

// =============================================================================
// RAW TABLE BROWSER
// =============================================================================

router.get('/tables', async (req, res, next) => {
  try {
    res.json({ tables: Object.keys(ALLOWED_TABLES) })
  } catch (err) { next(err) }
})

router.get('/tables/:schema/:table', async (req, res, next) => {
  try {
    const tableName = `${req.params.schema}.${req.params.table}`
    if (!ALLOWED_TABLES[tableName]) {
      return res.status(403).json({ error: `Table "${tableName}" is not accessible` })
    }

    const limit  = Math.min(parseInt(req.query.limit) || 50, 500)
    const offset = parseInt(req.query.offset) || 0

    const result      = await query(`SELECT * FROM ${tableName} ORDER BY id ASC LIMIT $1 OFFSET $2`, [limit, offset])
    const countResult = await query(`SELECT COUNT(*) FROM ${tableName}`)

    res.json({
      table:   tableName,
      columns: result.fields.map(f => f.name),
      rows:    result.rows,
      count:   result.rowCount,
      total:   parseInt(countResult.rows[0].count),
      limit,
      offset,
    })
  } catch (err) { next(err) }
})

// =============================================================================
// SYSTEM SUMMARY (dashboard)
// =============================================================================

router.get('/summary', async (req, res, next) => {
  try {
    const [orgs, users, workItems, workflows, transitions, queueDepth] = await Promise.all([
      query('SELECT COUNT(*) FROM blueprint.organizations WHERE is_active = true'),
      query('SELECT COUNT(*) FROM blueprint.users WHERE is_active = true'),
      query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE spawn_state = 'active')  AS active,
        COUNT(*) FILTER (WHERE spawn_state = 'pending') AS pending,
        COUNT(*) FILTER (WHERE spawn_state = 'done')    AS done,
        COUNT(*) FILTER (WHERE spawn_state = 'cancelled') AS cancelled
        FROM runtime.work_items`),
      query('SELECT COUNT(*) FROM blueprint.workflows WHERE is_active = true'),
      query('SELECT COUNT(*) FROM runtime.stage_transition_history'),
      query("SELECT COUNT(*) FROM runtime.search_index_queue WHERE status = 'pending'"),
    ])

    res.json({
      orgs:        parseInt(orgs.rows[0].count),
      users:       parseInt(users.rows[0].count),
      work_items:  workItems.rows[0],
      workflows:   parseInt(workflows.rows[0].count),
      transitions: parseInt(transitions.rows[0].count),
      sync_queue_depth: parseInt(queueDepth.rows[0].count),
    })
  } catch (err) { next(err) }
})

// =============================================================================
// LOG VIEWER
// =============================================================================

// GET /admin/api/logs — return buffer snapshot
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500)
  const buf   = getBuffer()
  res.json({ entries: buf.slice(-limit), total: buf.length })
})

// GET /admin/api/logs/stream — SSE live stream
router.get('/logs/stream', sseHandler)

// =============================================================================
// DB CONSOLE
// =============================================================================

// Allowed statement prefixes — read-only only
const ALLOWED_PREFIXES = ['select', 'explain', 'with']

router.post('/query', async (req, res, next) => {
  try {
    const sql = (req.body.sql || '').trim()
    if (!sql) return res.status(400).json({ error: 'sql is required' })

    const first = sql.toLowerCase().split(/\s+/)[0]
    if (!ALLOWED_PREFIXES.includes(first)) {
      return res.status(403).json({
        error: `Only ${ALLOWED_PREFIXES.join(', ')} statements are allowed`,
      })
    }

    // Only append LIMIT if the query doesn't already have one
    const alreadyLimited = /\bLIMIT\b/i.test(sql)
    const safeSql = alreadyLimited
      ? sql.replace(/;+$/, '')
      : sql.replace(/;+$/, '') + '\nLIMIT 500'

    const start  = Date.now()
    const result = await query(safeSql)
    const ms     = Date.now() - start

    res.json({
      columns:  result.fields.map(f => ({ name: f.name, type: f.dataTypeID })),
      rows:     result.rows,
      count:    result.rowCount,
      duration_ms: ms,
    })
  } catch (err) {
    // Return DB errors as 422 so the console can display them nicely
    res.status(422).json({ error: err.message })
  }
})

// =============================================================================
// EDIT — whitelisted field updates for admin browser
// =============================================================================

// Defines exactly which fields are editable per entity type
const EDIT_RULES = {
  'work_item': {
    table:           'runtime.work_items',
    allowed_fields:  ['title', 'description', 'field_values'],
    field_types:     { title: 'text', description: 'text', field_values: 'json' },
    id_column:       'id',
  },
  'organization': {
    table:           'blueprint.organizations',
    allowed_fields:  ['name', 'is_active'],
    field_types:     { name: 'text', is_active: 'boolean' },
    id_column:       'id',
  },
}

/**
 * PATCH /admin/api/edit/:entityType/:id
 * Update whitelisted fields on a single record.
 * Body: { field: value, ... }
 */
router.patch('/edit/:entityType/:id', async (req, res, next) => {
  try {
    const { entityType, id } = req.params
    const rules = EDIT_RULES[entityType]

    if (!rules) {
      return res.status(403).json({
        error: `Entity type "${entityType}" is not editable`,
        allowed: Object.keys(EDIT_RULES),
      })
    }

    const updates = req.body
    if (!updates || !Object.keys(updates).length) {
      return res.status(400).json({ error: 'No fields provided' })
    }

    // Filter to only allowed fields
    const safeUpdates = {}
    const rejected    = []
    for (const [field, value] of Object.entries(updates)) {
      if (rules.allowed_fields.includes(field)) {
        safeUpdates[field] = value
      } else {
        rejected.push(field)
      }
    }

    if (rejected.length) {
      return res.status(403).json({
        error:    `Fields not editable: ${rejected.join(', ')}`,
        allowed:  rules.allowed_fields,
      })
    }

    if (!Object.keys(safeUpdates).length) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    // Validate types
    for (const [field, value] of Object.entries(safeUpdates)) {
      const expectedType = rules.field_types[field]
      if (expectedType === 'boolean' && typeof value !== 'boolean') {
        return res.status(400).json({ error: `Field "${field}" must be a boolean` })
      }
      if (expectedType === 'text' && typeof value !== 'string') {
        return res.status(400).json({ error: `Field "${field}" must be a string` })
      }
      if (expectedType === 'json' && typeof value !== 'object') {
        return res.status(400).json({ error: `Field "${field}" must be an object` })
      }
    }

    // Build parameterized UPDATE
    const fields   = Object.keys(safeUpdates)
    const values   = fields.map(f =>
      rules.field_types[f] === 'json'
        ? JSON.stringify(safeUpdates[f])
        : safeUpdates[f]
    )
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ')
    values.push(new Date()) // updated_at
    values.push(id)         // WHERE id = $N

    const sql = `
      UPDATE ${rules.table}
      SET ${setClauses}, updated_at = $${fields.length + 1}
      WHERE ${rules.id_column} = $${fields.length + 2}
      RETURNING *
    `

    const result = await query(sql, values)
    if (!result.rows.length) {
      return res.status(404).json({ error: `${entityType} ${id} not found` })
    }

    res.json({ updated: result.rows[0], fields_changed: fields })
  } catch (err) { next(err) }
})

// =============================================================================
// UPLOADS
// =============================================================================

// POST /admin/api/upload/avatar
// Body: { data: "data:image/...;base64,...", filename: "original.jpg" }
// Returns: { url: "/uploads/avatars/<uuid>.<ext>" }
router.post('/upload/avatar', async (req, res, next) => {
  try {
    const { data, filename } = req.body
    if (!data) return res.status(400).json({ error: 'data is required' })

    // Parse data URL: "data:<mime>;base64,<bytes>"
    const match = data.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return res.status(400).json({ error: 'data must be a base64 data URL' })

    const mime     = match[1]
    const bytes    = Buffer.from(match[2], 'base64')
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedMimes.includes(mime)) {
      return res.status(400).json({ error: `Unsupported image type: ${mime}` })
    }
    if (bytes.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image must be under 2 MB' })
    }

    // Determine extension
    const mimeToExt = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }
    const ext = mimeToExt[mime] || extname(filename || '.jpg') || '.jpg'

    const avatarsDir = join(__dirname, '../public/uploads/avatars')
    await mkdir(avatarsDir, { recursive: true })

    const fname = `${randomUUID()}${ext}`
    await writeFile(join(avatarsDir, fname), bytes)

    res.json({ url: `/uploads/avatars/${fname}` })
  } catch (err) { next(err) }
})

// =============================================================================
// WORKFLOW MANAGER
// =============================================================================

// GET /admin/api/workflows/:id — single workflow with full stage+transition detail
router.get('/workflows/:id', async (req, res, next) => {
  try {
    const wfResult = await query(
      'SELECT id, uri, name, description, version, is_system_default, is_active, owner_org_id FROM blueprint.workflows WHERE id = $1',
      [req.params.id]
    )
    if (!wfResult.rows.length) return res.status(404).json({ error: 'Workflow not found' })
    const wf = wfResult.rows[0]

    const [stagesResult, transResult] = await Promise.all([
      query(`
        SELECT id, name, stage_class, stage_type, stage_function, display_order,
               is_entry_stage, is_terminal, counts_toward_throughput,
               sla_hours, wip_limit, has_waiting_queue, is_active
        FROM blueprint.stages
        WHERE workflow_id = $1 AND is_active = true
        ORDER BY display_order ASC
      `, [req.params.id]),
      query(`
        SELECT id, from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason
        FROM blueprint.stage_transitions
        WHERE from_stage_id IN (
          SELECT id FROM blueprint.stages WHERE workflow_id = $1 AND is_active = true
        )
      `, [req.params.id]),
    ])

    // Attach from_stage_ids and to_stage_ids to each stage
    const stages = stagesResult.rows.map(stage => ({
      ...stage,
      from_stage_ids: transResult.rows
        .filter(t => t.to_stage_id === stage.id)
        .map(t => t.from_stage_id),
      to_stage_ids: transResult.rows
        .filter(t => t.from_stage_id === stage.id)
        .map(t => t.to_stage_id),
    }))

    res.json({ workflow: wf, stages, transitions: transResult.rows })
  } catch (err) { next(err) }
})

// POST /admin/api/workflows — create workflow with default stages
router.post('/workflows', async (req, res, next) => {
  try {
    const { name, description, owner_org_id } = req.body
    if (!name?.trim())   return res.status(400).json({ error: 'name is required' })

    if (!owner_org_id) return res.status(400).json({ error: 'owner_org_id is required' })
    const resolvedOrgId = owner_org_id

    const orgResult = await query('SELECT slug FROM blueprint.organizations WHERE id = $1', [resolvedOrgId])
    if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' })

    const uri = generateUri(orgResult.rows[0].slug, 'workflows')

    const client = await getClient()
    let workflow
    try {
      await client.query('BEGIN')

      const wfResult = await client.query(`
        INSERT INTO blueprint.workflows (uri, name, description, owner_org_id, version, is_system_default, is_active)
        VALUES ($1, $2, $3, $4, '1.0.0', false, true)
        RETURNING *
      `, [uri, name.trim(), description?.trim() || null, resolvedOrgId])
      workflow = wfResult.rows[0]

      // Create default stages: Intake, In Progress, Done, Cancelled
      const defaultStages = [
        { name: 'Intake',      stage_class: 'intake',      stage_type: 'waiting', stage_function: 'queue',   display_order: 1, is_entry_stage: true,  is_terminal: false, counts_toward_throughput: true },
        { name: 'In Progress', stage_class: 'in-progress', stage_type: 'working', stage_function: 'action',  display_order: 2, is_entry_stage: false, is_terminal: false, counts_toward_throughput: true },
        { name: 'Done',        stage_class: 'done',        stage_type: 'waiting', stage_function: 'deliver', display_order: 3, is_entry_stage: false, is_terminal: true,  counts_toward_throughput: true },
        { name: 'Cancelled',   stage_class: 'cancelled',   stage_type: 'waiting', stage_function: 'deliver', display_order: 4, is_entry_stage: false, is_terminal: true,  counts_toward_throughput: false },
      ]

      const stageIds = {}
      for (const s of defaultStages) {
        const sUri = generateUri(orgResult.rows[0].slug, 'stages')
        const sResult = await client.query(`
          INSERT INTO blueprint.stages
            (uri, workflow_id, name, stage_class, stage_type, stage_function,
             display_order, is_entry_stage, is_terminal, counts_toward_throughput, is_active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
          RETURNING id
        `, [sUri, workflow.id, s.name, s.stage_class, s.stage_type, s.stage_function,
            s.display_order, s.is_entry_stage, s.is_terminal, s.counts_toward_throughput])
        stageIds[s.name] = sResult.rows[0].id
      }

      // Default transitions
      const defaultTransitions = [
        { from: 'Intake', to: 'In Progress', label: 'Start', kind: 'forward' },
        { from: 'In Progress', to: 'Done', label: 'Complete', kind: 'forward' },
        { from: 'In Progress', to: 'Intake', label: 'Put Back', kind: 'backward' },
        { from: 'Intake', to: 'Cancelled', label: 'Cancel', kind: 'forward', requires_reason: true },
        { from: 'In Progress', to: 'Cancelled', label: 'Cancel', kind: 'forward', requires_reason: true },
      ]

      for (const t of defaultTransitions) {
        await client.query(`
          INSERT INTO blueprint.stage_transitions
            (from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason)
          VALUES ($1,$2,$3,$4,$5)
        `, [stageIds[t.from], stageIds[t.to], t.label, t.kind, t.requires_reason ?? false])
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.status(201).json(workflow)
  } catch (err) { next(err) }
})

// PATCH /admin/api/workflows/:id — update workflow metadata
router.patch('/workflows/:id', async (req, res, next) => {
  try {
    const { name, description, is_active } = req.body
    const result = await query(`
      UPDATE blueprint.workflows
      SET name        = COALESCE($1, name),
          description = COALESCE($2, description),
          is_active   = COALESCE($3, is_active),
          updated_at  = NOW()
      WHERE id = $4
      RETURNING *
    `, [name?.trim() || null, description !== undefined ? (description?.trim() || null) : null, is_active ?? null, req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Workflow not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// POST /admin/api/stages — add a stage to a workflow
router.post('/stages', async (req, res, next) => {
  try {
    const { workflow_id, name, stage_class, stage_type, stage_function,
            display_order, is_entry_stage, is_terminal, counts_toward_throughput,
            sla_hours, wip_limit } = req.body
    if (!workflow_id)  return res.status(400).json({ error: 'workflow_id is required' })
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    const wfResult = await query(
      'SELECT w.id, o.slug FROM blueprint.workflows w JOIN blueprint.organizations o ON o.id = w.owner_org_id WHERE w.id = $1',
      [workflow_id]
    )
    if (!wfResult.rows.length) return res.status(404).json({ error: 'Workflow not found' })

    const uri = generateUri(wfResult.rows[0].slug, 'stages')
    const result = await query(`
      INSERT INTO blueprint.stages
        (uri, workflow_id, name, stage_class, stage_type, stage_function,
         display_order, is_entry_stage, is_terminal, counts_toward_throughput,
         sla_hours, wip_limit, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
      RETURNING *
    `, [
      uri, workflow_id, name.trim(),
      stage_class || 'queued', stage_type || 'waiting', stage_function || null,
      display_order ?? 99, is_entry_stage ?? false, is_terminal ?? false,
      counts_toward_throughput ?? true,
      sla_hours || null, wip_limit || null,
    ])
    res.status(201).json(result.rows[0])
  } catch (err) { next(err) }
})

// PATCH /admin/api/stages/:id — update stage + sync transitions
router.patch('/stages/:id', async (req, res, next) => {
  try {
    const {
      name, stage_class, stage_type, stage_function,
      display_order, is_entry_stage, is_terminal, counts_toward_throughput,
      sla_hours, wip_limit, has_waiting_queue,
      from_stage_ids,   // array of stage IDs that can transition TO this stage
      to_stage_ids,     // array of stage IDs that this stage can transition TO
    } = req.body
    const stageId = parseInt(req.params.id)

    // Fetch current stage for org slug (for URI generation)
    const stageResult = await query(
      'SELECT s.*, w.owner_org_id, o.slug FROM blueprint.stages s JOIN blueprint.workflows w ON w.id = s.workflow_id JOIN blueprint.organizations o ON o.id = w.owner_org_id WHERE s.id = $1',
      [stageId]
    )
    if (!stageResult.rows.length) return res.status(404).json({ error: 'Stage not found' })

    const client = await getClient()
    let updatedStage
    try {
      await client.query('BEGIN')

      const updateResult = await client.query(`
        UPDATE blueprint.stages SET
          name                     = COALESCE($1, name),
          stage_class              = COALESCE($2, stage_class),
          stage_type               = COALESCE($3, stage_type),
          stage_function           = COALESCE($4, stage_function),
          display_order            = COALESCE($5, display_order),
          is_entry_stage           = COALESCE($6, is_entry_stage),
          is_terminal              = COALESCE($7, is_terminal),
          counts_toward_throughput = COALESCE($8, counts_toward_throughput),
          sla_hours                = $9,
          wip_limit                = $10,
          has_waiting_queue        = COALESCE($11, has_waiting_queue),
          updated_at               = NOW()
        WHERE id = $12
        RETURNING *
      `, [
        name?.trim() || null,
        stage_class || null,
        stage_type || null,
        stage_function !== undefined ? (stage_function || null) : null,
        display_order ?? null,
        is_entry_stage ?? null,
        is_terminal ?? null,
        counts_toward_throughput ?? null,
        sla_hours !== undefined ? (sla_hours || null) : undefined,
        wip_limit !== undefined ? (wip_limit || null) : undefined,
        has_waiting_queue ?? null,
        stageId,
      ])
      updatedStage = updateResult.rows[0]

      // Sync inbound transitions (from_stage_ids)
      if (Array.isArray(from_stage_ids)) {
        await client.query('DELETE FROM blueprint.stage_transitions WHERE to_stage_id = $1', [stageId])
        for (const fromId of from_stage_ids) {
          await client.query(`
            INSERT INTO blueprint.stage_transitions (from_stage_id, to_stage_id, transition_kind)
            VALUES ($1, $2, 'forward')
            ON CONFLICT DO NOTHING
          `, [fromId, stageId])
        }
      }

      // Sync outbound transitions (to_stage_ids)
      if (Array.isArray(to_stage_ids)) {
        await client.query('DELETE FROM blueprint.stage_transitions WHERE from_stage_id = $1', [stageId])
        for (const toId of to_stage_ids) {
          await client.query(`
            INSERT INTO blueprint.stage_transitions (from_stage_id, to_stage_id, transition_kind)
            VALUES ($1, $2, 'forward')
            ON CONFLICT DO NOTHING
          `, [stageId, toId])
        }
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.json(updatedStage)
  } catch (err) { next(err) }
})

// DELETE /admin/api/stages/:id — deactivate stage and remove its transitions
router.delete('/stages/:id', async (req, res, next) => {
  try {
    const stageId = req.params.id
    // Remove transitions to/from this stage first
    await query(
      'DELETE FROM blueprint.stage_transitions WHERE from_stage_id = $1 OR to_stage_id = $1',
      [stageId]
    )
    // Soft-delete the stage
    const result = await query(
      'UPDATE blueprint.stages SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [stageId]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Stage not found' })
    res.json({ deleted: result.rows[0].id })
  } catch (err) { next(err) }
})

// POST /admin/api/workflows/:id/clone — duplicate a workflow with all stages and transitions
router.post('/workflows/:id/clone', async (req, res, next) => {
  try {
    const sourceId = parseInt(req.params.id)
    const { name, owner_org_id } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    // Load source workflow
    const wfResult = await query(
      'SELECT * FROM blueprint.workflows WHERE id = $1', [sourceId]
    )
    if (!wfResult.rows.length) return res.status(404).json({ error: 'Source workflow not found' })
    const source = wfResult.rows[0]

    const targetOrgId = owner_org_id ? parseInt(owner_org_id) : source.owner_org_id
    const orgResult = await query('SELECT slug FROM blueprint.organizations WHERE id = $1', [targetOrgId])
    if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' })
    const orgSlug = orgResult.rows[0].slug

    // Load source stages and transitions
    const [stagesResult, transResult] = await Promise.all([
      query('SELECT * FROM blueprint.stages WHERE workflow_id = $1 AND is_active = true ORDER BY display_order', [sourceId]),
      query(`SELECT * FROM blueprint.stage_transitions WHERE from_stage_id IN (
        SELECT id FROM blueprint.stages WHERE workflow_id = $1 AND is_active = true
      )`, [sourceId]),
    ])

    const client = await getClient()
    try {
      await client.query('BEGIN')

      // Create new workflow
      const wfUri = generateUri(orgSlug, 'workflows')
      const newWf = await client.query(`
        INSERT INTO blueprint.workflows (uri, name, description, owner_org_id, version, is_system_default, is_active)
        VALUES ($1, $2, $3, $4, '1.0.0', false, true)
        RETURNING *
      `, [wfUri, name.trim(), source.description, targetOrgId])
      const workflow = newWf.rows[0]

      // Clone stages, building old→new ID map
      const stageMap = {}
      for (const s of stagesResult.rows) {
        const sUri = generateUri(orgSlug, 'stages')
        const ns = await client.query(`
          INSERT INTO blueprint.stages
            (uri, workflow_id, name, stage_class, stage_type, stage_function,
             display_order, is_entry_stage, is_terminal, counts_toward_throughput,
             sla_hours, wip_limit, has_waiting_queue, is_active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
          RETURNING *
        `, [sUri, workflow.id, s.name, s.stage_class, s.stage_type, s.stage_function,
            s.display_order, s.is_entry_stage, s.is_terminal, s.counts_toward_throughput,
            s.sla_hours, s.wip_limit, s.has_waiting_queue])
        stageMap[s.id] = ns.rows[0].id
      }

      // Clone transitions
      for (const t of transResult.rows) {
        const fromId = stageMap[t.from_stage_id]
        const toId = stageMap[t.to_stage_id]
        if (!fromId || !toId) continue
        await client.query(`
          INSERT INTO blueprint.stage_transitions
            (from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason)
          VALUES ($1, $2, $3, $4, $5)
        `, [fromId, toId, t.transition_label, t.transition_kind, t.requires_reason])
      }

      await client.query('COMMIT')
      res.status(201).json(workflow)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) { next(err) }
})

// PUT /admin/api/workflows/:id/stages/reorder — update display_order for all stages
router.put('/workflows/:id/stages/reorder', async (req, res, next) => {
  try {
    const workflowId = parseInt(req.params.id)
    const { order } = req.body  // [{ id, display_order }]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array is required' })

    const client = await getClient()
    try {
      await client.query('BEGIN')
      for (const { id, display_order } of order) {
        await client.query(
          'UPDATE blueprint.stages SET display_order = $1, updated_at = NOW() WHERE id = $2 AND workflow_id = $3',
          [display_order, id, workflowId]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// =============================================================================
// BOARD
// =============================================================================

router.get('/service-classes', async (req, res, next) => {
  try {
    const orgId = req.query.org_id ? parseInt(req.query.org_id) : null
    const result = await query(`
      SELECT id, name, color, icon, priority_order, can_bypass_wip
      FROM blueprint.service_classes
      WHERE is_active = true AND ($1::int IS NULL OR org_id = $1)
      ORDER BY priority_order ASC
    `, [orgId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.get('/service-library', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })
    const result = await query(`
      SELECT wit.id, wit.name, wit.description, wit.icon, wit.color,
             wit.request_mode, wit.is_system_default, wit.key_prefix, wit.is_active,
             c.name AS class_name, wit.owner_org_id, o.name AS owner_org_name,
             cw.workflow_id AS current_workflow_id, w.name AS current_workflow_name
      FROM blueprint.work_item_types wit
      JOIN blueprint.work_item_type_classes c ON c.id = wit.class_id
      JOIN blueprint.organizations o          ON o.id = wit.owner_org_id
      LEFT JOIN blueprint.work_item_type_workflows cw ON cw.work_item_type_id = wit.id AND cw.is_current = true
      LEFT JOIN blueprint.workflows w ON w.id = cw.workflow_id
      WHERE wit.owner_org_id = $1 AND wit.is_active = true
      ORDER BY c.name ASC, wit.name ASC
    `, [orgId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.get('/board', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })

    // Resolve org (include done_retention_days for completed item visibility)
    const orgResult = await query(
      'SELECT id, name, slug, done_retention_days FROM blueprint.organizations WHERE id = $1 AND is_active = true',
      [orgId]
    )
    if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' })
    const org = orgResult.rows[0]
    const retentionDays = org.done_retention_days ?? 14

    // Run items, stages, service classes, and org WIP limits in parallel
    const currentUserId = req.userId ?? null
    const [itemsResult, stagesResult, scResult, wipResult] = await Promise.all([
      query(`
        SELECT wi.id, wi.uri, wi.title, wi.spawn_state, wi.current_stage_id, wi.workflow_id,
               wi.entered_current_stage_at, wi.created_at, wi.updated_at, wi.display_key,
               wi.service_class_id, wi.description, wi.current_substate,
               wi.due_date, wi.is_expedited, wi.work_nature,
               wi.priority, wi.tags, wi.estimate, wi.estimate_unit, wi.started_at, wi.resolved_at, wi.origin,
               wit.name AS work_item_type_name, wit.icon AS work_item_type_icon, wit.color AS work_item_type_color,
               s.name AS current_stage_name, s.stage_class AS current_stage_class,
               CASE
                 WHEN wi.is_expedited = true THEN 'expedite'
                 WHEN wi.due_date IS NOT NULL THEN 'fixed_date'
                 WHEN wi.work_nature = 'improvement' THEN 'deferred'
                 ELSE 'standard'
               END AS derived_service_class,
               owner_rel.user_id AS owner_user_id,
               owner_user.display_name AS owner_display_name,
               COALESCE((
                 SELECT COUNT(*)::int FROM runtime.notifications n
                 WHERE n.user_id = $3 AND n.work_item_id = wi.id AND n.read_at IS NULL
               ), 0) AS unread_count
        FROM runtime.work_items wi
        JOIN blueprint.work_item_types wit     ON wit.id = wi.work_item_type_id
        JOIN blueprint.stages s                ON s.id   = wi.current_stage_id
        LEFT JOIN LATERAL (
          SELECT r.user_id FROM runtime.work_item_user_relationships r
          WHERE r.work_item_id = wi.id AND r.relationship_type = 'owns' AND r.is_active = true
          ORDER BY r.assigned_at ASC LIMIT 1
        ) owner_rel ON true
        LEFT JOIN blueprint.users owner_user ON owner_user.id = owner_rel.user_id
        WHERE wi.owner_org_id = $1
          AND s.stage_class != 'cancelled'
          AND (
            wi.spawn_state = 'active'
            OR (wi.spawn_state = 'done' AND wi.resolved_at > NOW() - make_interval(days => $2))
          )
        ORDER BY wi.entered_current_stage_at ASC
      `, [orgId, retentionDays, currentUserId]),
      // Fetch real stages from workflows that have active items in this org
      // PLUS stages from all workflows assigned to org's work item types (always-show)
      // Include workflows from recently-completed items too
      query(`
        SELECT DISTINCT s.id, s.name, s.stage_class, s.display_order,
               s.has_waiting_queue, s.is_entry_stage, s.is_terminal,
               s.workflow_id, w.name AS workflow_name
        FROM blueprint.stages s
        JOIN blueprint.workflows w ON w.id = s.workflow_id
        WHERE s.workflow_id IN (
          SELECT DISTINCT wi.workflow_id FROM runtime.work_items wi
          WHERE wi.owner_org_id = $1
            AND (wi.spawn_state = 'active'
              OR (wi.spawn_state = 'done' AND wi.resolved_at > NOW() - make_interval(days => $2)))
          UNION
          SELECT DISTINCT wtw.workflow_id FROM blueprint.work_item_type_workflows wtw
          JOIN blueprint.work_item_types wit ON wit.id = wtw.work_item_type_id
          WHERE wit.owner_org_id = $1 AND wit.is_active = true
        )
        AND s.is_active = true AND s.stage_class != 'cancelled'
        ORDER BY s.display_order ASC
      `, [orgId, retentionDays]),
      query(`
        SELECT id, name, color, icon, priority_order
        FROM blueprint.service_classes
        WHERE org_id = $1 AND is_active = true
        ORDER BY priority_order ASC
      `, [orgId]),
      query(`
        SELECT stage_name, wip_limit, enforcement_type
        FROM blueprint.org_wip_limits
        WHERE org_id = $1
      `, [orgId]),
    ])

    // Build 3-level column hierarchy:
    // L1: stage_class groups, L2: merged stages (same name+class), L3: waiting queue split
    const STAGE_CLASS_ORDER = ['intake', 'triage', 'queued', 'in-progress', 'blocked', 'review', 'approved', 'delivery', 'done']
    const STAGE_CLASS_LABELS = {
      'intake': 'Intake', 'triage': 'Triage', 'queued': 'Ready',
      'in-progress': 'In Progress', 'blocked': 'Blocked', 'review': 'Review',
      'approved': 'Approved', 'delivery': 'Delivery', 'done': 'Done',
    }

    // Merge stages by (stage_class, name) — collect IDs and workflow_ids
    const mergeMap = new Map() // key: "stage_class:name" → merged stage obj
    for (const s of stagesResult.rows) {
      const key = `${s.stage_class}:${s.name}`
      if (mergeMap.has(key)) {
        const existing = mergeMap.get(key)
        existing.stage_ids.push(s.id)
        if (!existing.workflow_ids.includes(s.workflow_id)) existing.workflow_ids.push(s.workflow_id)
      } else {
        mergeMap.set(key, {
          key,
          name: s.name,
          stage_class: s.stage_class,
          stage_ids: [s.id],
          workflow_ids: [s.workflow_id],
          has_waiting_queue: s.has_waiting_queue,
          display_order: s.display_order,
          is_entry_stage: s.is_entry_stage,
          is_terminal: s.is_terminal,
        })
      }
    }

    // Group merged stages by stage_class, ordered by STAGE_CLASS_ORDER
    const classGroups = new Map()
    for (const merged of mergeMap.values()) {
      if (!classGroups.has(merged.stage_class)) classGroups.set(merged.stage_class, [])
      classGroups.get(merged.stage_class).push(merged)
    }

    // Sort stages within each class group by display_order
    for (const stages of classGroups.values()) {
      stages.sort((a, b) => a.display_order - b.display_order)
    }

    // Ensure at least intake, in-progress, done classes exist
    for (const cls of ['intake', 'in-progress', 'done']) {
      if (!classGroups.has(cls)) {
        classGroups.set(cls, [{
          key: `${cls}:${STAGE_CLASS_LABELS[cls]}`,
          name: STAGE_CLASS_LABELS[cls],
          stage_class: cls,
          stage_ids: [],
          has_waiting_queue: false,
          display_order: STAGE_CLASS_ORDER.indexOf(cls),
          is_entry_stage: cls === 'intake',
          is_terminal: cls === 'done',
        }])
      }
    }

    // Build ordered columns array
    const columns = STAGE_CLASS_ORDER
      .filter(cls => classGroups.has(cls))
      .map(cls => ({
        stage_class: cls,
        class_label: STAGE_CLASS_LABELS[cls] || cls,
        stages: classGroups.get(cls),
      }))

    // Compute owner initials (items keep their real current_stage_id)
    for (const item of itemsResult.rows) {
      if (item.owner_display_name) {
        const parts = item.owner_display_name.trim().split(/\s+/)
        item.owner_initial = parts.map(p => p[0]).join('').toUpperCase().slice(0, 2)
      } else {
        item.owner_initial = null
      }
    }

    // Build WIP limits map keyed by stage_name
    const wipLimits = {}
    for (const row of wipResult.rows) {
      wipLimits[row.stage_name] = { wip_limit: row.wip_limit, enforcement_type: row.enforcement_type }
    }

    res.json({
      org,
      columns,
      items:           itemsResult.rows,
      service_classes: scResult.rows,
      wip_limits:      wipLimits,
    })
  } catch (err) { next(err) }
})

router.post('/work-items', async (req, res, next) => {
  try {
    const { title, work_item_type_id, owner_org_id, service_class_id, description,
            due_date, is_expedited, work_nature, priority, tags, estimate, estimate_unit, origin, requester_id } = req.body
    if (!title?.trim())       return res.status(400).json({ error: 'title is required' })
    if (!work_item_type_id)   return res.status(400).json({ error: 'work_item_type_id is required' })
    if (!owner_org_id)        return res.status(400).json({ error: 'owner_org_id is required' })

    const workItem = await createWorkItem({
      title:              title.trim(),
      work_item_type_id:  parseInt(work_item_type_id),
      owner_org_id:       parseInt(owner_org_id),
      service_class_id:   service_class_id ? parseInt(service_class_id) : undefined,
      description:        description?.trim() || undefined,
      due_date:           due_date || undefined,
      is_expedited:       !!is_expedited,
      work_nature:        work_nature || 'delivery',
      priority:           priority != null ? parseInt(priority) : undefined,
      tags:               tags || undefined,
      estimate:           estimate != null ? parseFloat(estimate) : undefined,
      estimate_unit:      estimate_unit || undefined,
      origin:             origin || 'manual',
      requester_id:       requester_id ? parseInt(requester_id) : undefined,
    }, req.userId)

    res.status(201).json(workItem)
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message })
    next(err)
  }
})

/**
 * GET /admin/api/edit/rules
 * Returns the edit rules so the UI knows what's editable.
 */
router.get('/edit/rules', (_req, res) => {
  const rules = {}
  for (const [type, r] of Object.entries(EDIT_RULES)) {
    rules[type] = { allowed_fields: r.allowed_fields, field_types: r.field_types }
  }
  res.json(rules)
})

// =============================================================================
// CLASS FIELDS CRUD
// =============================================================================

router.get('/class-fields', async (req, res, next) => {
  try {
    const classId = parseInt(req.query.class_id)
    if (!classId) return res.status(400).json({ error: 'class_id is required' })
    const result = await query(`
      SELECT * FROM blueprint.work_item_class_fields
      WHERE class_id = $1 AND is_active = true
      ORDER BY display_order ASC, id ASC
    `, [classId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/class-fields', async (req, res, next) => {
  try {
    const { class_id, field_key, field_label, field_type, field_options, field_group,
            is_required, display_order, lookup_list_id, constraints, default_value } = req.body
    if (!class_id)            return res.status(400).json({ error: 'class_id is required' })
    if (!field_key?.trim())   return res.status(400).json({ error: 'field_key is required' })
    if (!field_label?.trim()) return res.status(400).json({ error: 'field_label is required' })
    if (!field_type?.trim())  return res.status(400).json({ error: 'field_type is required' })
    await assertNotReservedFieldKey(field_key.trim())
    const result = await query(`
      INSERT INTO blueprint.work_item_class_fields
        (class_id, field_key, field_label, field_type, field_options, field_group,
         is_required, display_order, lookup_list_id, constraints, default_value)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [class_id, field_key.trim(), field_label.trim(), field_type.trim(),
        field_options ? JSON.stringify(field_options) : null,
        field_group?.trim() || null, is_required ?? false, display_order ?? 0,
        lookup_list_id || null,
        constraints ? JSON.stringify(constraints) : null,
        default_value !== undefined ? JSON.stringify(default_value) : null])
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === 'RESERVED_FIELD_KEY') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === '23505') return res.status(409).json({ error: 'Field key already exists for this class' })
    next(err)
  }
})

router.patch('/class-fields/:id', async (req, res, next) => {
  try {
    const { field_label, field_options, field_group, is_required, display_order, is_active,
            lookup_list_id, constraints, default_value } = req.body
    // Note: field_type is immutable after creation — not accepted here
    const result = await query(`
      UPDATE blueprint.work_item_class_fields
      SET field_label    = COALESCE($1, field_label),
          field_options  = COALESCE($2, field_options),
          field_group    = COALESCE($3, field_group),
          is_required    = COALESCE($4, is_required),
          display_order  = COALESCE($5, display_order),
          is_active      = COALESCE($6, is_active),
          lookup_list_id = COALESCE($7, lookup_list_id),
          constraints    = COALESCE($8, constraints),
          default_value  = COALESCE($9, default_value),
          updated_at     = NOW()
      WHERE id = $10
      RETURNING *
    `, [
      field_label?.trim() || null,
      field_options ? JSON.stringify(field_options) : null,
      field_group !== undefined ? (field_group?.trim() || null) : null,
      is_required ?? null, display_order ?? null, is_active ?? null,
      lookup_list_id ?? null,
      constraints ? JSON.stringify(constraints) : null,
      default_value !== undefined ? JSON.stringify(default_value) : null,
      req.params.id,
    ])
    if (!result.rows.length) return res.status(404).json({ error: 'Class field not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.delete('/class-fields/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM blueprint.work_item_class_fields WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Class field not found' })
    res.json({ deleted: result.rows[0].id })
  } catch (err) { next(err) }
})

// =============================================================================
// TYPE FIELDS CRUD
// =============================================================================

router.get('/type-fields', async (req, res, next) => {
  try {
    const typeId = parseInt(req.query.type_id)
    if (!typeId) return res.status(400).json({ error: 'type_id is required' })
    const result = await query(`
      SELECT * FROM blueprint.work_item_type_fields
      WHERE work_item_type_id = $1 AND is_active = true
      ORDER BY display_order ASC, id ASC
    `, [typeId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/type-fields', async (req, res, next) => {
  try {
    const { work_item_type_id, field_key, field_label, field_type, field_options, field_group,
            is_required, display_order, lookup_list_id, constraints, default_value } = req.body
    if (!work_item_type_id)   return res.status(400).json({ error: 'work_item_type_id is required' })
    if (!field_key?.trim())   return res.status(400).json({ error: 'field_key is required' })
    if (!field_label?.trim()) return res.status(400).json({ error: 'field_label is required' })
    if (!field_type?.trim())  return res.status(400).json({ error: 'field_type is required' })
    await assertNotReservedFieldKey(field_key.trim())
    const result = await query(`
      INSERT INTO blueprint.work_item_type_fields
        (work_item_type_id, field_key, field_label, field_type, field_options, field_group,
         is_required, display_order, lookup_list_id, constraints, default_value)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [work_item_type_id, field_key.trim(), field_label.trim(), field_type.trim(),
        field_options ? JSON.stringify(field_options) : null,
        field_group?.trim() || null, is_required ?? false, display_order ?? 0,
        lookup_list_id || null,
        constraints ? JSON.stringify(constraints) : null,
        default_value !== undefined ? JSON.stringify(default_value) : null])
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === 'RESERVED_FIELD_KEY') return res.status(400).json({ error: err.message, code: err.code })
    if (err.code === '23505') return res.status(409).json({ error: 'Field key already exists for this type' })
    next(err)
  }
})

router.patch('/type-fields/:id', async (req, res, next) => {
  try {
    const { field_label, field_options, field_group, is_required, display_order, is_active,
            lookup_list_id, constraints, default_value } = req.body
    // field_type is immutable after creation
    const result = await query(`
      UPDATE blueprint.work_item_type_fields
      SET field_label    = COALESCE($1, field_label),
          field_options  = COALESCE($2, field_options),
          field_group    = COALESCE($3, field_group),
          is_required    = COALESCE($4, is_required),
          display_order  = COALESCE($5, display_order),
          is_active      = COALESCE($6, is_active),
          lookup_list_id = COALESCE($7, lookup_list_id),
          constraints    = COALESCE($8, constraints),
          default_value  = COALESCE($9, default_value),
          updated_at     = NOW()
      WHERE id = $10
      RETURNING *
    `, [
      field_label?.trim() || null,
      field_options ? JSON.stringify(field_options) : null,
      field_group !== undefined ? (field_group?.trim() || null) : null,
      is_required ?? null, display_order ?? null, is_active ?? null,
      lookup_list_id ?? null,
      constraints ? JSON.stringify(constraints) : null,
      default_value !== undefined ? JSON.stringify(default_value) : null,
      req.params.id,
    ])
    if (!result.rows.length) return res.status(404).json({ error: 'Type field not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.delete('/type-fields/:id', async (req, res, next) => {
  try {
    // Soft-delete: deactivate instead of hard delete (field may have values in work items)
    const result = await query(
      'UPDATE blueprint.work_item_type_fields SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Type field not found' })
    res.json({ deactivated: result.rows[0].id })
  } catch (err) { next(err) }
})

// =============================================================================
// ORG WIP LIMITS
// =============================================================================

router.get('/org-wip-limits', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })
    const result = await query(`
      SELECT * FROM blueprint.org_wip_limits
      WHERE org_id = $1
      ORDER BY stage_name ASC
    `, [orgId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.put('/org-wip-limits', async (req, res, next) => {
  try {
    const { org_id, stage_name, wip_limit, enforcement_type } = req.body
    if (!org_id)           return res.status(400).json({ error: 'org_id is required' })
    if (!stage_name?.trim()) return res.status(400).json({ error: 'stage_name is required' })

    // wip_limit of 0 or null = clear the limit
    if (!wip_limit || wip_limit < 1) {
      await query(
        'DELETE FROM blueprint.org_wip_limits WHERE org_id = $1 AND stage_name = $2',
        [org_id, stage_name.trim()]
      )
      return res.json({ cleared: true, stage_name: stage_name.trim() })
    }

    const result = await query(`
      INSERT INTO blueprint.org_wip_limits (org_id, stage_name, wip_limit, enforcement_type)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (org_id, stage_name) DO UPDATE SET
        wip_limit        = EXCLUDED.wip_limit,
        enforcement_type = EXCLUDED.enforcement_type,
        updated_at       = NOW()
      RETURNING *
    `, [org_id, stage_name.trim(), wip_limit, enforcement_type || 'soft'])
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.delete('/org-wip-limits/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM blueprint.org_wip_limits WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'WIP limit not found' })
    res.json({ deleted: result.rows[0].id })
  } catch (err) { next(err) }
})

// =============================================================================
// WORK ITEM DETAIL + ACTIONS
// =============================================================================

import { prepareTransition, executeTransition } from '../runtime/transitions.js'
import { buildFieldCatalog } from '../runtime/search/fieldCatalog.js'
import { translate as nlTranslate } from '../runtime/search/translate.js'

function buildPrefixTsquery(text) {
  const tokens = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (tokens.length === 0) return null
  return tokens.map(t => t + ':*').join(' & ')
}

// Build the per-request user search context: userId, accessible orgIds, isAdmin.
// Used by all /search* and /saved-filters* routes.
async function getUserSearchContext(req) {
  if (!req.userId) {
    const err = new Error('not authenticated'); err.status = 401; err.expose = true
    throw err
  }
  const userRes = await query(
    'SELECT id, email, is_admin, display_name FROM blueprint.users WHERE id = $1',
    [req.userId]
  )
  if (userRes.rowCount === 0) {
    const err = new Error('user not found'); err.status = 401; err.expose = true
    throw err
  }
  const user = userRes.rows[0]
  const memb = await query(
    'SELECT org_id FROM blueprint.org_memberships WHERE user_id = $1 AND is_active = true',
    [req.userId]
  )
  const orgIds = memb.rows.map(r => r.org_id)
  return { user, userId: user.id, orgIds, isAdmin: !!user.is_admin }
}

function canEditFilter(filter, ctx) {
  if (filter.owner_user_id === ctx.userId) return true
  if (filter.share_scope === 'global' && ctx.isAdmin) return true
  // Org admin would require role-permission lookup; deferred until role model wired up.
  return false
}

function canViewFilter(filter, ctx) {
  if (filter.owner_user_id === ctx.userId) return true
  if (filter.share_scope === 'global') return true
  if (filter.share_scope === 'org' && ctx.orgIds.includes(filter.owner_org_id)) return true
  return false
}

// GET /admin/api/work-items/:id — full detail
router.get('/work-items/:id', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        wi.id, wi.uri, wi.title, wi.description,
        wi.spawn_state, wi.current_substate, wi.display_key, wi.sequence_number,
        wi.field_values, wi.pending_missing_fields,
        wi.parent_id, wi.created_at, wi.updated_at, wi.entered_current_stage_at,
        wi.current_stage_id, wi.workflow_id, wi.service_class_id,
        wi.due_date, wi.is_expedited, wi.work_nature,
        wi.priority, wi.tags, wi.estimate, wi.estimate_unit, wi.started_at, wi.resolved_at, wi.origin, wi.requester_id,
        wi.acceptance_criteria, wi.work_item_type_id,
        wit.name AS work_item_type_name, wit.icon AS work_item_type_icon, wit.color AS work_item_type_color,
        wit.key_prefix,
        s.name AS current_stage_name, s.stage_class AS current_stage_class, s.is_terminal,
        o.name AS org_name, o.slug AS org_slug, o.id AS owner_org_id,
        CASE
          WHEN wi.is_expedited = true THEN 'expedite'
          WHEN wi.due_date IS NOT NULL THEN 'fixed_date'
          WHEN wi.work_nature = 'improvement' THEN 'deferred'
          ELSE 'standard'
        END AS derived_service_class
      FROM runtime.work_items wi
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      JOIN blueprint.organizations o ON o.id = wi.owner_org_id
      WHERE wi.id = $1
    `, [req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Work item not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// PATCH /admin/api/work-items/:id — update title, description, field_values
router.patch('/work-items/:id', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  if (!workItemId) return res.status(400).json({ error: 'Invalid id' })

  const { title, description, field_values, due_date, is_expedited, work_nature,
          priority, tags, estimate, estimate_unit, origin, requester_id } = req.body

  // Map request fields -> (column, type, incoming value)
  const UPDATABLE = [
    { field: 'title',         type: 'text',     col: 'title',         incoming: title,         transform: v => v?.trim() },
    { field: 'description',   type: 'textarea', col: 'description',   incoming: description,   transform: v => v || null },
    { field: 'field_values',  type: 'jsonb',    col: 'field_values',  incoming: field_values,  transform: v => v,           isJson: true },
    { field: 'due_date',      type: 'date',     col: 'due_date',      incoming: due_date,      transform: v => v || null },
    { field: 'is_expedited',  type: 'boolean',  col: 'is_expedited',  incoming: is_expedited,  transform: v => !!v },
    { field: 'work_nature',   type: 'text',     col: 'work_nature',   incoming: work_nature,   transform: v => v },
    { field: 'priority',      type: 'number',   col: 'priority',      incoming: priority,      transform: v => v != null ? parseInt(v) : null },
    { field: 'tags',          type: 'text[]',   col: 'tags',          incoming: tags,          transform: v => v || [] },
    { field: 'estimate',      type: 'number',   col: 'estimate',      incoming: estimate,      transform: v => v != null ? parseFloat(v) : null },
    { field: 'estimate_unit', type: 'text',     col: 'estimate_unit', incoming: estimate_unit, transform: v => v },
    { field: 'origin',        type: 'text',     col: 'origin',        incoming: origin,        transform: v => v },
    { field: 'requester_id',  type: 'number',   col: 'requester_id',  incoming: requester_id,  transform: v => v ? parseInt(v) : null },
  ]

  const provided = UPDATABLE.filter(u => u.incoming !== undefined)
  if (!provided.length) return res.status(400).json({ error: 'No fields to update' })

  const client = await getClient()
  try {
    await client.query('BEGIN')

    // 1. Load current values for only the columns being updated
    const selectCols = provided.map(u => u.col).join(', ')
    const { rows: beforeRows } = await client.query(
      `SELECT id, uri, ${selectCols} FROM runtime.work_items WHERE id = $1 FOR UPDATE`,
      [workItemId]
    )
    if (!beforeRows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }
    const before = beforeRows[0]

    // 2. Compute diff — only fields whose value actually changed
    const changes = []
    const setFragments = []
    const vals = []
    for (const u of provided) {
      const newVal = u.transform(u.incoming)
      const oldVal = before[u.col]
      if (valuesEqual(oldVal, newVal)) continue
      changes.push({ field: u.field, type: u.type, old: oldVal, new: newVal })
      setFragments.push(`${u.col} = $${vals.length + 1}`)
      vals.push(u.isJson ? JSON.stringify(newVal) : newVal)
    }

    if (!changes.length) {
      // No-op update — rollback and do not emit
      await client.query('ROLLBACK')
      const { rows: current } = await query('SELECT * FROM runtime.work_items WHERE id = $1', [workItemId])
      return res.json(current[0])
    }

    // 3. Apply the update
    setFragments.push('updated_at = NOW()')
    vals.push(workItemId)
    const { rows: updated } = await client.query(
      `UPDATE runtime.work_items SET ${setFragments.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )

    // 4. Emit the edit event (in-tx)
    const editGroupId = randomUUID()
    await emitEvent(client, {
      eventType: 'work_item.edited',
      entityId:  workItemId,
      entityUri: before.uri,
      actorId:   req.userId ?? null,
      payload: {
        edit_group_id: editGroupId,
        changes,
        current: updated[0],
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json(updated[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})

// POST /admin/api/work-items/:id/substate — update substate
router.post('/work-items/:id/substate', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  const { substate } = req.body
  if (!['active', 'blocked', 'waiting'].includes(substate)) {
    return res.status(400).json({ error: 'substate must be "active", "blocked", or "waiting"' })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: before } = await client.query(
      'SELECT current_substate, uri FROM runtime.work_items WHERE id = $1 FOR UPDATE',
      [workItemId]
    )
    if (!before.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    const oldSubstate = before[0].current_substate
    if (oldSubstate === substate) {
      await client.query('ROLLBACK')
      const { rows } = await query('SELECT * FROM runtime.work_items WHERE id = $1', [workItemId])
      return res.json(rows[0])
    }

    const { rows: updated } = await client.query(`
      UPDATE runtime.work_items
      SET current_substate = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [substate, workItemId])

    await emitEvent(client, {
      eventType: 'work_item.substate_changed',
      entityId:  workItemId,
      entityUri: before[0].uri,
      actorId:   req.userId ?? null,
      payload:   { old_substate: oldSubstate, new_substate: substate },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json(updated[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})

// GET /admin/api/work-items/:id/transitions — available transitions
router.get('/work-items/:id/transitions', async (req, res, next) => {
  try {
    const wi = await query('SELECT current_stage_id FROM runtime.work_items WHERE id = $1', [req.params.id])
    if (!wi.rows.length) return res.status(404).json({ error: 'Work item not found' })
    const result = await query(`
      SELECT st.id, st.to_stage_id, st.transition_label, st.transition_kind, st.requires_reason,
             ts.name AS to_stage_name, ts.stage_class AS to_stage_class, ts.is_terminal
      FROM blueprint.stage_transitions st
      JOIN blueprint.stages ts ON ts.id = st.to_stage_id
      WHERE st.from_stage_id = $1 AND st.is_active = true AND ts.is_active = true
      ORDER BY ts.display_order ASC
    `, [wi.rows[0].current_stage_id])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// GET /admin/api/work-items/:id/transition/prepare?to_stage_id=N — prepare transition (evaluate criteria)
router.get('/work-items/:id/transition/prepare', async (req, res, next) => {
  try {
    const toStageId = parseInt(req.query.to_stage_id)
    if (!toStageId) return res.status(400).json({ error: 'to_stage_id query parameter is required' })
    const prep = await prepareTransition(parseInt(req.params.id), toStageId, req.userId)
    res.json(prep)
  } catch (err) { next(err) }
})

// POST /admin/api/work-items/:id/transition — execute transition
router.post('/work-items/:id/transition', async (req, res, next) => {
  try {
    const { to_stage_id, reason } = req.body
    if (!to_stage_id) return res.status(400).json({ error: 'to_stage_id is required' })
    const result = await executeTransition(
      parseInt(req.params.id),
      parseInt(to_stage_id),
      req.userId,
      { reason }
    )
    if (!result.success) return res.status(422).json({ error: result.error, details: result.details })
    res.json(result)
  } catch (err) { next(err) }
})

// =============================================================================
// BULK OPERATIONS
// =============================================================================

// POST /admin/api/work-items/bulk/transition
// Body: { work_item_ids: number[], to_stage_id: number, reason?: string }
// Processes items sequentially so WIP limits are evaluated correctly after each commit.
router.post('/work-items/bulk/transition', async (req, res, next) => {
  try {
    const { work_item_ids, to_stage_id, reason } = req.body
    if (!Array.isArray(work_item_ids) || work_item_ids.length === 0)
      return res.status(400).json({ error: 'work_item_ids array is required' })
    if (!to_stage_id)
      return res.status(400).json({ error: 'to_stage_id is required' })

    const results = []
    for (const id of work_item_ids) {
      try {
        const result = await executeTransition(parseInt(id), parseInt(to_stage_id), req.userId, { reason })
        if (result.success) {
          results.push({ id, success: true })
          nudgeAfterCommit()
        } else {
          results.push({ id, success: false, error: result.error })
        }
      } catch (err) {
        results.push({ id, success: false, error: err.message || 'Unexpected error' })
      }
    }
    res.json({
      results,
      succeeded_count: results.filter(r => r.success).length,
      failed_count:    results.filter(r => !r.success).length,
    })
  } catch (err) { next(err) }
})

// POST /admin/api/work-items/bulk/assign
// Body: { work_item_ids: number[], user_id: number, relationship_type: string }
router.post('/work-items/bulk/assign', async (req, res, next) => {
  try {
    const { work_item_ids, user_id, relationship_type } = req.body
    if (!Array.isArray(work_item_ids) || work_item_ids.length === 0)
      return res.status(400).json({ error: 'work_item_ids array is required' })
    if (!user_id)           return res.status(400).json({ error: 'user_id is required' })
    if (!relationship_type) return res.status(400).json({ error: 'relationship_type is required' })

    const { rows: userRow } = await query('SELECT uri FROM blueprint.users WHERE id = $1', [user_id])
    if (!userRow.length) return res.status(404).json({ error: 'User not found' })

    const results = []
    for (const id of work_item_ids) {
      const client = await getClient()
      try {
        await client.query('BEGIN')
        const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [parseInt(id)])
        if (!wi.length) {
          await client.query('ROLLBACK')
          results.push({ id, success: false, error: 'Work item not found' })
          continue
        }
        await client.query(`
          INSERT INTO runtime.work_item_user_relationships (work_item_id, user_id, relationship_type, assigned_at, is_active)
          VALUES ($1, $2, $3, NOW(), true)
          ON CONFLICT (work_item_id, user_id, relationship_type) DO NOTHING
        `, [parseInt(id), user_id, relationship_type])
        await emitEvent(client, {
          eventType: 'work_item.assigned',
          entityId:  parseInt(id),
          entityUri: wi[0].uri,
          actorId:   req.userId ?? null,
          payload:   { user_id, user_uri: userRow[0].uri, work_item_uri: wi[0].uri, relationship_type },
        })
        await client.query('COMMIT')
        nudgeAfterCommit()
        results.push({ id, success: true })
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        results.push({ id, success: false, error: err.message || 'Unexpected error' })
      } finally {
        client.release()
      }
    }
    res.json({
      results,
      succeeded_count: results.filter(r => r.success).length,
      failed_count:    results.filter(r => !r.success).length,
    })
  } catch (err) { next(err) }
})

// =============================================================================
// EXIT CRITERIA — RUNTIME STATUS
// =============================================================================

import {
  acknowledgeCriterion,
  unacknowledgeCriterion,
  waiveCriterion,
  getWorkItemCriteriaStatus,
} from '../runtime/exitCriteria.js'

// GET /admin/api/work-items/:id/exit-criteria — current criteria status for work item
router.get('/work-items/:id/exit-criteria-status', async (req, res, next) => {
  try {
    const criteria = await getWorkItemCriteriaStatus(parseInt(req.params.id))
    res.json({ rows: criteria, count: criteria.length })
  } catch (err) { next(err) }
})

// POST /admin/api/work-items/:id/exit-criteria/:criteriaId/acknowledge
router.post('/work-items/:id/exit-criteria/:criteriaId/acknowledge', async (req, res, next) => {
  try {
    const result = await acknowledgeCriterion(
      parseInt(req.params.id),
      parseInt(req.params.criteriaId),
      req.userId
    )
    res.json(result)
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('Only manual')) {
      return res.status(400).json({ error: err.message })
    }
    next(err)
  }
})

// DELETE /admin/api/work-items/:id/exit-criteria/:criteriaId/acknowledge — undo
router.delete('/work-items/:id/exit-criteria/:criteriaId/acknowledge', async (req, res, next) => {
  try {
    const result = await unacknowledgeCriterion(
      parseInt(req.params.id),
      parseInt(req.params.criteriaId),
      req.userId
    )
    if (!result) return res.status(404).json({ error: 'Status record not found' })
    res.json(result)
  } catch (err) { next(err) }
})

// POST /admin/api/work-items/:id/exit-criteria/:criteriaId/waive
router.post('/work-items/:id/exit-criteria/:criteriaId/waive', async (req, res, next) => {
  try {
    const { reason } = req.body
    const result = await waiveCriterion(
      parseInt(req.params.id),
      parseInt(req.params.criteriaId),
      req.userId,
      reason
    )
    res.json(result)
  } catch (err) {
    if (err.message.includes('reason is required')) {
      return res.status(400).json({ error: err.message })
    }
    next(err)
  }
})

// =============================================================================
// COMMENTS
// =============================================================================

router.get('/work-items/:id/comments', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.id, c.body, c.parent_comment_id, c.is_system_generated, c.is_edited,
             c.created_at, c.updated_at, c.author_user_id,
             u.display_name AS author_name, u.avatar_url AS author_avatar
      FROM runtime.work_item_comments c
      LEFT JOIN blueprint.users u ON u.id = c.author_user_id
      WHERE c.work_item_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// GET /admin/api/work-items/:id/history — unified audit trail
router.get('/work-items/:id/history', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id)
    if (!workItemId) return res.status(400).json({ error: 'invalid work item id' })
    const { rows: wi } = await query('SELECT id FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wi.length) return res.status(404).json({ error: 'Work item not found' })
    const result = await getWorkItemHistory(workItemId, {
      limit: req.query.limit,
      before: req.query.before,
    })
    res.json(result)
  } catch (err) { next(err) }
})

router.post('/work-items/:id/comments', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  const { body, parent_comment_id } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' })

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wi.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    const uri = generateUri('system', 'comments')
    const { rows: comment } = await client.query(`
      INSERT INTO runtime.work_item_comments (uri, work_item_id, author_user_id, body, parent_comment_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [uri, workItemId, req.userId, body.trim(), parent_comment_id || null])

    await client.query('UPDATE runtime.work_items SET updated_at = NOW() WHERE id = $1', [workItemId])

    await emitEvent(client, {
      eventType: 'work_item.commented',
      entityId:  workItemId,
      entityUri: wi[0].uri,
      actorId:   req.userId ?? null,
      payload: {
        comment_id:        comment[0].id,
        comment_uri:       uri,
        parent_comment_id: parent_comment_id || null,
        body:              body.trim(),
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.status(201).json(comment[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})

// PATCH /admin/api/work-items/:id/comments/:commentId — edit a comment
router.patch('/work-items/:id/comments/:commentId', async (req, res, next) => {
  const workItemId  = parseInt(req.params.id)
  const commentId   = parseInt(req.params.commentId)
  const { body } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' })

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wi.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Work item not found' }) }

    const { rows: existing } = await client.query(
      'SELECT id, author_user_id, body FROM runtime.work_item_comments WHERE id = $1 AND work_item_id = $2',
      [commentId, workItemId]
    )
    if (!existing.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Comment not found' }) }
    if (existing[0].author_user_id !== req.userId && !req.isAdmin)
      { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Only the author or an admin can edit this comment' }) }

    const { rows: updated } = await client.query(
      `UPDATE runtime.work_item_comments SET body = $1, is_edited = true, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [body.trim(), commentId]
    )
    await emitEvent(client, {
      eventType: 'work_item.comment_edited',
      entityId:  workItemId,
      entityUri: wi[0].uri,
      actorId:   req.userId ?? null,
      payload: { comment_id: commentId, new_body: body.trim(), old_body: existing[0].body },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json(updated[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally { client.release() }
})

// DELETE /admin/api/work-items/:id/comments/:commentId — delete a comment
router.delete('/work-items/:id/comments/:commentId', async (req, res, next) => {
  const workItemId  = parseInt(req.params.id)
  const commentId   = parseInt(req.params.commentId)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wi.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Work item not found' }) }

    const { rows: existing } = await client.query(
      'SELECT id, author_user_id, body FROM runtime.work_item_comments WHERE id = $1 AND work_item_id = $2',
      [commentId, workItemId]
    )
    if (!existing.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Comment not found' }) }
    if (existing[0].author_user_id !== req.userId && !req.isAdmin)
      { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Only the author or an admin can delete this comment' }) }

    await client.query('DELETE FROM runtime.work_item_comments WHERE parent_comment_id = $1', [commentId])
    await client.query('DELETE FROM runtime.work_item_comments WHERE id = $1', [commentId])
    await emitEvent(client, {
      eventType: 'work_item.comment_deleted',
      entityId:  workItemId,
      entityUri: wi[0].uri,
      actorId:   req.userId ?? null,
      payload: { comment_id: commentId, body: existing[0].body },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json({ deleted: true, id: commentId })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally { client.release() }
})

// =============================================================================
// ATTACHMENTS
// =============================================================================

router.get('/work-items/:id/attachments', async (req, res, next) => {
  try {
    const workItemId = Number(req.params.id)
    if (!Number.isInteger(workItemId)) return res.status(400).json({ error: 'invalid work item id' })
    const rows = await listAttachments(workItemId)
    res.json({ attachments: rows })
  } catch (err) { next(err) }
})

router.post('/work-items/:id/attachments',
  (req, res, next) => {
    // Route by Content-Type: multipart = file, json = link.
    const ct = req.headers['content-type'] || ''
    if (ct.startsWith('multipart/form-data')) {
      attachmentUpload.single('file')(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `file exceeds ${MAX_ATTACHMENT_MB} MB limit` })
        }
        if (err) return next(err)
        next()
      })
    } else {
      next()
    }
  },
  async (req, res, next) => {
    try {
      const workItemId = Number(req.params.id)
      if (!Number.isInteger(workItemId)) return res.status(400).json({ error: 'invalid work item id' })

      const userId = req.userId

      // Verify work item exists.
      const wi = await query(`SELECT id FROM runtime.work_items WHERE id = $1`, [workItemId])
      if (wi.rowCount === 0) return res.status(404).json({ error: 'work item not found' })

      if (req.file) {
        const row = await createFileAttachment({
          workItemId,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          buffer: req.file.buffer,
          userId,
        })
        return res.status(201).json({ attachment: row })
      }

      // Link path
      const { url, title } = req.body || {}
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url required for link attachment' })
      }
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: 'url must start with http:// or https://' })
      }
      const row = await createLinkAttachment({
        workItemId,
        url,
        title: title || null,
        userId,
      })
      return res.status(201).json({ attachment: row })
    } catch (err) { next(err) }
  }
)

router.get('/work-items/:id/attachments/:attId/download', async (req, res, next) => {
  try {
    const attachmentId = Number(req.params.attId)
    if (!Number.isInteger(attachmentId)) return res.status(400).json({ error: 'invalid attachment id' })
    const att = await getAttachment(attachmentId)
    if (!att) return res.status(404).json({ error: 'attachment not found' })
    if (att.work_item_id !== Number(req.params.id)) {
      return res.status(404).json({ error: 'attachment not found' })
    }
    if (att.kind !== 'file') {
      return res.status(400).json({ error: 'only file attachments can be downloaded' })
    }
    const storage = getStorage()
    res.setHeader('Content-Type', att.mime_type || 'application/octet-stream')
    const safeAscii = att.file_name.replace(/[\x00-\x1f\x7f"\\]/g, '_').replace(/[^\x20-\x7e]/g, '_')
    const utf8Encoded = encodeURIComponent(att.file_name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`
    )
    if (att.file_size_bytes) res.setHeader('Content-Length', att.file_size_bytes)
    const stream = storage.getReadStream(att.storage_key)
    stream.on('error', (err) => {
      if (!res.headersSent) return next(err)
      // Headers already flushed; destroy the socket so the client sees the failure.
      res.destroy(err)
    })
    stream.pipe(res)
  } catch (err) { next(err) }
})

router.delete('/work-items/:id/attachments/:attId', async (req, res, next) => {
  try {
    const attachmentId = Number(req.params.attId)
    const workItemId = Number(req.params.id)
    if (!Number.isInteger(attachmentId) || !Number.isInteger(workItemId)) {
      return res.status(400).json({ error: 'invalid id' })
    }
    const userId = req.userId

    // 404 before the permission check is intentional for v1; the enumeration
    // risk on attachment IDs is acceptable on an admin-authed API.
    const adminRes = await query(
      `SELECT is_admin FROM blueprint.users WHERE id = $1`,
      [userId]
    )
    const actorIsAdmin = adminRes.rows[0]?.is_admin === true

    const result = await deleteAttachment({ attachmentId, workItemId, userId, actorIsAdmin })
    if (result.reason === 'not_found') {
      return res.status(404).json({ error: 'attachment not found' })
    }
    if (result.reason === 'forbidden') {
      return res.status(403).json({ error: 'only the uploader or an admin can delete this attachment' })
    }
    res.json({ deleted: true, id: attachmentId })
  } catch (err) { next(err) }
})

// =============================================================================
// USER RELATIONSHIPS
// =============================================================================

router.get('/work-items/:id/relationships', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT r.id, r.user_id, r.relationship_type, r.is_active, r.assigned_at,
             u.display_name, u.email, u.avatar_url
      FROM runtime.work_item_user_relationships r
      JOIN blueprint.users u ON u.id = r.user_id
      WHERE r.work_item_id = $1 AND r.is_active = true
      ORDER BY r.assigned_at ASC
    `, [req.params.id])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/work-items/:id/relationships', async (req, res, next) => {
  const workItemId = parseInt(req.params.id)
  const { user_id, relationship_type } = req.body
  if (!user_id)           return res.status(400).json({ error: 'user_id is required' })
  if (!relationship_type) return res.status(400).json({ error: 'relationship_type is required' })

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: wi } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wi.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    const { rows: inserted } = await client.query(`
      INSERT INTO runtime.work_item_user_relationships (work_item_id, user_id, relationship_type, assigned_at, is_active)
      VALUES ($1, $2, $3, NOW(), true)
      RETURNING *
    `, [workItemId, user_id, relationship_type])

    const { rows: userRow } = await client.query(
      'SELECT uri FROM blueprint.users WHERE id = $1', [user_id]
    )

    await emitEvent(client, {
      eventType: 'work_item.assigned',
      entityId:  workItemId,
      entityUri: wi[0].uri,
      actorId:   req.userId ?? null,
      payload: {
        user_id,
        user_uri:          userRow[0]?.uri ?? null,
        work_item_uri:     wi[0].uri,
        relationship_type,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.status(201).json(inserted[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505') return res.status(409).json({ error: 'Relationship already exists' })
    next(err)
  } finally {
    client.release()
  }
})

router.delete('/work-item-relationships/:id', async (req, res, next) => {
  const relId = parseInt(req.params.id)
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: rel } = await client.query(`
      SELECT r.id, r.work_item_id, r.user_id, r.relationship_type, wi.uri AS work_item_uri, u.uri AS user_uri
      FROM runtime.work_item_user_relationships r
      JOIN runtime.work_items wi ON wi.id = r.work_item_id
      LEFT JOIN blueprint.users u ON u.id = r.user_id
      WHERE r.id = $1
    `, [relId])
    if (!rel.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Relationship not found' })
    }
    const r = rel[0]

    await client.query(
      'UPDATE runtime.work_item_user_relationships SET is_active = false WHERE id = $1',
      [relId]
    )

    await emitEvent(client, {
      eventType: 'work_item.unassigned',
      entityId:  r.work_item_id,
      entityUri: r.work_item_uri,
      actorId:   req.userId ?? null,
      payload: {
        user_id:           r.user_id,
        user_uri:          r.user_uri,
        work_item_uri:     r.work_item_uri,
        relationship_type: r.relationship_type,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    res.json({ deleted: r.id })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})

router.post('/work-items/:id/links', async (req, res, next) => {
  const sourceId = parseInt(req.params.id)
  const { target_work_item_id, link_type } = req.body
  if (!target_work_item_id) return res.status(400).json({ error: 'target_work_item_id is required' })
  if (!link_type)           return res.status(400).json({ error: 'link_type is required' })

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: src } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [sourceId])
    const { rows: tgt } = await client.query('SELECT uri FROM runtime.work_items WHERE id = $1', [target_work_item_id])
    if (!src.length || !tgt.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Work item not found' })
    }

    let responsePayload
    if (link_type === 'parent') {
      await client.query('UPDATE runtime.work_items SET parent_id = $1, updated_at = NOW() WHERE id = $2',
        [target_work_item_id, sourceId])
      responsePayload = { linked: true, link_type: 'parent' }
    } else if (link_type === 'child') {
      await client.query('UPDATE runtime.work_items SET parent_id = $1, updated_at = NOW() WHERE id = $2',
        [sourceId, target_work_item_id])
      responsePayload = { linked: true, link_type: 'child' }
    } else {
      const { rows: inserted } = await client.query(`
        INSERT INTO runtime.work_item_links (source_work_item_id, target_work_item_id, link_type, created_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [sourceId, target_work_item_id, link_type, req.userId ?? null])
      responsePayload = inserted[0]
    }

    await emitEvent(client, {
      eventType: 'work_item.linked',
      entityId:  sourceId,
      entityUri: src[0].uri,
      actorId:   req.userId ?? null,
      payload: {
        source_id:   sourceId,
        source_uri:  src[0].uri,
        target_id:   target_work_item_id,
        target_uri:  tgt[0].uri,
        link_type,
      },
    })

    await client.query('COMMIT')
    nudgeAfterCommit()
    const status = link_type === 'parent' || link_type === 'child' ? 200 : 201
    res.status(status).json(responsePayload)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505') return res.status(409).json({ error: 'Link already exists' })
    next(err)
  } finally {
    client.release()
  }
})

router.get('/work-items/:id/links', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id)
    // Get parent
    const parentResult = await query(`
      SELECT wi.id, wi.display_key, wi.title, s.name AS current_stage_name, 'parent' AS link_type
      FROM runtime.work_items child
      JOIN runtime.work_items wi ON wi.id = child.parent_id
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      WHERE child.id = $1 AND child.parent_id IS NOT NULL
    `, [id])
    // Get children
    const childResult = await query(`
      SELECT wi.id, wi.display_key, wi.title, s.name AS current_stage_name, 'child' AS link_type
      FROM runtime.work_items wi
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      WHERE wi.parent_id = $1
    `, [id])
    // Get related links (both directions)
    const linkResult = await query(`
      SELECT wi.id, wi.display_key, wi.title, s.name AS current_stage_name, l.link_type
      FROM runtime.work_item_links l
      JOIN runtime.work_items wi ON wi.id = CASE WHEN l.source_work_item_id = $1 THEN l.target_work_item_id ELSE l.source_work_item_id END
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      WHERE l.source_work_item_id = $1 OR l.target_work_item_id = $1
    `, [id])

    const rows = [...parentResult.rows, ...childResult.rows, ...linkResult.rows]
    res.json({ rows, count: rows.length })
  } catch (err) { next(err) }
})

// =============================================================================
// REPORTS
// =============================================================================

// Delivery time histogram — completed items with lead time buckets
router.get('/reports/delivery-time', async (req, res, next) => {
  try {
    const orgId = req.query.org_id ? parseInt(req.query.org_id) : null
    const witType = req.query.wit_type || null
    const days = parseInt(req.query.days) || 42 // default 6 weeks

    const result = await query(`
      SELECT wi.id, wi.title, wi.display_key,
             wit.name AS work_item_type_name,
             s.stage_class,
             wi.created_at AS started_at,
             wi.entered_current_stage_at AS completed_at,
             EXTRACT(EPOCH FROM (wi.entered_current_stage_at - wi.created_at)) / 3600 AS lead_time_hours
      FROM runtime.work_items wi
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      WHERE s.stage_class = 'done'
        AND wi.spawn_state = 'active'
        AND wi.entered_current_stage_at >= NOW() - ($1 || ' days')::interval
        ${orgId ? 'AND wi.owner_org_id = $2' : ''}
        ${witType ? `AND wit.name = ${orgId ? '$3' : '$2'}` : ''}
      ORDER BY wi.entered_current_stage_at ASC
    `, [days, ...(orgId ? [orgId] : []), ...(witType ? [witType] : [])])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// Throughput — items completed per time bucket
router.get('/reports/throughput', async (req, res, next) => {
  try {
    const orgId = req.query.org_id ? parseInt(req.query.org_id) : null
    const witType = req.query.wit_type || null
    const days = parseInt(req.query.days) || 42
    const bucket = req.query.bucket || 'week' // day, week, month

    const truncExpr = bucket === 'day' ? `date_trunc('day', wi.entered_current_stage_at)`
                    : bucket === 'month' ? `date_trunc('month', wi.entered_current_stage_at)`
                    : `date_trunc('week', wi.entered_current_stage_at)`

    const result = await query(`
      SELECT ${truncExpr} AS period,
             wit.name AS work_item_type_name,
             COUNT(*)::int AS count
      FROM runtime.work_items wi
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      WHERE s.stage_class = 'done'
        AND wi.spawn_state = 'active'
        AND wi.entered_current_stage_at >= NOW() - ($1 || ' days')::interval
        ${orgId ? 'AND wi.owner_org_id = $2' : ''}
        ${witType ? `AND wit.name = ${orgId ? '$3' : '$2'}` : ''}
      GROUP BY period, wit.name
      ORDER BY period ASC, wit.name ASC
    `, [days, ...(orgId ? [orgId] : []), ...(witType ? [witType] : [])])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// Cycle time by stage — average time in each stage for completed items
router.get('/reports/cycle-time-by-stage', async (req, res, next) => {
  try {
    const orgId = req.query.org_id ? parseInt(req.query.org_id) : null
    const witType = req.query.wit_type || null
    const days = parseInt(req.query.days) || 42

    // Get stage transition history — each row represents time in the from_stage
    const result = await query(`
      SELECT s.name AS stage_name,
             s.stage_class,
             COUNT(DISTINCT h.work_item_id)::int AS item_count,
             AVG(h.time_in_stage_seconds) / 3600.0 AS avg_hours,
             PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY h.time_in_stage_seconds
             ) / 3600.0 AS median_hours,
             PERCENTILE_CONT(0.85) WITHIN GROUP (
               ORDER BY h.time_in_stage_seconds
             ) / 3600.0 AS p85_hours
      FROM runtime.stage_transition_history h
      JOIN runtime.work_items wi ON wi.id = h.work_item_id
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.stages s ON s.id = h.from_stage_id
      WHERE wi.spawn_state = 'active'
        AND h.exited_from_stage_at >= NOW() - ($1 || ' days')::interval
        AND s.stage_class != 'done'
        ${orgId ? 'AND wi.owner_org_id = $2' : ''}
        ${witType ? `AND wit.name = ${orgId ? '$3' : '$2'}` : ''}
      GROUP BY s.name, s.stage_class
      ORDER BY MIN(s.display_order) ASC
    `, [days, ...(orgId ? [orgId] : []), ...(witType ? [witType] : [])])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// =============================================================================
// LOOKUP LISTS
// =============================================================================

router.get('/lookup-lists', async (req, res, next) => {
  try {
    const { org_id } = req.query
    // If org_id provided, return lists visible to that org (own + ancestors + system)
    // Otherwise return all lists
    let result
    if (org_id) {
      result = await query(`
        WITH RECURSIVE org_chain AS (
          SELECT id, parent_id FROM blueprint.organizations WHERE id = $1
          UNION ALL
          SELECT o.id, o.parent_id FROM blueprint.organizations o
          JOIN org_chain oc ON o.id = oc.parent_id
        )
        SELECT ll.*, o.name AS org_name, o.slug AS org_slug,
               (SELECT COUNT(*) FROM blueprint.lookup_values lv WHERE lv.list_id = ll.id) AS value_count
        FROM blueprint.lookup_lists ll
        JOIN blueprint.organizations o ON o.id = ll.org_id
        WHERE ll.org_id IN (SELECT id FROM org_chain)
          AND ll.is_active = true
        ORDER BY o.slug ASC, ll.name ASC
      `, [org_id])
    } else {
      result = await query(`
        SELECT ll.*, o.name AS org_name, o.slug AS org_slug,
               (SELECT COUNT(*) FROM blueprint.lookup_values lv WHERE lv.list_id = ll.id) AS value_count
        FROM blueprint.lookup_lists ll
        JOIN blueprint.organizations o ON o.id = ll.org_id
        WHERE ll.is_active = true
        ORDER BY o.slug ASC, ll.name ASC
      `)
    }
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/lookup-lists', async (req, res, next) => {
  try {
    const { org_id, name, description, sort_mode } = req.body
    if (!org_id) return res.status(400).json({ error: 'org_id is required' })
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

    const result = await query(`
      INSERT INTO blueprint.lookup_lists (org_id, name, description, sort_mode)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [org_id, name.trim(), description?.trim() || null, sort_mode || 'alpha'])

    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'List name already exists for this org' })
    next(err)
  }
})

router.patch('/lookup-lists/:id', async (req, res, next) => {
  try {
    const { name, description, sort_mode, is_active } = req.body
    const result = await query(`
      UPDATE blueprint.lookup_lists SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        sort_mode   = COALESCE($3, sort_mode),
        is_active   = COALESCE($4, is_active),
        updated_at  = NOW()
      WHERE id = $5
      RETURNING *
    `, [name?.trim() || null, description?.trim() ?? null, sort_mode || null, is_active ?? null, req.params.id])

    if (!result.rows.length) return res.status(404).json({ error: 'List not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// =============================================================================
// LOOKUP VALUES
// =============================================================================

router.get('/lookup-lists/:listId/values', async (req, res, next) => {
  try {
    // Get the list's sort mode
    const listResult = await query('SELECT sort_mode FROM blueprint.lookup_lists WHERE id = $1', [req.params.listId])
    if (!listResult.rows.length) return res.status(404).json({ error: 'List not found' })

    const orderBy = listResult.rows[0].sort_mode === 'alpha' ? 'label ASC' : 'sort_order ASC, label ASC'

    const result = await query(`
      SELECT * FROM blueprint.lookup_values
      WHERE list_id = $1
      ORDER BY ${orderBy}
    `, [req.params.listId])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/lookup-lists/:listId/values', async (req, res, next) => {
  try {
    const { label, sort_order } = req.body
    if (!label?.trim()) return res.status(400).json({ error: 'label is required' })

    // Auto-assign sort_order if not provided
    let order = sort_order
    if (order == null) {
      const maxResult = await query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM blueprint.lookup_values WHERE list_id = $1',
        [req.params.listId]
      )
      order = maxResult.rows[0].next_order
    }

    const result = await query(`
      INSERT INTO blueprint.lookup_values (list_id, label, sort_order)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.listId, label.trim(), order])

    res.status(201).json(result.rows[0])
  } catch (err) { next(err) }
})

router.patch('/lookup-values/:id', async (req, res, next) => {
  try {
    const { label, sort_order, is_active } = req.body
    const result = await query(`
      UPDATE blueprint.lookup_values SET
        label      = COALESCE($1, label),
        sort_order = COALESCE($2, sort_order),
        is_active  = COALESCE($3, is_active),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [label?.trim() || null, sort_order ?? null, is_active ?? null, req.params.id])

    if (!result.rows.length) return res.status(404).json({ error: 'Value not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.put('/lookup-lists/:listId/values/reorder', async (req, res, next) => {
  try {
    const { order } = req.body // array of value ids in desired order
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of value ids' })

    const client = await getClient()
    try {
      await client.query('BEGIN')
      for (let i = 0; i < order.length; i++) {
        await client.query(
          'UPDATE blueprint.lookup_values SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND list_id = $3',
          [i, order[i], req.params.listId]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.json({ ok: true })
  } catch (err) { next(err) }
})

// =============================================================================
// ACCEPTANCE CRITERIA
// =============================================================================

router.get('/work-items/:id/acceptance-criteria', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT acceptance_criteria FROM runtime.work_items WHERE id = $1',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Work item not found' })
    res.json({ items: result.rows[0].acceptance_criteria || [] })
  } catch (err) { next(err) }
})

router.put('/work-items/:id/acceptance-criteria', async (req, res, next) => {
  try {
    const { items } = req.body // full array replacement
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' })

    // Validate shape
    for (const item of items) {
      if (!item.id || !item.text) return res.status(400).json({ error: 'Each item needs id and text' })
    }

    // TODO: Permission check — adding/removing AC items requires 'manage_acceptance_criteria' permission
    // Check/uncheck (toggling checked status) is unrestricted
    // When auth is built: load existing items, compare to detect adds/removes vs check toggles,
    // and gate adds/removes behind core/access.js permission check scoped to owner_org_id

    const result = await query(`
      UPDATE runtime.work_items SET
        acceptance_criteria = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING acceptance_criteria
    `, [JSON.stringify(items), req.params.id])

    if (!result.rows.length) return res.status(404).json({ error: 'Work item not found' })
    res.json({ items: result.rows[0].acceptance_criteria })
  } catch (err) { next(err) }
})

// =============================================================================
// POLICY DATA + EXIT CRITERIA + ROLE RESTRICTIONS
// =============================================================================

// Aggregated policy data for an org (workflows, stages, transitions, exit criteria, role restrictions, WIP limits)
router.get('/org-policy-data', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })

    const [orgResult, wfResult, stagesResult, transitionsResult, criteriaResult, roleRestrictionsResult, wipResult, wipClassResult, actionsResult] = await Promise.all([
      // Org info
      query(
        'SELECT id, done_retention_days FROM blueprint.organizations WHERE id = $1 AND is_active = true',
        [orgId]
      ),
      // Workflows used by this org
      query(`
        SELECT DISTINCT w.id, w.name, w.is_system_default
        FROM blueprint.workflows w
        JOIN blueprint.work_item_type_workflows witw ON witw.workflow_id = w.id AND witw.is_current = true
        JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
        WHERE wit.owner_org_id = $1 AND wit.is_active = true
        ORDER BY w.name ASC
      `, [orgId]),
      // Stages for those workflows
      query(`
        SELECT s.id, s.name, s.stage_class, s.display_order, s.has_waiting_queue,
               s.is_entry_stage, s.is_terminal, s.workflow_id
        FROM blueprint.stages s
        WHERE s.workflow_id IN (
          SELECT DISTINCT witw.workflow_id
          FROM blueprint.work_item_type_workflows witw
          JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
          WHERE wit.owner_org_id = $1 AND wit.is_active = true AND witw.is_current = true
        )
        AND s.is_active = true
        ORDER BY s.display_order ASC
      `, [orgId]),
      // Transitions for org's stages
      query(`
        SELECT st.id, st.from_stage_id, st.to_stage_id, st.transition_label,
               st.transition_kind, st.requires_reason, ts.name AS to_stage_name
        FROM blueprint.stage_transitions st
        JOIN blueprint.stages ts ON ts.id = st.to_stage_id
        WHERE st.from_stage_id IN (
          SELECT s.id FROM blueprint.stages s
          WHERE s.workflow_id IN (
            SELECT DISTINCT witw.workflow_id
            FROM blueprint.work_item_type_workflows witw
            JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
            WHERE wit.owner_org_id = $1 AND wit.is_active = true AND witw.is_current = true
          )
          AND s.is_active = true
        )
        AND st.is_active = true
        ORDER BY st.id ASC
      `, [orgId]),
      // Exit criteria counts per stage
      query(`
        SELECT ec.stage_id, COUNT(*)::int AS exit_criteria_count
        FROM blueprint.exit_criteria ec
        WHERE ec.is_active = true
        AND ec.stage_id IN (
          SELECT s.id FROM blueprint.stages s
          WHERE s.workflow_id IN (
            SELECT DISTINCT witw.workflow_id
            FROM blueprint.work_item_type_workflows witw
            JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
            WHERE wit.owner_org_id = $1 AND wit.is_active = true AND witw.is_current = true
          )
          AND s.is_active = true
        )
        GROUP BY ec.stage_id
      `, [orgId]),
      // Role restrictions per transition
      query(`
        SELECT rr.id, rr.stage_transition_id, rr.role_id, r.name AS role_name
        FROM blueprint.stage_transition_role_restrictions rr
        JOIN blueprint.roles r ON r.id = rr.role_id
        WHERE rr.stage_transition_id IN (
          SELECT st.id FROM blueprint.stage_transitions st
          WHERE st.from_stage_id IN (
            SELECT s.id FROM blueprint.stages s
            WHERE s.workflow_id IN (
              SELECT DISTINCT witw.workflow_id
              FROM blueprint.work_item_type_workflows witw
              JOIN blueprint.work_item_types wit ON wit.id = witw.work_item_type_id
              WHERE wit.owner_org_id = $1 AND wit.is_active = true AND witw.is_current = true
            )
            AND s.is_active = true
          )
          AND st.is_active = true
        )
      `, [orgId]),
      // Org WIP limits (stage-level)
      query(
        'SELECT id, stage_name, wip_limit, enforcement_type FROM blueprint.org_wip_limits WHERE org_id = $1',
        [orgId]
      ),
      // Org WIP limits (stage-class-level)
      query(
        'SELECT id, stage_class, wip_limit, enforcement_type FROM blueprint.org_wip_limits_by_class WHERE org_id = $1',
        [orgId]
      ),
      // Transition actions
      query(`
        SELECT ta.id, ta.stage_transition_id, ta.name, ta.description, ta.action_type,
               ta.execution_timing, ta.display_order, ta.is_active,
               ta.spawn_work_item_type_id, ta.spawn_target_org_id, ta.spawn_field_mapping,
               ta.optional_spawn_prompt, ta.optional_spawn_default,
               ta.api_endpoint, ta.api_method, ta.api_headers, ta.api_payload_template,
               ta.api_timeout_seconds, ta.api_on_failure,
               wit.name AS spawn_type_name, o.name AS spawn_target_org_name
        FROM blueprint.transition_actions ta
        LEFT JOIN blueprint.work_item_types wit ON wit.id = ta.spawn_work_item_type_id
        LEFT JOIN blueprint.organizations o ON o.id = ta.spawn_target_org_id
        WHERE ta.is_active = true
        AND ta.stage_transition_id IN (
          SELECT st.id FROM blueprint.stage_transitions st
          WHERE st.from_stage_id IN (
            SELECT s.id FROM blueprint.stages s
            WHERE s.workflow_id IN (
              SELECT DISTINCT witw.workflow_id
              FROM blueprint.work_item_type_workflows witw
              JOIN blueprint.work_item_types wit2 ON wit2.id = witw.work_item_type_id
              WHERE wit2.owner_org_id = $1 AND wit2.is_active = true AND witw.is_current = true
            )
            AND s.is_active = true
          )
          AND st.is_active = true
        )
        ORDER BY ta.display_order ASC
      `, [orgId]),
    ])

    if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' })

    // Index criteria counts by stage_id
    const criteriaCounts = {}
    for (const row of criteriaResult.rows) criteriaCounts[row.stage_id] = row.exit_criteria_count

    // Index role restrictions by transition_id
    const roleRestrictions = {}
    for (const row of roleRestrictionsResult.rows) {
      if (!roleRestrictions[row.stage_transition_id]) roleRestrictions[row.stage_transition_id] = []
      roleRestrictions[row.stage_transition_id].push({ role_id: row.role_id, role_name: row.role_name })
    }

    // Index transition actions by transition_id
    const actionsByTransition = {}
    for (const a of actionsResult.rows) {
      if (!actionsByTransition[a.stage_transition_id]) actionsByTransition[a.stage_transition_id] = []
      actionsByTransition[a.stage_transition_id].push(a)
    }

    // Index transitions by from_stage_id
    const transitionsByStage = {}
    for (const t of transitionsResult.rows) {
      if (!transitionsByStage[t.from_stage_id]) transitionsByStage[t.from_stage_id] = []
      transitionsByStage[t.from_stage_id].push({
        id: t.id,
        to_stage_id: t.to_stage_id,
        to_stage_name: t.to_stage_name,
        transition_label: t.transition_label,
        transition_kind: t.transition_kind,
        requires_reason: t.requires_reason,
        role_restrictions: roleRestrictions[t.id] || [],
        actions: actionsByTransition[t.id] || [],
      })
    }

    // Assemble workflows with stages and transitions
    const workflows = wfResult.rows.map(w => ({
      id: w.id,
      name: w.name,
      is_system_default: w.is_system_default,
      stages: stagesResult.rows
        .filter(s => s.workflow_id === w.id)
        .map(s => ({
          id: s.id,
          name: s.name,
          stage_class: s.stage_class,
          display_order: s.display_order,
          has_waiting_queue: s.has_waiting_queue,
          is_entry_stage: s.is_entry_stage,
          is_terminal: s.is_terminal,
          exit_criteria_count: criteriaCounts[s.id] || 0,
          transitions: transitionsByStage[s.id] || [],
        })),
    }))

    // WIP limits as map keyed by stage_name
    const wipLimits = {}
    for (const row of wipResult.rows) {
      wipLimits[row.stage_name] = { id: row.id, wip_limit: row.wip_limit, enforcement_type: row.enforcement_type }
    }

    // Class-level WIP limits as map keyed by stage_class
    const wipClassLimits = {}
    for (const row of wipClassResult.rows) {
      wipClassLimits[row.stage_class] = { id: row.id, wip_limit: row.wip_limit, enforcement_type: row.enforcement_type }
    }

    res.json({
      org: { id: orgResult.rows[0].id, done_retention_days: orgResult.rows[0].done_retention_days },
      workflows,
      wip_limits: wipLimits,
      wip_class_limits: wipClassLimits,
    })
  } catch (err) { next(err) }
})

// Update transition properties
router.patch('/transitions/:id', async (req, res, next) => {
  try {
    const { transition_label, transition_kind } = req.body
    const requiresReason = req.body.requires_reason !== undefined ? req.body.requires_reason : null

    const result = await query(`
      UPDATE blueprint.stage_transitions
      SET transition_label = COALESCE($2, transition_label),
          transition_kind  = COALESCE($3, transition_kind),
          requires_reason  = CASE WHEN $4::boolean IS NOT NULL THEN $4::boolean ELSE requires_reason END
      WHERE id = $1
      RETURNING *
    `, [
      req.params.id,
      transition_label?.trim() || null,
      transition_kind?.trim() || null,
      requiresReason,
    ])

    if (!result.rows.length) return res.status(404).json({ error: 'Transition not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// List exit criteria for a stage
router.get('/exit-criteria', async (req, res, next) => {
  try {
    const stageId = parseInt(req.query.stage_id)
    if (!stageId) return res.status(400).json({ error: 'stage_id is required' })

    const result = await query(`
      SELECT id, uri, stage_id, name, description, criteria_tier, display_order,
             codified_condition, api_endpoint, api_method, api_payload_template,
             api_success_condition, api_timeout_seconds, is_blocking, is_active,
             created_at, updated_at
      FROM blueprint.exit_criteria
      WHERE stage_id = $1
      ORDER BY display_order ASC, id ASC
    `, [stageId])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// Create exit criteria
router.post('/exit-criteria', async (req, res, next) => {
  try {
    const {
      stage_id, name, description, criteria_tier, codified_condition,
      api_endpoint, api_method, api_payload_template, api_success_condition,
      api_timeout_seconds, is_blocking, display_order
    } = req.body

    if (!stage_id || !name?.trim() || !criteria_tier) {
      return res.status(400).json({ error: 'stage_id, name, and criteria_tier are required' })
    }

    const uri = generateUri('system', 'criteria')

    const result = await query(`
      INSERT INTO blueprint.exit_criteria
        (uri, stage_id, name, description, criteria_tier, codified_condition,
         api_endpoint, api_method, api_payload_template, api_success_condition,
         api_timeout_seconds, is_blocking, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      uri,
      stage_id,
      name.trim(),
      description?.trim() || null,
      criteria_tier,
      codified_condition ? JSON.stringify(codified_condition) : null,
      api_endpoint?.trim() || null,
      api_method?.trim() || 'GET',
      api_payload_template ? JSON.stringify(api_payload_template) : null,
      api_success_condition ? JSON.stringify(api_success_condition) : null,
      api_timeout_seconds ?? 10,
      is_blocking ?? true,
      display_order ?? 0,
    ])

    res.status(201).json(result.rows[0])
  } catch (err) { next(err) }
})

// Update exit criteria
router.patch('/exit-criteria/:id', async (req, res, next) => {
  try {
    const { name, description, criteria_tier, codified_condition, is_blocking, is_active, display_order } = req.body
    const fields = []
    const vals = []

    if (name !== undefined)               { fields.push(`name = $${fields.length + 1}`);               vals.push(name.trim()) }
    if (description !== undefined)         { fields.push(`description = $${fields.length + 1}`);         vals.push(description?.trim() || null) }
    if (criteria_tier !== undefined)        { fields.push(`criteria_tier = $${fields.length + 1}`);        vals.push(criteria_tier) }
    if (codified_condition !== undefined)   { fields.push(`codified_condition = $${fields.length + 1}`);   vals.push(codified_condition ? JSON.stringify(codified_condition) : null) }
    if (is_blocking !== undefined)          { fields.push(`is_blocking = $${fields.length + 1}`);          vals.push(is_blocking) }
    if (is_active !== undefined)            { fields.push(`is_active = $${fields.length + 1}`);            vals.push(is_active) }
    if (display_order !== undefined)        { fields.push(`display_order = $${fields.length + 1}`);        vals.push(display_order) }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update' })
    fields.push(`updated_at = NOW()`)
    vals.push(parseInt(req.params.id))

    const result = await query(
      `UPDATE blueprint.exit_criteria SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )

    if (!result.rows.length) return res.status(404).json({ error: 'Exit criteria not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// Soft-delete exit criteria
router.delete('/exit-criteria/:id', async (req, res, next) => {
  try {
    const result = await query(
      'UPDATE blueprint.exit_criteria SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Exit criteria not found' })
    res.json({ deleted: true, id: result.rows[0].id })
  } catch (err) { next(err) }
})

// List role restrictions for a transition
router.get('/transition-roles', async (req, res, next) => {
  try {
    const transitionId = parseInt(req.query.transition_id)
    if (!transitionId) return res.status(400).json({ error: 'transition_id is required' })

    const result = await query(`
      SELECT rr.id, rr.stage_transition_id, rr.role_id, r.name AS role_name, rr.created_at
      FROM blueprint.stage_transition_role_restrictions rr
      JOIN blueprint.roles r ON r.id = rr.role_id
      WHERE rr.stage_transition_id = $1
      ORDER BY r.name ASC
    `, [transitionId])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// Add role restriction to a transition
router.post('/transition-roles', async (req, res, next) => {
  try {
    const { stage_transition_id, role_id } = req.body
    if (!stage_transition_id || !role_id) {
      return res.status(400).json({ error: 'stage_transition_id and role_id are required' })
    }

    const result = await query(`
      INSERT INTO blueprint.stage_transition_role_restrictions (stage_transition_id, role_id)
      VALUES ($1, $2)
      RETURNING *
    `, [stage_transition_id, role_id])

    // Fetch with role name
    const joined = await query(`
      SELECT rr.id, rr.stage_transition_id, rr.role_id, r.name AS role_name, rr.created_at
      FROM blueprint.stage_transition_role_restrictions rr
      JOIN blueprint.roles r ON r.id = rr.role_id
      WHERE rr.id = $1
    `, [result.rows[0].id])

    res.status(201).json(joined.rows[0])
  } catch (err) { next(err) }
})

// Remove role restriction from a transition
router.delete('/transition-roles/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM blueprint.stage_transition_role_restrictions WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Role restriction not found' })
    res.json({ deleted: true, id: result.rows[0].id })
  } catch (err) { next(err) }
})

// =============================================================================
// ORG WIP LIMITS BY STAGE CLASS
// =============================================================================

router.put('/org-wip-class-limits', async (req, res, next) => {
  try {
    const { org_id, stage_class, wip_limit, enforcement_type } = req.body
    if (!org_id)             return res.status(400).json({ error: 'org_id is required' })
    if (!stage_class?.trim()) return res.status(400).json({ error: 'stage_class is required' })

    if (!wip_limit || wip_limit < 1) {
      await query(
        'DELETE FROM blueprint.org_wip_limits_by_class WHERE org_id = $1 AND stage_class = $2',
        [org_id, stage_class.trim()]
      )
      return res.json({ cleared: true, stage_class: stage_class.trim() })
    }

    const result = await query(`
      INSERT INTO blueprint.org_wip_limits_by_class (org_id, stage_class, wip_limit, enforcement_type)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (org_id, stage_class) DO UPDATE SET
        wip_limit        = EXCLUDED.wip_limit,
        enforcement_type = EXCLUDED.enforcement_type,
        updated_at       = NOW()
      RETURNING *
    `, [org_id, stage_class.trim(), wip_limit, enforcement_type || 'soft'])
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.delete('/org-wip-class-limits/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM blueprint.org_wip_limits_by_class WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Class WIP limit not found' })
    res.json({ deleted: result.rows[0].id })
  } catch (err) { next(err) }
})

// =============================================================================
// TRANSITION ACTIONS CRUD
// =============================================================================

router.get('/transition-actions', async (req, res, next) => {
  try {
    const transitionId = parseInt(req.query.transition_id)
    if (!transitionId) return res.status(400).json({ error: 'transition_id is required' })

    const result = await query(`
      SELECT ta.*,
             wit.name AS spawn_type_name, o.name AS spawn_target_org_name
      FROM blueprint.transition_actions ta
      LEFT JOIN blueprint.work_item_types wit ON wit.id = ta.spawn_work_item_type_id
      LEFT JOIN blueprint.organizations o ON o.id = ta.spawn_target_org_id
      WHERE ta.stage_transition_id = $1
      ORDER BY ta.display_order ASC, ta.id ASC
    `, [transitionId])

    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/transition-actions', async (req, res, next) => {
  try {
    const {
      stage_transition_id, name, description, action_type, execution_timing,
      display_order, api_endpoint, api_method, api_headers, api_payload_template,
      api_timeout_seconds, api_on_failure,
      spawn_work_item_type_id, spawn_target_org_id, spawn_field_mapping,
      optional_spawn_prompt, optional_spawn_default,
    } = req.body

    if (!stage_transition_id || !name?.trim() || !action_type) {
      return res.status(400).json({ error: 'stage_transition_id, name, and action_type are required' })
    }

    const uri = generateUri('system', 'actions')

    const result = await query(`
      INSERT INTO blueprint.transition_actions
        (uri, stage_transition_id, name, description, action_type, execution_timing,
         display_order, api_endpoint, api_method, api_headers, api_payload_template,
         api_timeout_seconds, api_on_failure,
         spawn_work_item_type_id, spawn_target_org_id, spawn_field_mapping,
         optional_spawn_prompt, optional_spawn_default)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [
      uri,
      stage_transition_id,
      name.trim(),
      description?.trim() || null,
      action_type,
      execution_timing || 'post',
      display_order ?? 0,
      api_endpoint?.trim() || null,
      api_method?.trim() || 'POST',
      api_headers ? JSON.stringify(api_headers) : null,
      api_payload_template ? JSON.stringify(api_payload_template) : null,
      api_timeout_seconds ?? 10,
      api_on_failure || 'log',
      spawn_work_item_type_id || null,
      spawn_target_org_id || null,
      spawn_field_mapping ? JSON.stringify(spawn_field_mapping) : null,
      optional_spawn_prompt?.trim() || null,
      optional_spawn_default ?? false,
    ])

    res.status(201).json(result.rows[0])
  } catch (err) { next(err) }
})

router.patch('/transition-actions/:id', async (req, res, next) => {
  try {
    const {
      name, description, action_type, execution_timing, display_order, is_active,
      api_endpoint, api_method, api_headers, api_payload_template, api_timeout_seconds, api_on_failure,
      spawn_work_item_type_id, spawn_target_org_id, spawn_field_mapping,
      optional_spawn_prompt, optional_spawn_default,
    } = req.body

    const fields = []
    const vals = []

    if (name !== undefined)                    { fields.push(`name = $${fields.length + 1}`);                    vals.push(name.trim()) }
    if (description !== undefined)             { fields.push(`description = $${fields.length + 1}`);             vals.push(description?.trim() || null) }
    if (action_type !== undefined)             { fields.push(`action_type = $${fields.length + 1}`);             vals.push(action_type) }
    if (execution_timing !== undefined)        { fields.push(`execution_timing = $${fields.length + 1}`);        vals.push(execution_timing) }
    if (display_order !== undefined)           { fields.push(`display_order = $${fields.length + 1}`);           vals.push(display_order) }
    if (is_active !== undefined)               { fields.push(`is_active = $${fields.length + 1}`);               vals.push(is_active) }
    if (api_endpoint !== undefined)            { fields.push(`api_endpoint = $${fields.length + 1}`);            vals.push(api_endpoint?.trim() || null) }
    if (api_method !== undefined)              { fields.push(`api_method = $${fields.length + 1}`);              vals.push(api_method) }
    if (api_headers !== undefined)             { fields.push(`api_headers = $${fields.length + 1}`);             vals.push(api_headers ? JSON.stringify(api_headers) : null) }
    if (api_payload_template !== undefined)    { fields.push(`api_payload_template = $${fields.length + 1}`);    vals.push(api_payload_template ? JSON.stringify(api_payload_template) : null) }
    if (api_timeout_seconds !== undefined)     { fields.push(`api_timeout_seconds = $${fields.length + 1}`);     vals.push(api_timeout_seconds) }
    if (api_on_failure !== undefined)          { fields.push(`api_on_failure = $${fields.length + 1}`);          vals.push(api_on_failure) }
    if (spawn_work_item_type_id !== undefined) { fields.push(`spawn_work_item_type_id = $${fields.length + 1}`); vals.push(spawn_work_item_type_id || null) }
    if (spawn_target_org_id !== undefined)     { fields.push(`spawn_target_org_id = $${fields.length + 1}`);     vals.push(spawn_target_org_id || null) }
    if (spawn_field_mapping !== undefined)     { fields.push(`spawn_field_mapping = $${fields.length + 1}`);     vals.push(spawn_field_mapping ? JSON.stringify(spawn_field_mapping) : null) }
    if (optional_spawn_prompt !== undefined)   { fields.push(`optional_spawn_prompt = $${fields.length + 1}`);   vals.push(optional_spawn_prompt?.trim() || null) }
    if (optional_spawn_default !== undefined)  { fields.push(`optional_spawn_default = $${fields.length + 1}`);  vals.push(optional_spawn_default) }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update' })
    fields.push(`updated_at = NOW()`)
    vals.push(parseInt(req.params.id))

    const result = await query(
      `UPDATE blueprint.transition_actions SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )

    if (!result.rows.length) return res.status(404).json({ error: 'Transition action not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

router.delete('/transition-actions/:id', async (req, res, next) => {
  try {
    const result = await query(
      'UPDATE blueprint.transition_actions SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Transition action not found' })
    res.json({ deleted: true, id: result.rows[0].id })
  } catch (err) { next(err) }
})

// =============================================================================
// SERVICE CATALOG
// =============================================================================

// List catalog items for an org
router.get('/catalog-items', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })
    const result = await query(`
      SELECT sci.*, wit.name AS type_name, wit.icon AS type_icon,
             wit.key_prefix, o.name AS org_name
      FROM blueprint.service_catalog_items sci
      JOIN blueprint.work_item_types wit ON wit.id = sci.work_item_type_id
      JOIN blueprint.organizations o     ON o.id = sci.owner_org_id
      WHERE sci.owner_org_id = $1 AND sci.is_active = true
      ORDER BY sci.name ASC
    `, [orgId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

// Create catalog item
router.post('/catalog-items', async (req, res, next) => {
  try {
    const { name, description, owner_org_id, work_item_type_id,
            is_internal, is_cross_org, is_external,
            external_slug, requires_approval } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    if (!owner_org_id) return res.status(400).json({ error: 'owner_org_id is required' })
    if (!work_item_type_id) return res.status(400).json({ error: 'work_item_type_id is required' })

    // Generate slug from name if not provided and is_external is true
    let slug = external_slug?.trim() || null
    if (is_external && !slug) {
      slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    }

    // Validate slug uniqueness
    if (slug) {
      const existing = await query(
        'SELECT id FROM blueprint.service_catalog_items WHERE external_slug = $1',
        [slug]
      )
      if (existing.rows.length) {
        return res.status(409).json({ error: `Slug "${slug}" is already in use` })
      }
    }

    // Generate URI
    const orgResult = await query('SELECT slug FROM blueprint.organizations WHERE id = $1', [owner_org_id])
    if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' })

    const { generateUri } = await import('../core/uri.js')
    const uri = generateUri(orgResult.rows[0].slug, 'service-catalog')

    const result = await query(`
      INSERT INTO blueprint.service_catalog_items
        (uri, name, description, owner_org_id, work_item_type_id,
         is_internal, is_cross_org, is_external,
         external_slug, requires_approval, is_active, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW(),NOW())
      RETURNING *
    `, [
      uri, name.trim(), description || null, owner_org_id, work_item_type_id,
      is_internal ?? true, is_cross_org ?? false, is_external ?? false,
      slug, requires_approval ?? false,
    ])
    res.status(201).json(result.rows[0])
  } catch (err) { next(err) }
})

// Update catalog item
router.patch('/catalog-items/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { name, description, is_internal, is_cross_org, is_external,
            external_slug, requires_approval, request_mode, is_active } = req.body

    // Validate slug uniqueness if changing
    if (external_slug !== undefined) {
      const slug = external_slug?.trim() || null
      if (slug) {
        const existing = await query(
          'SELECT id FROM blueprint.service_catalog_items WHERE external_slug = $1 AND id <> $2',
          [slug, id]
        )
        if (existing.rows.length) {
          return res.status(409).json({ error: `Slug "${slug}" is already in use` })
        }
      }
    }

    const result = await query(`
      UPDATE blueprint.service_catalog_items SET
        name              = COALESCE($1, name),
        description       = COALESCE($2, description),
        is_internal       = COALESCE($3, is_internal),
        is_cross_org      = COALESCE($4, is_cross_org),
        is_external       = COALESCE($5, is_external),
        external_slug     = COALESCE($6, external_slug),
        requires_approval = COALESCE($7, requires_approval),
        request_mode      = COALESCE($8, request_mode),
        is_active         = COALESCE($9, is_active),
        updated_at        = NOW()
      WHERE id = $10
      RETURNING *
    `, [
      name?.trim() ?? null, description ?? null,
      is_internal ?? null, is_cross_org ?? null, is_external ?? null,
      external_slug?.trim() ?? null, requires_approval ?? null,
      request_mode ?? null, is_active ?? null, id,
    ])
    if (!result.rows.length) return res.status(404).json({ error: 'Catalog item not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// Delete (soft) catalog item
router.delete('/catalog-items/:id', async (req, res, next) => {
  try {
    const result = await query(
      'UPDATE blueprint.service_catalog_items SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Catalog item not found' })
    res.json({ deleted: true, id: result.rows[0].id })
  } catch (err) { next(err) }
})

// =============================================================================
// EVENT SUBSCRIBERS (admin / ops view)
// =============================================================================

router.get('/event-subscribers', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT name, last_processed_event_id, is_paused, last_error, last_error_at,
             failure_count, last_success_at, events_processed_total, updated_at
      FROM runtime.event_subscribers
      ORDER BY name ASC
    `)
    res.json({ rows, count: rows.length })
  } catch (err) { next(err) }
})

router.post('/event-subscribers/:name/pause', async (req, res, next) => {
  try {
    const { is_paused } = req.body
    if (typeof is_paused !== 'boolean') {
      return res.status(400).json({ error: 'is_paused (boolean) is required' })
    }
    const { rows } = await query(`
      UPDATE runtime.event_subscribers
      SET is_paused = $1, updated_at = NOW()
      WHERE name = $2
      RETURNING *
    `, [is_paused, req.params.name])
    if (!rows.length) return res.status(404).json({ error: 'Subscriber not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// Manually bump cursor past a bad event (ops recovery)
router.post('/event-subscribers/:name/skip-past/:eventId', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.eventId)
    const { rows } = await query(`
      UPDATE runtime.event_subscribers
      SET last_processed_event_id = GREATEST(last_processed_event_id, $1),
          failure_count = 0,
          last_error = NULL,
          last_error_at = NULL,
          updated_at = NOW()
      WHERE name = $2
      RETURNING *
    `, [eventId, req.params.name])
    if (!rows.length) return res.status(404).json({ error: 'Subscriber not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// ─── Notifications: inbox ─────────────────────────────────────────────────────

router.get('/notifications', async (req, res, next) => {
  try {
    const userId     = req.userId
    const cursor     = req.query.cursor ? Number(req.query.cursor) : null
    const unreadOnly = req.query.unread_only === 'true'
    const limit      = Math.min(Number(req.query.limit) || 50, 200)

    const params = [userId]
    let where = 'WHERE user_id = $1'
    if (cursor)     { params.push(cursor); where += ` AND id < $${params.length}` }
    if (unreadOnly) { where += ' AND read_at IS NULL' }
    params.push(limit)

    const { rows } = await query(`
      SELECT id, event_id, work_item_id, event_type, reasons, summary, read_at, created_at
      FROM runtime.notifications
      ${where}
      ORDER BY id DESC
      LIMIT $${params.length}
    `, params)

    const next_cursor = rows.length === limit ? rows[rows.length - 1].id : null

    const { rows: counts } = await query(
      `SELECT COUNT(*)::int AS n FROM runtime.notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    )
    res.json({ rows, next_cursor, unread_count: counts[0].n })
  } catch (err) { next(err) }
})

// ─── Notifications: mark-read ─────────────────────────────────────────────────

router.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE runtime.notifications SET read_at = now()
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [req.params.id, req.userId]
    )
    res.json({ updated: rowCount })
  } catch (err) { next(err) }
})

router.post('/notifications/mark-read', async (req, res, next) => {
  try {
    const { ids, work_item_id, event_type, older_than } = req.body || {}
    const params = [req.userId]
    const conds = ['user_id = $1', 'read_at IS NULL']
    if (Array.isArray(ids) && ids.length) {
      params.push(ids); conds.push(`id = ANY($${params.length})`)
    }
    if (work_item_id) {
      params.push(work_item_id); conds.push(`work_item_id = $${params.length}`)
    }
    if (event_type) {
      params.push(event_type); conds.push(`event_type = $${params.length}`)
    }
    if (older_than) {
      params.push(older_than); conds.push(`created_at < $${params.length}`)
    }
    const { rowCount } = await query(
      `UPDATE runtime.notifications SET read_at = now() WHERE ${conds.join(' AND ')}`,
      params,
    )
    res.json({ updated: rowCount })
  } catch (err) { next(err) }
})

// ─── Notifications: preferences ───────────────────────────────────────────────

router.get('/notification-preferences', async (req, res, next) => {
  try {
    const uid = req.userId
    const [defaults, overrides, channels] = await Promise.all([
      query('SELECT * FROM blueprint.notification_defaults'),
      query('SELECT * FROM blueprint.user_notification_overrides WHERE user_id = $1', [uid]),
      query('SELECT channel, is_enabled, digest, next_digest_at, config FROM blueprint.user_notification_channels WHERE user_id = $1', [uid]),
    ])
    res.json({
      defaults: defaults.rows,
      overrides: overrides.rows,
      channels:  channels.rows,
    })
  } catch (err) { next(err) }
})

router.put('/notification-preferences', async (req, res, next) => {
  const uid = req.userId
  const { overrides, channels } = req.body || {}

  const client = await getClient()
  try {
    await client.query('BEGIN')
    if (Array.isArray(overrides)) {
      await client.query('DELETE FROM blueprint.user_notification_overrides WHERE user_id = $1', [uid])
      for (const o of overrides) {
        await client.query(
          `INSERT INTO blueprint.user_notification_overrides (user_id, relationship_type, event_type, enabled)
           VALUES ($1,$2,$3,$4)`,
          [uid, o.relationship_type, o.event_type, !!o.enabled]
        )
      }
    }
    if (Array.isArray(channels)) {
      for (const ch of channels) {
        const isEnabled = !!ch.is_enabled
        await client.query(
          `INSERT INTO blueprint.user_notification_channels
             (user_id, channel, is_enabled, digest, config)
           VALUES ($1,$2,$3,$4,$5::jsonb)
           ON CONFLICT (user_id, channel) DO UPDATE
           SET is_enabled = EXCLUDED.is_enabled,
               digest     = EXCLUDED.digest,
               config     = EXCLUDED.config`,
          [uid, ch.channel, isEnabled, ch.digest || 'realtime', JSON.stringify(ch.config || {})]
        )
      }
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: e.message })
  } finally { client.release() }
})

// ─── Notifications: admin delivery inspect + retry ────────────────────────────

router.get('/notification-deliveries', async (req, res, next) => {
  try {
    const { rows: userRows } = await query(
      'SELECT is_admin FROM blueprint.users WHERE id = $1', [req.userId]
    )
    if (!userRows[0]?.is_admin) return res.status(403).json({ error: 'admin-only' })
    const status = req.query.status || 'failed'
    const { rows } = await query(
      `SELECT d.*, n.user_id, n.summary
       FROM runtime.notification_deliveries d
       JOIN runtime.notifications n ON n.id = d.notification_id
       WHERE d.status = $1
       ORDER BY d.id DESC LIMIT 200`,
      [status]
    )
    res.json({ rows })
  } catch (err) { next(err) }
})

router.post('/notification-deliveries/:id/retry', async (req, res, next) => {
  try {
    const { rows: userRows } = await query(
      'SELECT is_admin FROM blueprint.users WHERE id = $1', [req.userId]
    )
    if (!userRows[0]?.is_admin) return res.status(403).json({ error: 'admin-only' })
    const { rowCount } = await query(
      `UPDATE runtime.notification_deliveries
       SET status='pending', attempt_count=0, next_attempt_at=now(), last_error=NULL
       WHERE id=$1`,
      [req.params.id]
    )
    res.json({ updated: rowCount })
  } catch (err) { next(err) }
})

// Event firehose (latest N events)
router.get('/events', async (req, res, next) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit) || 100, 500)
    const typeLike = req.query.type_prefix ? `${req.query.type_prefix}%` : null
    const { rows } = await query(`
      SELECT id, event_type, entity_id, entity_uri, actor_id, occurred_at, payload
      FROM runtime.events
      ${typeLike ? 'WHERE event_type LIKE $2' : ''}
      ORDER BY id DESC
      LIMIT $1
    `, typeLike ? [limit, typeLike] : [limit])
    res.json({ rows, count: rows.length })
  } catch (err) { next(err) }
})

// =============================================================================
// SEARCH v1 — structured filter search + saved filters
// =============================================================================

router.get('/search/fields', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const catalog = await buildFieldCatalog({ userId: ctx.userId, orgIds: ctx.orgIds })
    res.json({
      translator_available: !!process.env.ANTHROPIC_API_KEY,
      native: catalog.native,
      custom: catalog.custom,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.get('/search', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const { keyword, type_id, org_id, assignee_id, stage_class, priority, type_name,
            sort_by, sort_dir, created_after, created_before } = req.query
    const hasFilters = keyword || type_id || type_name || org_id || assignee_id ||
                       stage_class || priority || created_after || created_before
    if (!hasFilters) return res.json({ rows: [], next_before: null })

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200)
    const before = req.query.before ? parseInt(req.query.before, 10) : null
    const include = (req.query.include || '').split(',').map(s => s.trim()).filter(Boolean)

    const params = []
    const where = []

    if (!ctx.isAdmin) {
      params.push(ctx.orgIds)
      where.push(`wi.owner_org_id = ANY($${params.length})`)
    }

    params.push(90)
    where.push(`(wi.resolved_at IS NULL OR wi.resolved_at > NOW() - INTERVAL '1 day' * $${params.length})`)

    if (keyword) {
      const tsq = buildPrefixTsquery(keyword)
      if (tsq) {
        params.push(tsq)
        where.push(`wis.search_doc @@ to_tsquery('english', $${params.length})`)
      }
    }

    if (type_id) {
      params.push(parseInt(type_id, 10))
      where.push(`wi.work_item_type_id = $${params.length}`)
    }

    if (type_name) {
      params.push(type_name)
      where.push(`wi.work_item_type_id IN (SELECT id FROM blueprint.work_item_types WHERE LOWER(name) = LOWER($${params.length}))`)
    }

    if (org_id) {
      params.push(parseInt(org_id, 10))
      where.push(`wi.owner_org_id = $${params.length}`)
    }

    if (assignee_id) {
      const uid = assignee_id === 'me' ? ctx.userId : parseInt(assignee_id, 10)
      params.push(uid)
      where.push(`rel_owns.user_id = $${params.length}`)
    }

    if (stage_class) {
      params.push(stage_class)
      where.push(`s.stage_class = $${params.length}`)
    }

    if (priority) {
      params.push(parseInt(priority, 10))
      where.push(`wi.priority = $${params.length}`)
    }

    const SORT_COLS = { created_at: 'wi.created_at', updated_at: 'wi.updated_at', priority: 'wi.priority', due_date: 'wi.due_date' }
    const RELATIVE_DATE_RE = /^(\d+)d$/

    function pushDateFilter(v, col, op) {
      const rel = RELATIVE_DATE_RE.exec(v)
      if (rel) {
        params.push(parseInt(rel[1], 10))
        where.push(`${col} ${op} NOW() - ($${params.length} * INTERVAL '1 day')`)
        return
      }
      const ts = Date.parse(v)
      if (!isNaN(ts)) {
        params.push(new Date(ts).toISOString())
        where.push(`${col} ${op} $${params.length}::timestamptz`)
      }
    }

    if (created_after)  pushDateFilter(created_after,  'wi.created_at', '>=')
    if (created_before) pushDateFilter(created_before, 'wi.created_at', '<')

    if (before) {
      params.push(before)
      where.push(`wi.id < $${params.length}`)
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    params.push(limit + 1)
    const sql = `
      SELECT wi.id, wi.display_key, wi.title, wi.priority, wi.tags,
             wi.due_date, wi.is_expedited, wi.updated_at, wi.resolved_at, wi.created_at,
             wi.owner_org_id,
             s.name AS status, s.stage_class,
             o.slug AS org_slug, o.name AS org_name,
             wit.name AS type_name, wit.icon AS type_icon, wit.color AS type_color,
             wi.current_substate AS substate,
             rel_owns.user_id AS owner_user_id,
             u.email AS assignee_email, u.display_name AS assignee_name
      FROM runtime.work_items wi
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      JOIN blueprint.organizations o ON o.id = wi.owner_org_id
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.workflows w ON w.id = wi.workflow_id
      LEFT JOIN runtime.work_item_user_relationships rel_owns
        ON rel_owns.work_item_id = wi.id AND rel_owns.relationship_type = 'owns'
      LEFT JOIN blueprint.users u ON u.id = rel_owns.user_id
      LEFT JOIN runtime.work_item_search wis ON wis.work_item_id = wi.id
      ${whereClause}
      ORDER BY ${SORT_COLS[sort_by] ?? 'wi.priority'} ${sort_dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, wi.updated_at DESC
      LIMIT $${params.length}
    `.trim()

    const result = await query(sql, params)
    let rows = result.rows
    let nextBefore = null
    if (rows.length > limit) {
      rows = rows.slice(0, limit)
      nextBefore = rows[rows.length - 1].id
    }

    if (keyword && include.includes('snippet') && rows.length > 0) {
      const tsquery = buildPrefixTsquery(keyword)
      if (tsquery) {
        const ids = rows.map(r => r.id)
        const headlinesRes = await query(`
          SELECT wis.work_item_id, ts_headline('english',
            wis.title_text || ' ' || wis.description_text || ' ' || wis.custom_text || ' ' || wis.comments_text,
            to_tsquery('english', $1),
            'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5'
          ) AS snippet
          FROM runtime.work_item_search wis
          WHERE wis.work_item_id = ANY($2)
        `, [tsquery, ids])
        const map = new Map(headlinesRes.rows.map(r => [r.work_item_id, r.snippet]))
        rows = rows.map(r => ({ ...r, snippet: map.get(r.id) }))
      }
    }

    res.json({ rows, next_before: nextBefore })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.post('/search/translate', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const { prompt } = req.body || {}
    if (typeof prompt !== 'string') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'prompt is required' })
    }
    const result = await nlTranslate({
      prompt,
      userContext: { userId: ctx.userId, orgIds: ctx.orgIds },
    })
    res.json(result)
  } catch (err) {
    if (err.code === 'PROMPT_TOO_LONG')        return res.status(400).json({ error: err.code, message: err.message, max_chars: err.max_chars })
    if (err.code === 'TRANSLATION_FAILED')     return res.status(400).json({ error: err.code, message: err.message, raw_response: req.userId && err.raw_response ? err.raw_response : undefined })
    if (err.code === 'RATE_LIMITED')           return res.status(429).json({ error: err.code, message: err.message, retry_after_seconds: err.retry_after_seconds })
    if (err.code === 'TRANSLATOR_UNAVAILABLE') return res.status(501).json({ error: err.code, message: err.message })
    if (err.code === 'TRANSLATOR_UPSTREAM')    return res.status(503).json({ error: err.code, message: err.message })
    if (err.code === 'BUDGET_EXHAUSTED')       return res.status(503).json({ error: err.code, message: err.message })
    if (err.code === 'TRANSLATOR_TIMEOUT')     return res.status(504).json({ error: err.code, message: err.message })
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

// =============================================================================
// SAVED FILTERS
// =============================================================================

async function loadSavedFilter(id) {
  const r = await query('SELECT * FROM blueprint.saved_filters WHERE id = $1', [id])
  return r.rows[0] || null
}

router.get('/saved-filters', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const scope = req.query.scope || 'all'
    const orgIdParam = req.query.org_id ? parseInt(req.query.org_id, 10) : null

    const conditions = []
    const params = []
    if (scope === 'mine') {
      params.push(ctx.userId)
      conditions.push(`sf.owner_user_id = $${params.length}`)
    } else if (scope === 'org') {
      params.push(ctx.orgIds.length ? ctx.orgIds : [-1])
      conditions.push(`(sf.share_scope = 'org' AND sf.owner_org_id = ANY($${params.length}))`)
      if (orgIdParam) {
        params.push(orgIdParam)
        conditions.push(`sf.owner_org_id = $${params.length}`)
      }
    } else if (scope === 'global') {
      conditions.push(`sf.share_scope = 'global'`)
    } else {
      params.push(ctx.userId)
      params.push(ctx.orgIds.length ? ctx.orgIds : [-1])
      conditions.push(`(sf.owner_user_id = $${params.length - 1}
                       OR (sf.share_scope = 'org' AND sf.owner_org_id = ANY($${params.length}))
                       OR sf.share_scope = 'global')`)
    }

    const r = await query(`
      SELECT sf.*, u.email AS owner_email, u.display_name AS owner_name,
             o.slug AS org_slug, o.name AS org_name
      FROM blueprint.saved_filters sf
      JOIN blueprint.users u ON u.id = sf.owner_user_id
      LEFT JOIN blueprint.organizations o ON o.id = sf.owner_org_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY sf.share_scope, sf.name
    `, params)

    res.json({
      rows: r.rows.map(f => ({
        ...f,
        is_owner: f.owner_user_id === ctx.userId,
        can_edit: canEditFilter(f, ctx),
      }))
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.get('/saved-filters/:id', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const f = await loadSavedFilter(parseInt(req.params.id, 10))
    if (!f || !canViewFilter(f, ctx)) {
      return res.status(404).json({ error: 'NOT_FOUND' })
    }
    res.json({ ...f, is_owner: f.owner_user_id === ctx.userId, can_edit: canEditFilter(f, ctx) })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.post('/saved-filters', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const { name, filter_params, share_scope, owner_org_id, sort_spec, column_spec, description } = req.body || {}
    if (!name || !filter_params || !share_scope) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'name, filter_params, share_scope required' })
    }
    if (typeof filter_params !== 'object' || Array.isArray(filter_params)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'filter_params must be an object' })
    }
    if (!['private', 'org', 'global'].includes(share_scope)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'share_scope must be private, org, or global' })
    }
    if (share_scope === 'org' && !owner_org_id) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'owner_org_id required for org scope' })
    }
    if (share_scope === 'global' && !ctx.isAdmin) {
      return res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS', message: 'global filters require admin' })
    }
    if (share_scope === 'org' && !ctx.orgIds.includes(owner_org_id)) {
      return res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS', message: 'must be member of target org' })
    }

    let uriSlug = 'system'
    if (share_scope === 'org') {
      const orgRes = await query('SELECT slug FROM blueprint.organizations WHERE id = $1', [owner_org_id])
      uriSlug = orgRes.rows[0]?.slug || 'system'
    }
    const uri = generateUri(uriSlug, 'saved-filters')

    const r = await query(`
      INSERT INTO blueprint.saved_filters
        (uri, name, filter_params, owner_user_id, share_scope, owner_org_id, sort_spec, column_spec, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [uri, name, JSON.stringify(filter_params), ctx.userId, share_scope,
        share_scope === 'org' ? owner_org_id : null,
        sort_spec || {}, column_spec || {}, description || null])
    res.status(201).json(r.rows[0])
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.patch('/saved-filters/:id', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const f = await loadSavedFilter(parseInt(req.params.id, 10))
    if (!f) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canEditFilter(f, ctx)) {
      return res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS' })
    }

    const fields = ['name','share_scope','owner_org_id','sort_spec','column_spec','description']
    const sets = []
    const params = []
    for (const k of fields) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) {
        params.push(req.body[k])
        sets.push(`${k} = $${params.length}`)
      }
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'filter_params')) {
      if (typeof req.body.filter_params !== 'object' || Array.isArray(req.body.filter_params)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'filter_params must be an object' })
      }
      params.push(JSON.stringify(req.body.filter_params))
      sets.push(`filter_params = $${params.length}`)
    }
    if (sets.length === 0) return res.json(f)

    sets.push(`updated_at = NOW()`)
    params.push(f.id)
    const r = await query(`UPDATE blueprint.saved_filters SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params)
    res.json(r.rows[0])
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

router.delete('/saved-filters/:id', async (req, res, next) => {
  try {
    const ctx = await getUserSearchContext(req)
    const f = await loadSavedFilter(parseInt(req.params.id, 10))
    if (!f) return res.status(404).json({ error: 'NOT_FOUND' })
    if (!canEditFilter(f, ctx)) {
      return res.status(403).json({ error: 'INSUFFICIENT_PERMISSIONS' })
    }
    await query('DELETE FROM blueprint.saved_filters WHERE id = $1', [f.id])
    res.json({ deleted: true, id: f.id })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

// ─── Context Entries ─────────────────────────────────────────────────────────

router.get('/work-items/:id/context-entries', async (req, res, next) => {
  try {
    const types = req.query.types ? req.query.types.split(',') : undefined
    const rows  = await listContextEntries(parseInt(req.params.id, 10), { types })
    res.json({ rows, count: rows.length })
  } catch (err) { next(err) }
})

router.post('/work-items/:id/context-entries', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id, 10)
    const { rows: wiRows } = await query('SELECT id FROM runtime.work_items WHERE id = $1', [workItemId])
    if (!wiRows.length) return res.status(404).json({ error: 'Work item not found' })
    const { type, title, content, visibility, tags } = req.body
    if (!type || !content) return res.status(400).json({ error: 'type and content required' })
    const entry = await createContextEntry(workItemId, {
      type, title, content, visibility, tags,
      authorId: req.userId,
    })
    res.status(201).json(entry)
  } catch (err) { next(err) }
})

router.patch('/work-items/:id/context-entries/:entryId', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id, 10)
    const entryId   = parseInt(req.params.entryId, 10)
    // Fetch existing entry scoped to this work item first (authz + existence check)
    const { rows: existing } = await query(
      'SELECT id, author_id FROM runtime.context_entries WHERE id = $1 AND work_item_id = $2',
      [entryId, workItemId],
    )
    if (!existing.length) return res.status(404).json({ error: 'Not found' })
    if (existing[0].author_id !== req.userId && !req.isAdmin)
      return res.status(403).json({ error: 'Only the author or an admin can edit this entry' })
    const entry = await updateContextEntry(entryId, workItemId, req.body)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    res.json(entry)
  } catch (err) { next(err) }
})

router.delete('/work-items/:id/context-entries/:entryId', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id, 10)
    const entryId   = parseInt(req.params.entryId, 10)
    // Fetch existing entry scoped to this work item first (authz + existence check)
    const { rows: existing } = await query(
      'SELECT id, author_id FROM runtime.context_entries WHERE id = $1 AND work_item_id = $2',
      [entryId, workItemId],
    )
    if (!existing.length) return res.status(404).json({ error: 'Not found' })
    if (existing[0].author_id !== req.userId && !req.isAdmin)
      return res.status(403).json({ error: 'Only the author or an admin can delete this entry' })
    const deleted = await deleteContextEntry(entryId, workItemId)
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    res.json({ deleted: true, id: entryId })
  } catch (err) { next(err) }
})

// Resolve a decision entry. Any authenticated org member may resolve (NOT author-only:
// decisions are frequently agent-authored with no author_id, and resolution is a
// workflow act, not an edit of one's own note). Records the answer + attribution + ts.
router.post('/work-items/:id/context-entries/:entryId/resolve', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id, 10)
    const entryId    = parseInt(req.params.entryId, 10)
    const entry = await resolveDecisionEntry(entryId, workItemId, {
      resolutionText: req.body.resolution_text,
      resolvedBy:     req.userId,
    })
    if (!entry) return res.status(404).json({ error: 'Decision entry not found' })
    res.json(entry)
  } catch (err) { next(err) }
})

// Reopen a resolved decision entry. Clears the resolution columns; the prior answer
// remains in the decision_resolved event payload (history lives in the event log).
router.post('/work-items/:id/context-entries/:entryId/reopen', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id, 10)
    const entryId    = parseInt(req.params.entryId, 10)
    const entry = await reopenDecisionEntry(entryId, workItemId, { reopenedBy: req.userId })
    if (!entry) return res.status(404).json({ error: 'Resolved decision entry not found' })
    res.json(entry)
  } catch (err) { next(err) }
})

router.get('/work-items/:id/assembled-context', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id, 10)
    if (isNaN(workItemId)) return res.status(400).json({ error: 'Invalid work item id' })
    const { rows: wiRows } = await query(
      'SELECT owner_org_id FROM runtime.work_items WHERE id = $1',
      [workItemId],
    )
    if (!wiRows.length) return res.status(404).json({ error: 'Work item not found' })
    const orgId = wiRows[0].owner_org_id

    const pullTypes = req.query.pull_types ? req.query.pull_types.split(',') : []
    const orgTypes  = req.query.org_types  ? req.query.org_types.split(',')  : []
    if (req.query.include_ancestors === 'true') pullTypes.push('ancestors')

    const meta = { context: { pull: pullTypes, org: orgTypes } }
    const ctx  = await assembleContext(workItemId, orgId, meta)
    const context = formatContextForPrompt(ctx)

    res.json({ context, workItemId, orgId })
  } catch (err) { next(err) }
})

// Session context — board snapshot for agent/tool orientation at session start.
// Returns active items, queued items, recently-done (7 days), and open decisions
// on active/queued work items. All in one round-trip.
router.get('/organizations/:orgId/session-context', async (req, res, next) => {
  try {
    const orgId = parseInt(req.params.orgId, 10)
    if (isNaN(orgId)) return res.status(400).json({ error: 'Invalid org id' })

    // Org-membership gate: user must belong to this org (admins bypass)
    const userRow = await query('SELECT is_admin FROM blueprint.users WHERE id = $1', [req.userId])
    const isAdmin = !!userRow.rows[0]?.is_admin
    if (!isAdmin) {
      const memb = await query(
        'SELECT 1 FROM blueprint.org_memberships WHERE org_id = $1 AND user_id = $2 AND is_active = true',
        [orgId, req.userId]
      )
      if (!memb.rows.length) return res.status(403).json({ error: 'Forbidden' })
    }

    const [activeResult, queuedResult, doneResult, decisionsResult] = await Promise.all([
      query(`
        SELECT wi.id, wi.display_key, wi.title, wi.priority, wi.current_substate,
               wi.updated_at, wi.started_at,
               s.name AS stage_name, s.stage_class,
               wit.name AS type_name, wit.icon AS type_icon
        FROM runtime.work_items wi
        JOIN blueprint.stages s   ON s.id  = wi.current_stage_id
        JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
        WHERE wi.owner_org_id = $1
          AND wi.spawn_state = 'active'
          AND s.stage_class = 'active'
        ORDER BY wi.priority ASC, wi.updated_at DESC
        LIMIT 20
      `, [orgId]),
      query(`
        SELECT wi.id, wi.display_key, wi.title, wi.priority, wi.current_substate,
               wi.updated_at,
               s.name AS stage_name, s.stage_class,
               wit.name AS type_name, wit.icon AS type_icon
        FROM runtime.work_items wi
        JOIN blueprint.stages s   ON s.id  = wi.current_stage_id
        JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
        WHERE wi.owner_org_id = $1
          AND wi.spawn_state = 'active'
          AND s.stage_class = 'queued'
        ORDER BY wi.priority ASC, wi.updated_at DESC
        LIMIT 5
      `, [orgId]),
      query(`
        SELECT wi.id, wi.display_key, wi.title, wi.priority,
               wi.resolved_at, s.name AS stage_name,
               wit.name AS type_name, wit.icon AS type_icon
        FROM runtime.work_items wi
        JOIN blueprint.stages s   ON s.id  = wi.current_stage_id
        JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
        WHERE wi.owner_org_id = $1
          AND wi.spawn_state = 'done'
          AND wi.resolved_at > NOW() - INTERVAL '7 days'
        ORDER BY wi.resolved_at DESC
        LIMIT 10
      `, [orgId]),
      query(`
        SELECT ce.id, ce.work_item_id, ce.title, ce.content, ce.created_at,
               wi.display_key, wi.title AS work_item_title
        FROM runtime.context_entries ce
        JOIN runtime.work_items wi ON wi.id = ce.work_item_id
        JOIN blueprint.stages s    ON s.id  = wi.current_stage_id
        WHERE wi.owner_org_id = $1
          AND ce.type = 'decision'
          AND ce.resolved = false
          AND s.stage_class IN ('active', 'queued')
        ORDER BY ce.created_at ASC
        LIMIT 20
      `, [orgId]),
    ])

    res.json({
      active:         activeResult.rows,
      queued:         queuedResult.rows,
      recently_done:  doneResult.rows,
      open_decisions: decisionsResult.rows,
    })
  } catch (err) { next(err) }
})

// Org Context Library
router.get('/organizations/:orgId/context', async (req, res, next) => {
  try {
    const types = req.query.types ? req.query.types.split(',') : undefined
    const rows = await listOrgContext(parseInt(req.params.orgId), { types })
    res.json({ rows, count: rows.length })
  } catch (err) { next(err) }
})
router.post('/organizations/:orgId/context', async (req, res, next) => {
  try {
    const { type, title, content, tags } = req.body
    if (!type || !title || !content) return res.status(400).json({ error: 'type, title, content required' })
    const row = await createOrgContext(parseInt(req.params.orgId), { type, title, content, tags, authorId: req.session?.userId })
    res.status(201).json(row)
  } catch (err) { next(err) }
})
router.patch('/organizations/:orgId/context/:id', async (req, res, next) => {
  try {
    const row = await updateOrgContext(parseInt(req.params.id), parseInt(req.params.orgId), req.body)
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json(row)
  } catch (err) { next(err) }
})
router.delete('/organizations/:orgId/context/:id', async (req, res, next) => {
  try {
    const deleted = await deleteOrgContext(parseInt(req.params.id), parseInt(req.params.orgId))
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    res.json({ deleted: true, id: parseInt(req.params.id) })
  } catch (err) { next(err) }
})

// Stage Playbooks
router.get('/stages/:stageId/playbook', async (req, res, next) => {
  try {
    const rows = await listPlaybooks({ stageId: parseInt(req.params.stageId) })
    res.json({ rows })
  } catch (err) { next(err) }
})
router.post('/stages/:stageId/playbook', async (req, res, next) => {
  try {
    const { name, content } = req.body
    if (!name || !content) return res.status(400).json({ error: 'name and content required' })
    const row = await createPlaybook({ stageId: parseInt(req.params.stageId), name, content })
    res.status(201).json(row)
  } catch (err) { next(err) }
})
router.patch('/organizations/:orgId/playbooks/:id', async (req, res, next) => {
  try {
    const { name, content, isActive, execution_owner } = req.body
    if (execution_owner !== undefined && !['in_server', 'agent'].includes(execution_owner)) {
      return res.status(400).json({ error: 'execution_owner must be "in_server" or "agent"' })
    }
    const row = await updatePlaybook(
      parseInt(req.params.id),
      parseInt(req.params.orgId),
      { name, content, isActive, executionOwner: execution_owner },
    )
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json(row)
  } catch (err) { next(err) }
})
router.delete('/organizations/:orgId/playbooks/:id', async (req, res, next) => {
  try {
    const deleted = await deletePlaybook(parseInt(req.params.id), parseInt(req.params.orgId))
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    res.json({ deleted: true, id: parseInt(req.params.id) })
  } catch (err) { next(err) }
})

// Org AI Models
router.get('/organizations/:orgId/ai-models', async (req, res, next) => {
  try {
    res.json({ rows: await listOrgAiModels(parseInt(req.params.orgId)) })
  } catch (err) { next(err) }
})
router.post('/organizations/:orgId/ai-models', async (req, res, next) => {
  try {
    const { rows: userRows } = await query('SELECT is_admin FROM blueprint.users WHERE id = $1', [req.userId])
    if (!userRows[0]?.is_admin) return res.status(403).json({ error: 'admin-only' })
    const { name, provider, model, apiKey } = req.body
    if (!name || !model) return res.status(400).json({ error: 'name and model required' })
    const row = await createOrgAiModel(parseInt(req.params.orgId), { name, provider, model, apiKey })
    res.status(201).json(row)
  } catch (err) { next(err) }
})
router.patch('/organizations/:orgId/ai-models/:id', async (req, res, next) => {
  try {
    const { rows: userRows } = await query('SELECT is_admin FROM blueprint.users WHERE id = $1', [req.userId])
    if (!userRows[0]?.is_admin) return res.status(403).json({ error: 'admin-only' })
    const { name, provider, model, apiKey, isActive } = req.body
    const row = await updateOrgAiModel(parseInt(req.params.id), parseInt(req.params.orgId), { name, provider, model, apiKey, isActive })
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json(row)
  } catch (err) { next(err) }
})
router.delete('/organizations/:orgId/ai-models/:id', async (req, res, next) => {
  try {
    const { rows: userRows } = await query('SELECT is_admin FROM blueprint.users WHERE id = $1', [req.userId])
    if (!userRows[0]?.is_admin) return res.status(403).json({ error: 'admin-only' })
    const deleted = await deleteOrgAiModel(parseInt(req.params.id), parseInt(req.params.orgId))
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    res.json({ deleted: true, id: parseInt(req.params.id) })
  } catch (err) { next(err) }
})

// Playbook AI Assistant
router.post('/organizations/:orgId/playbooks/ai-assist', async (req, res, next) => {
  try {
    const { playbookContent, message } = req.body
    const orgId = parseInt(req.params.orgId)
    if (!orgId || !message) return res.status(400).json({ error: 'orgId and message required' })

    const cfg = await resolveModelConfig(orgId, 'default')
    if (!cfg || !cfg.apiKey) return res.status(400).json({ error: 'No default AI model configured for this org' })

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: cfg.apiKey })

    const systemPrompt = `You are an expert at writing Gladius stage playbooks.
A playbook is a markdown file with YAML frontmatter that tells a stage's AI agent what context to pull and what to write back.

Frontmatter fields:
- trigger: on_enter | on_exit | manual
- model: name from org_ai_models (e.g. "fast", "default")
- context.pull: list of {type, traverse} — pull context entries by type, optionally traversing ancestors
- context.org: list of org context types to inject (e.g. [architecture, domain])
- context.write: list of entry types the agent may write back

Available context entry types: nfr, discovery, acceptance, design, decision, note, test-plan, playbook
Available traversal: ancestors (pull from parent items too)

The playbook body (below the frontmatter) is natural language instructions for the AI agent.
${playbookContent ? `\nCurrent playbook:\n\`\`\`markdown\n${playbookContent}\n\`\`\`` : ''}`

    const resp = await client.messages.create({
      model: cfg.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    }, { timeout: 30_000 })

    res.json({ reply: resp.content[0]?.text || '' })
  } catch (err) { next(err) }
})

// =============================================================================
// PLAYBOOK RUNS
// =============================================================================

router.get('/work-items/:id/playbook-runs', async (req, res, next) => {
  try {
    const workItemId = parseInt(req.params.id, 10)
    // Org-membership gate: user must belong to the org that owns the work item
    const result = await query(
      `SELECT
         pr.id,
         pr.stage_id,
         s.name         AS stage_name,
         pr.playbook_id,
         pr.status,
         pr.model,
         pr.input_tokens,
         pr.output_tokens,
         pr.stop_reason,
         pr.entries_written,
         pr.error_message,
         pr.started_at,
         pr.completed_at
       FROM runtime.playbook_runs pr
       JOIN blueprint.stages s ON s.id = pr.stage_id
       JOIN runtime.work_items wi ON wi.id = pr.work_item_id
       JOIN blueprint.org_memberships om
         ON om.org_id = wi.owner_org_id
        AND om.user_id = $2
        AND om.is_active = true
       WHERE pr.work_item_id = $1
       ORDER BY pr.started_at DESC`,
      [workItemId, req.userId]
    )
    res.json({ runs: result.rows })
  } catch (err) { next(err) }
})

// =============================================================================
// MCP TOOL REFERENCE
// =============================================================================

import { TOOLS as MCP_TOOLS } from '../mcp/toolsManifest.js'

router.get('/mcp/tools', async (req, res) => {
  res.json({ tools: MCP_TOOLS })
})

export default router
