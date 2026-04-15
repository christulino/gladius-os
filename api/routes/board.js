/**
 * api/routes/board.js
 * Board query routes.
 *
 * GET /v1/board/:orgUri  — get Kanban board data for an org
 */

import { Router }      from 'express'
import { getBoardData } from '../../board/boardQuery.js'

const router = Router()

/**
 * GET /v1/board/:orgUri
 *
 * Query params:
 *   workflow_id        — filter to specific workflow
 *   include_descendants — include sub-org work items (default: true)
 *   sla_status         — comma-separated: at_risk,breached
 *   service_class_ids  — comma-separated IDs
 *
 * Returns: full 2D board grid structure
 */
router.get('/:orgUri(*)', async (req, res, next) => {
  try {
    const userId = req.userId

    const orgUri = decodeURIComponent(req.params.orgUri)

    const filters = {}
    if (req.query.sla_status) {
      filters.sla_status = req.query.sla_status.split(',')
    }
    if (req.query.service_class_ids) {
      filters.service_class_ids = req.query.service_class_ids.split(',').map(Number)
    }
    if (req.query.work_item_type_ids) {
      filters.work_item_type_ids = req.query.work_item_type_ids.split(',').map(Number)
    }
    if (req.query.due_before) {
      filters.due_before = req.query.due_before
    }

    const board = await getBoardData({
      orgUri,
      workflowId:         req.query.workflow_id ? Number(req.query.workflow_id) : null,
      userId,
      filters,
      includeDescendants: req.query.include_descendants !== 'false',
    })

    res.json(board)
  } catch (err) {
    next(err)
  }
})

export default router
