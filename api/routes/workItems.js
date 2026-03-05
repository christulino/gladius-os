/**
 * api/routes/workItems.js
 * Work item REST routes.
 *
 * GET    /v1/work-items/:uri        — get a work item
 * GET    /v1/work-items/:uri/hierarchy — get full hierarchy tree
 * POST   /v1/work-items             — create a work item
 * PATCH  /v1/work-items/:uri        — update fields
 * POST   /v1/work-items/:uri/transition — execute a stage transition
 */

import { Router }               from 'express'
import { getWorkItemHierarchy } from '../../graph/hierarchy.js'
import { query }                from '../../db/postgres.js'

const router = Router()

/**
 * GET /v1/work-items/:uri
 * Returns a single work item with its current stage and user relationships.
 */
router.get('/:uri(*)', async (req, res, next) => {
  try {
    const uri = decodeURIComponent(req.params.uri)

    const result = await query(`
      SELECT
        wi.*,
        s.name       AS current_stage_name,
        s.stage_class AS current_stage_class,
        sc.name      AS service_class_name
      FROM runtime.work_items wi
      LEFT JOIN blueprint.stages s        ON s.id = wi.current_stage_id
      LEFT JOIN blueprint.service_classes sc ON sc.id = wi.service_class_id
      WHERE wi.uri = $1
    `, [uri])

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Work item not found' })
    }

    // Fetch user relationships for this item
    const relationships = await query(`
      SELECT u.uri AS user_uri, u.display_name, wiur.relationship_type, wiur.assigned_at
      FROM runtime.work_item_user_relationships wiur
      JOIN blueprint.users u ON u.id = wiur.user_id
      WHERE wiur.work_item_id = $1 AND wiur.is_active = true
    `, [result.rows[0].id])

    res.json({
      ...result.rows[0],
      relationships: relationships.rows,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /v1/work-items/:uri/hierarchy
 * Returns the full work item hierarchy tree (ancestors, siblings, descendants, spawned, blocking).
 * Permission filtered — restricted nodes returned as placeholders.
 */
router.get('/:uri(*)/hierarchy', async (req, res, next) => {
  try {
    const uri    = decodeURIComponent(req.params.uri)
    const userId = req.user?.id || 1 // TODO: replace with auth middleware

    const hierarchy = await getWorkItemHierarchy(uri, userId)
    res.json(hierarchy)
  } catch (err) {
    if (err.message.includes('Access denied')) {
      return res.status(403).json({ error: err.message })
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message })
    }
    next(err)
  }
})

/**
 * POST /v1/work-items/:uri/transition
 * Execute a stage transition on a work item.
 *
 * Body: { to_stage_id, reason? }
 */
router.post('/:uri(*)/transition', async (req, res, next) => {
  try {
    const uri          = decodeURIComponent(req.params.uri)
    const { to_stage_id, reason } = req.body

    if (!to_stage_id) {
      return res.status(400).json({ error: 'to_stage_id is required' })
    }

    // TODO: implement full transition module
    // For now return a placeholder
    res.status(501).json({
      message: 'Transition module not yet implemented',
      uri,
      to_stage_id,
      reason,
    })
  } catch (err) {
    next(err)
  }
})

export default router
