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
import { writeFile }  from 'fs/promises'
import { mkdir }      from 'fs/promises'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const router = Router()

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
  // runtime
  'runtime.work_items':                      'runtime',
  'runtime.stage_transition_history':        'runtime',
  'runtime.work_item_user_relationships':    'runtime',
  'runtime.work_item_comments':              'runtime',
  'runtime.evidence':                        'runtime',
  'runtime.notifications':                   'runtime',
  'runtime.flow_metrics_snapshots':          'runtime',
  'runtime.search_index_queue':              'runtime',
  'runtime.transition_action_log':           'runtime',
  'runtime.work_item_links':                'runtime',
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
        o.is_active, o.created_at,
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
    const { name, description, org_type, parent_id, is_active } = req.body
    const fields = []
    const vals   = []
    if (name        !== undefined) { fields.push(`name = $${fields.length + 1}`);        vals.push(name.trim()) }
    if (description !== undefined) { fields.push(`description = $${fields.length + 1}`); vals.push(description || null) }
    if (org_type    !== undefined) { fields.push(`org_type = $${fields.length + 1}`);    vals.push(org_type) }
    if (parent_id   !== undefined) { fields.push(`parent_id = $${fields.length + 1}`);   vals.push(parent_id || null) }
    if (is_active   !== undefined) { fields.push(`is_active = $${fields.length + 1}`);   vals.push(is_active === true || is_active === 'true') }
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
      ORDER BY w.id ASC
    `)

    const stages = await query(`
      SELECT s.*, w.name AS workflow_name,
        (SELECT COUNT(*) FROM blueprint.stage_transitions st WHERE st.from_stage_id = s.id) AS outbound_transitions,
        (SELECT COUNT(*) FROM blueprint.exit_criteria ec WHERE ec.stage_id = s.id AND ec.is_active = true) AS exit_criteria_count
      FROM blueprint.stages s
      JOIN blueprint.workflows w ON w.id = s.workflow_id
      ORDER BY s.workflow_id ASC, s.display_order ASC
    `)

    const transitions = await query(`
      SELECT st.*,
        fs.name AS from_stage_name,
        ts.name AS to_stage_name
      FROM blueprint.stage_transitions st
      JOIN blueprint.stages fs ON fs.id = st.from_stage_id
      JOIN blueprint.stages ts ON ts.id = st.to_stage_id
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
// WORK ITEM TYPE CLASSES
// =============================================================================

router.get('/work-item-type-classes', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        c.id, c.uri, c.name, c.description, c.is_system_default, c.is_active,
        c.owner_org_id, o.name AS owner_org_name,
        c.default_workflow_id, w.name AS default_workflow_name,
        (SELECT COUNT(*) FROM blueprint.work_item_types wit WHERE wit.class_id = c.id) AS type_count
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
    const { name, description, request_mode, icon, color, is_published, is_active, key_prefix } = req.body
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

      // Copy class fields to type fields
      const classFields = await client.query(`
        SELECT field_key, field_label, field_type, field_options, field_group, is_required, display_order
        FROM blueprint.work_item_class_fields
        WHERE class_id = $1 AND is_active = true
        ORDER BY display_order ASC
      `, [class_id])

      for (const f of classFields.rows) {
        await client.query(`
          INSERT INTO blueprint.work_item_type_fields
            (work_item_type_id, field_key, field_label, field_type, field_options, field_group, is_required, display_order, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          ON CONFLICT DO NOTHING
        `, [witRow.id, f.field_key, f.field_label, f.field_type, f.field_options, f.field_group, f.is_required, f.display_order])
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
               sla_hours, wip_limit, is_active
        FROM blueprint.stages
        WHERE workflow_id = $1
        ORDER BY display_order ASC
      `, [req.params.id]),
      query(`
        SELECT id, from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason
        FROM blueprint.stage_transitions
        WHERE from_stage_id IN (
          SELECT id FROM blueprint.stages WHERE workflow_id = $1
        )
      `, [req.params.id]),
    ])

    // Attach from_stage_ids to each stage
    const stages = stagesResult.rows.map(stage => ({
      ...stage,
      from_stage_ids: transResult.rows
        .filter(t => t.to_stage_id === stage.id)
        .map(t => t.from_stage_id),
    }))

    res.json({ workflow: wf, stages, transitions: transResult.rows })
  } catch (err) { next(err) }
})

// POST /admin/api/workflows — create workflow with default stages
router.post('/workflows', async (req, res, next) => {
  try {
    const { name, description, owner_org_id } = req.body
    if (!name?.trim())   return res.status(400).json({ error: 'name is required' })
    if (!owner_org_id)   return res.status(400).json({ error: 'owner_org_id is required' })

    const orgResult = await query('SELECT slug FROM blueprint.organizations WHERE id = $1', [owner_org_id])
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
      `, [uri, name.trim(), description?.trim() || null, owner_org_id])
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

      const tUri = generateUri(orgResult.rows[0].slug, 'transitions')
      for (const t of defaultTransitions) {
        await client.query(`
          INSERT INTO blueprint.stage_transitions
            (uri, from_stage_id, to_stage_id, transition_label, transition_kind, requires_reason)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [tUri, stageIds[t.from], stageIds[t.to], t.label, t.kind, t.requires_reason ?? false])
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
      sla_hours, wip_limit,
      from_stage_ids,   // array of stage IDs that can transition TO this stage
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
          updated_at               = NOW()
        WHERE id = $11
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
        stageId,
      ])
      updatedStage = updateResult.rows[0]

      // Sync transitions (from_stage_ids)
      if (Array.isArray(from_stage_ids)) {
        await client.query('DELETE FROM blueprint.stage_transitions WHERE to_stage_id = $1', [stageId])
        const slug = stageResult.rows[0].slug
        for (const fromId of from_stage_ids) {
          const uri = generateUri(slug, 'transitions')
          await client.query(`
            INSERT INTO blueprint.stage_transitions (uri, from_stage_id, to_stage_id, transition_kind)
            VALUES ($1, $2, $3, 'forward')
            ON CONFLICT DO NOTHING
          `, [uri, fromId, stageId])
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

// DELETE /admin/api/stages/:id — deactivate stage (soft delete)
router.delete('/stages/:id', async (req, res, next) => {
  try {
    const result = await query(
      'UPDATE blueprint.stages SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Stage not found' })
    res.json({ deleted: result.rows[0].id })
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
             wit.request_mode, wit.is_system_default,
             c.name AS class_name, wit.owner_org_id, o.name AS owner_org_name
      FROM blueprint.work_item_types wit
      JOIN blueprint.work_item_type_classes c ON c.id = wit.class_id
      JOIN blueprint.organizations o          ON o.id = wit.owner_org_id
      WHERE wit.is_published = true AND wit.is_active = true
        AND (wit.is_system_default = true OR wit.owner_org_id = $1)
      ORDER BY wit.is_system_default DESC, c.name ASC, wit.name ASC
    `, [orgId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.get('/board', async (req, res, next) => {
  try {
    const orgId = parseInt(req.query.org_id)
    if (!orgId) return res.status(400).json({ error: 'org_id is required' })

    // Resolve org
    const orgResult = await query(
      'SELECT id, name, slug FROM blueprint.organizations WHERE id = $1 AND is_active = true',
      [orgId]
    )
    if (!orgResult.rows.length) return res.status(404).json({ error: 'Organization not found' })
    const org = orgResult.rows[0]

    // Resolve workflow — prefer org-owned, fall back to system default
    const workflowResult = await query(`
      SELECT w.id AS workflow_id, w.name AS workflow_name
      FROM blueprint.workflows w
      WHERE w.is_active = true
        AND (w.owner_org_id = $1 OR w.is_system_default = true)
      ORDER BY CASE WHEN w.owner_org_id = $1 THEN 0 ELSE 1 END ASC, w.id ASC
      LIMIT 1
    `, [orgId])

    if (!workflowResult.rows.length) {
      return res.json({ org, workflow_id: null, workflow_name: null, stages: [], items: [], service_classes: [] })
    }
    const { workflow_id, workflow_name } = workflowResult.rows[0]

    // Run stages, items, service classes, and org WIP limits in parallel
    const [stagesResult, itemsResult, scResult, wipResult] = await Promise.all([
      query(`
        SELECT id, name, stage_class, display_order, wip_limit, is_entry_stage, is_terminal, sla_hours
        FROM blueprint.stages
        WHERE workflow_id = $1 AND is_active = true
        ORDER BY display_order ASC
      `, [workflow_id]),
      query(`
        SELECT wi.id, wi.uri, wi.title, wi.spawn_state, wi.current_stage_id,
               wi.entered_current_stage_at, wi.updated_at, wi.display_key,
               wi.service_class_id, wi.description, wi.current_substate,
               wit.name AS work_item_type_name, wit.icon AS work_item_type_icon, wit.color AS work_item_type_color,
               s.name AS current_stage_name, s.stage_class AS current_stage_class,
               sc.name AS service_class_name, sc.color AS service_class_color
        FROM runtime.work_items wi
        JOIN blueprint.work_item_types wit     ON wit.id = wi.work_item_type_id
        JOIN blueprint.stages s                ON s.id   = wi.current_stage_id
        LEFT JOIN blueprint.service_classes sc ON sc.id  = wi.service_class_id
        WHERE wi.owner_org_id = $1 AND wi.spawn_state = 'active' AND s.workflow_id = $2
        ORDER BY wi.entered_current_stage_at ASC
      `, [orgId, workflow_id]),
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

    // Build WIP limits map keyed by stage_name
    const wipLimits = {}
    for (const row of wipResult.rows) {
      wipLimits[row.stage_name] = { wip_limit: row.wip_limit, enforcement_type: row.enforcement_type }
    }

    res.json({
      org,
      workflow_id,
      workflow_name,
      stages:          stagesResult.rows,
      items:           itemsResult.rows,
      service_classes: scResult.rows,
      wip_limits:      wipLimits,
    })
  } catch (err) { next(err) }
})

router.post('/work-items', async (req, res, next) => {
  try {
    const { title, work_item_type_id, owner_org_id, service_class_id, description } = req.body
    if (!title?.trim())       return res.status(400).json({ error: 'title is required' })
    if (!work_item_type_id)   return res.status(400).json({ error: 'work_item_type_id is required' })
    if (!owner_org_id)        return res.status(400).json({ error: 'owner_org_id is required' })

    const workItem = await createWorkItem({
      title:              title.trim(),
      work_item_type_id:  parseInt(work_item_type_id),
      owner_org_id:       parseInt(owner_org_id),
      service_class_id:   service_class_id ? parseInt(service_class_id) : undefined,
      description:        description?.trim() || undefined,
    }, 1 /* stub userId */)

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
      WHERE class_id = $1
      ORDER BY display_order ASC, id ASC
    `, [classId])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/class-fields', async (req, res, next) => {
  try {
    const { class_id, field_key, field_label, field_type, field_options, field_group, is_required, display_order } = req.body
    if (!class_id)            return res.status(400).json({ error: 'class_id is required' })
    if (!field_key?.trim())   return res.status(400).json({ error: 'field_key is required' })
    if (!field_label?.trim()) return res.status(400).json({ error: 'field_label is required' })
    if (!field_type?.trim())  return res.status(400).json({ error: 'field_type is required' })
    const result = await query(`
      INSERT INTO blueprint.work_item_class_fields
        (class_id, field_key, field_label, field_type, field_options, field_group, is_required, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [class_id, field_key.trim(), field_label.trim(), field_type.trim(),
        field_options ? JSON.stringify(field_options) : null,
        field_group?.trim() || null, is_required ?? false, display_order ?? 0])
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Field key already exists for this class' })
    next(err)
  }
})

router.patch('/class-fields/:id', async (req, res, next) => {
  try {
    const { field_label, field_type, field_options, field_group, is_required, display_order, is_active } = req.body
    const result = await query(`
      UPDATE blueprint.work_item_class_fields
      SET field_label   = COALESCE($1, field_label),
          field_type    = COALESCE($2, field_type),
          field_options = COALESCE($3, field_options),
          field_group   = COALESCE($4, field_group),
          is_required   = COALESCE($5, is_required),
          display_order = COALESCE($6, display_order),
          is_active     = COALESCE($7, is_active),
          updated_at    = NOW()
      WHERE id = $8
      RETURNING *
    `, [
      field_label?.trim() || null, field_type?.trim() || null,
      field_options ? JSON.stringify(field_options) : null,
      field_group !== undefined ? (field_group?.trim() || null) : null,
      is_required ?? null, display_order ?? null, is_active ?? null,
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
    if (!wip_limit || wip_limit < 1) return res.status(400).json({ error: 'wip_limit must be > 0' })
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

// GET /admin/api/work-items/search — search by title or display_key
router.get('/work-items/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ rows: [], count: 0 })
    const result = await query(`
      SELECT wi.id, wi.display_key, wi.title, s.name AS current_stage_name, o.name AS org_name
      FROM runtime.work_items wi
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      JOIN blueprint.organizations o ON o.id = wi.owner_org_id
      WHERE wi.title ILIKE $1 OR wi.display_key ILIKE $1
      ORDER BY wi.id DESC
      LIMIT 20
    `, [`%${q}%`])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

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
        wit.name AS work_item_type_name, wit.icon AS work_item_type_icon, wit.color AS work_item_type_color,
        wit.key_prefix,
        s.name AS current_stage_name, s.stage_class AS current_stage_class, s.is_terminal,
        sc.name AS service_class_name, sc.color AS service_class_color,
        o.name AS org_name, o.slug AS org_slug, o.id AS owner_org_id
      FROM runtime.work_items wi
      JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
      JOIN blueprint.stages s ON s.id = wi.current_stage_id
      JOIN blueprint.organizations o ON o.id = wi.owner_org_id
      LEFT JOIN blueprint.service_classes sc ON sc.id = wi.service_class_id
      WHERE wi.id = $1
    `, [req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Work item not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// PATCH /admin/api/work-items/:id — update title, description, field_values
router.patch('/work-items/:id', async (req, res, next) => {
  try {
    const { title, description, field_values } = req.body
    const fields = []
    const vals   = []
    if (title !== undefined)       { fields.push(`title = $${fields.length + 1}`);       vals.push(title.trim()) }
    if (description !== undefined) { fields.push(`description = $${fields.length + 1}`); vals.push(description || null) }
    if (field_values !== undefined) { fields.push(`field_values = $${fields.length + 1}`); vals.push(JSON.stringify(field_values)) }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' })
    fields.push(`updated_at = NOW()`)
    vals.push(parseInt(req.params.id))
    const result = await query(
      `UPDATE runtime.work_items SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Work item not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
})

// POST /admin/api/work-items/:id/substate — update substate
router.post('/work-items/:id/substate', async (req, res, next) => {
  try {
    const { substate } = req.body
    if (!['active', 'blocked'].includes(substate)) {
      return res.status(400).json({ error: 'substate must be "active" or "blocked"' })
    }
    const result = await query(`
      UPDATE runtime.work_items
      SET current_substate = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, current_substate
    `, [substate, req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Work item not found' })
    res.json(result.rows[0])
  } catch (err) { next(err) }
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

// POST /admin/api/work-items/:id/transition — execute transition
router.post('/work-items/:id/transition', async (req, res, next) => {
  try {
    const { to_stage_id, reason } = req.body
    if (!to_stage_id) return res.status(400).json({ error: 'to_stage_id is required' })
    const result = await executeTransition(
      parseInt(req.params.id),
      parseInt(to_stage_id),
      1, // stub userId
      { reason }
    )
    if (!result.success) return res.status(422).json({ error: result.error, details: result.details })
    res.json(result)
  } catch (err) { next(err) }
})

// =============================================================================
// COMMENTS
// =============================================================================

router.get('/work-items/:id/comments', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.id, c.body, c.parent_comment_id, c.is_system_generated, c.is_edited,
             c.created_at, c.updated_at,
             u.display_name AS author_name, u.avatar_url AS author_avatar
      FROM runtime.work_item_comments c
      LEFT JOIN blueprint.users u ON u.id = c.author_user_id
      WHERE c.work_item_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id])
    res.json({ rows: result.rows, count: result.rowCount })
  } catch (err) { next(err) }
})

router.post('/work-items/:id/comments', async (req, res, next) => {
  try {
    const { body, parent_comment_id } = req.body
    if (!body?.trim()) return res.status(400).json({ error: 'body is required' })
    const uri = generateUri('system', 'comments')
    const result = await query(`
      INSERT INTO runtime.work_item_comments (uri, work_item_id, author_user_id, body, parent_comment_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [uri, req.params.id, 1 /* stub userId */, body.trim(), parent_comment_id || null])

    // Update work item updated_at
    await query('UPDATE runtime.work_items SET updated_at = NOW() WHERE id = $1', [req.params.id])

    res.status(201).json(result.rows[0])
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
  try {
    const { user_id, relationship_type } = req.body
    if (!user_id)            return res.status(400).json({ error: 'user_id is required' })
    if (!relationship_type)  return res.status(400).json({ error: 'relationship_type is required' })
    const result = await query(`
      INSERT INTO runtime.work_item_user_relationships (work_item_id, user_id, relationship_type, assigned_at, is_active)
      VALUES ($1, $2, $3, NOW(), true)
      RETURNING *
    `, [req.params.id, user_id, relationship_type])
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Relationship already exists' })
    next(err)
  }
})

router.delete('/work-item-relationships/:id', async (req, res, next) => {
  try {
    const result = await query(
      'UPDATE runtime.work_item_user_relationships SET is_active = false WHERE id = $1 RETURNING id',
      [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Relationship not found' })
    res.json({ deleted: result.rows[0].id })
  } catch (err) { next(err) }
})

router.post('/work-items/:id/links', async (req, res, next) => {
  try {
    const { target_work_item_id, link_type } = req.body
    if (!target_work_item_id) return res.status(400).json({ error: 'target_work_item_id is required' })
    if (!link_type)           return res.status(400).json({ error: 'link_type is required' })

    const sourceId = parseInt(req.params.id)

    if (link_type === 'parent') {
      // Set target as parent of source
      await query('UPDATE runtime.work_items SET parent_id = $1, updated_at = NOW() WHERE id = $2', [target_work_item_id, sourceId])
      return res.json({ linked: true, link_type: 'parent' })
    }
    if (link_type === 'child') {
      // Set source as parent of target
      await query('UPDATE runtime.work_items SET parent_id = $1, updated_at = NOW() WHERE id = $2', [sourceId, target_work_item_id])
      return res.json({ linked: true, link_type: 'child' })
    }

    // "related" or other link types use the links table
    const result = await query(`
      INSERT INTO runtime.work_item_links (source_work_item_id, target_work_item_id, link_type, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [sourceId, target_work_item_id, link_type, 1 /* stub userId */])
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Link already exists' })
    next(err)
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

export default router
