/**
 * graph/hierarchy.js
 * Work Item Detail View — hierarchy navigator.
 *
 * Resolves the full work item tree centered on a focus item:
 *   - Parent chain (ancestors up to permission boundary or root)
 *   - Siblings (peer items sharing the same parent)
 *   - All descendants (any depth — decomposed + spawned)
 *   - Cross-org spawned items (both directions, via origin_work_item_id)
 *   - Blocking relationships (via runtime.work_item_links)
 *
 * All traversals use PostgreSQL recursive CTEs against runtime.work_items
 * and runtime.work_item_links — Neo4j removed.
 * Permission filtering applied at each node before returning.
 *
 * Usage:
 *   import { getWorkItemHierarchy } from '../graph/hierarchy.js'
 *
 *   const tree = await getWorkItemHierarchy('flowos://org/work-items/uuid', userId)
 */

import { query } from '../db/postgres.js'

/**
 * Get the full hierarchy for a work item, permission-filtered.
 *
 * @param {string} workItemUri - URI of the focus work item
 * @param {number} userId      - blueprint.users.id of the requesting user
 * @returns {Promise<Object>}  Hierarchy tree centered on the focus item
 */
export async function getWorkItemHierarchy(workItemUri, userId) {
  // Verify the user can see the focus item itself first
  const focusItem = await getWorkItemByUri(workItemUri)
  if (!focusItem) throw new Error(`[hierarchy] Work item not found: ${workItemUri}`)

  const canSeeFocus = await canViewWorkItem(userId, focusItem)
  if (!canSeeFocus) throw new Error(`[hierarchy] Access denied to work item: ${workItemUri}`)

  // Run all five hierarchy queries in parallel
  const [ancestors, siblings, descendants, spawned, blocking] = await Promise.all([
    queryAncestors(focusItem.id),
    querySiblings(focusItem.id, focusItem.parent_id),
    queryDescendants(focusItem.id),
    querySpawned(focusItem.id),
    queryBlocking(focusItem.id),
  ])

  // Permission-filter each result set
  const [
    filteredAncestors,
    filteredSiblings,
    filteredDescendants,
    filteredSpawned,
    filteredBlocking,
  ] = await Promise.all([
    filterAndEnrich(ancestors,   userId, 'ancestor'),
    filterAndEnrich(siblings,    userId, 'sibling'),
    filterAndEnrich(descendants, userId, 'descendant'),
    filterAndEnrich(spawned,     userId, 'spawned'),
    filterAndEnrich(blocking,    userId, 'blocking'),
  ])

  return {
    focus:       focusItem,
    ancestors:   filteredAncestors,
    siblings:    filteredSiblings,
    descendants: filteredDescendants,
    spawned:     filteredSpawned,
    blocking:    filteredBlocking,
  }
}

// =============================================================================
// POSTGRESQL QUERIES (HP-1 through HP-5)
// =============================================================================

/**
 * HP-1: Parent chain — all ancestors ordered by distance (root first).
 *
 * @param {number} workItemId - numeric PK of the focus item
 * @returns {Promise<{uri: string, depth: number}[]>}
 */
async function queryAncestors(workItemId) {
  const result = await query(`
    WITH RECURSIVE ancestors AS (
      SELECT p.id, p.uri, p.parent_id, 1 AS depth
      FROM runtime.work_items focus
      JOIN runtime.work_items p ON p.id = focus.parent_id
      WHERE focus.id = $1

      UNION ALL

      SELECT p.id, p.uri, p.parent_id, a.depth + 1
      FROM runtime.work_items p
      JOIN ancestors a ON p.id = a.parent_id
    )
    SELECT uri, depth FROM ancestors ORDER BY depth DESC
  `, [workItemId])
  return result.rows
}

/**
 * HP-2: Siblings — peer items sharing the same parent.
 * Returns empty array if the focus item has no parent.
 *
 * @param {number} workItemId - numeric PK of the focus item
 * @param {number|null} parentId - parent_id of the focus item (null = top-level)
 * @returns {Promise<{uri: string}[]>}
 */
async function querySiblings(workItemId, parentId) {
  if (!parentId) return []
  const result = await query(`
    SELECT uri
    FROM runtime.work_items
    WHERE parent_id = $1 AND id <> $2
  `, [parentId, workItemId])
  return result.rows
}

/**
 * HP-3: All descendants — any depth, via parent_id chain.
 *
 * @param {number} workItemId - numeric PK of the focus item
 * @returns {Promise<{uri: string, depth: number, relationship_kind: string}[]>}
 */
async function queryDescendants(workItemId) {
  const result = await query(`
    WITH RECURSIVE descendants AS (
      SELECT wi.id, wi.uri, 1 AS depth
      FROM runtime.work_items wi
      WHERE wi.parent_id = $1

      UNION ALL

      SELECT wi.id, wi.uri, d.depth + 1
      FROM runtime.work_items wi
      JOIN descendants d ON wi.parent_id = d.id
    )
    SELECT uri, depth, 'child' AS relationship_kind FROM descendants
  `, [workItemId])
  return result.rows
}

/**
 * HP-4: Spawned items — cross-org relationships via origin_work_item_id.
 *   outbound: items that were spawned FROM this item
 *   inbound:  the item that spawned this item (if any)
 *
 * @param {number} workItemId - numeric PK of the focus item
 * @returns {Promise<{uri: string, direction: string}[]>}
 */
async function querySpawned(workItemId) {
  const [outResult, inResult] = await Promise.all([
    query(`
      SELECT uri, 'outbound' AS direction
      FROM runtime.work_items
      WHERE origin_work_item_id = $1
    `, [workItemId]),
    query(`
      SELECT origin.uri, 'inbound' AS direction
      FROM runtime.work_items focus
      JOIN runtime.work_items origin ON origin.id = focus.origin_work_item_id
      WHERE focus.id = $1 AND focus.origin_work_item_id IS NOT NULL
    `, [workItemId]),
  ])
  return [...outResult.rows, ...inResult.rows]
}

/**
 * HP-5: Blocking relationships via runtime.work_item_links (link_type = 'blocks').
 *   blocking_me:   active items that block this item
 *   i_am_blocking: items this item blocks (active or not)
 *
 * @param {number} workItemId - numeric PK of the focus item
 * @returns {Promise<{uri: string, direction: string}[]>}
 */
async function queryBlocking(workItemId) {
  const [blockingMe, iAmBlocking] = await Promise.all([
    query(`
      SELECT wi.uri, 'blocking_me' AS direction
      FROM runtime.work_item_links l
      JOIN runtime.work_items wi ON wi.id = l.source_work_item_id
      WHERE l.target_work_item_id = $1
        AND l.link_type = 'blocks'
        AND wi.spawn_state NOT IN ('done', 'cancelled')
    `, [workItemId]),
    query(`
      SELECT wi.uri, 'i_am_blocking' AS direction
      FROM runtime.work_item_links l
      JOIN runtime.work_items wi ON wi.id = l.target_work_item_id
      WHERE l.source_work_item_id = $1
        AND l.link_type = 'blocks'
    `, [workItemId]),
  ])
  return [...blockingMe.rows, ...iAmBlocking.rows]
}

// =============================================================================
// PERMISSION FILTERING + POSTGRES ENRICHMENT
// =============================================================================

/**
 * Check whether a user can view a work item.
 * Admins can see all items. Other users must be a member of the owner org.
 *
 * @param {number} userId
 * @param {Object} workItem - must have owner_org_id
 * @returns {Promise<boolean>}
 */
async function canViewWorkItem(userId, workItem) {
  const userRow = await query(
    'SELECT is_admin FROM blueprint.users WHERE id = $1',
    [userId]
  )
  if (userRow.rows[0]?.is_admin) return true

  const memberRow = await query(
    'SELECT 1 FROM blueprint.org_memberships WHERE org_id = $1 AND user_id = $2 AND is_active = true',
    [workItem.owner_org_id, userId]
  )
  return memberRow.rows.length > 0
}

/**
 * For each node returned by the PG queries:
 *   - Fetch full work item data from PostgreSQL by URI
 *   - Check canAccess()
 *   - If allowed: return full item data merged with traversal metadata
 *   - If denied: return a restricted placeholder
 *     { restricted: true, depth } — tells the UI "something is here but you can't see it"
 *
 * @param {Object[]} nodes
 * @param {number}   userId
 * @param {string}   nodeRole - 'ancestor'|'sibling'|'descendant'|'spawned'|'blocking'
 * @returns {Promise<Object[]>}
 */
async function filterAndEnrich(nodes, userId, nodeRole) {
  return Promise.all(nodes.map(async node => {
    const workItem = await getWorkItemByUri(node.uri)

    // Item not found (deleted between query and enrichment) — treat as restricted
    if (!workItem) {
      return { restricted: true, reason: 'not_found', depth: node.depth, nodeRole }
    }

    const allowed = await canViewWorkItem(userId, workItem)

    if (!allowed) {
      // Return placeholder — tells UI "something exists here, you can't see it"
      // NEVER silently drop — broken-looking trees destroy user trust
      return {
        restricted: true,
        reason: 'permission_denied',
        depth: node.depth,
        nodeRole,
        relationship_kind: node.relationship_kind,
        direction: node.direction,
      }
    }

    return {
      ...workItem,
      depth:             node.depth,
      relationship_kind: node.relationship_kind,
      direction:         node.direction,
      nodeRole,
      restricted:        false,
    }
  }))
}

/**
 * Fetch a work item's full data from PostgreSQL by URI.
 *
 * @param {string} uri
 * @returns {Promise<Object|null>}
 */
async function getWorkItemByUri(uri) {
  const result = await query(`
    SELECT
      wi.id, wi.uri, wi.title, wi.description,
      wi.work_item_type_id, wi.owner_org_id,
      wi.current_stage_id, wi.current_substate,
      wi.spawn_state, wi.service_class_id,
      wi.due_date,
      wi.parent_id, wi.origin_work_item_id,
      wi.field_values, wi.entered_current_stage_at,
      wi.created_at, wi.updated_at,
      s.name  AS current_stage_name,
      s.stage_class AS current_stage_class,
      sc.name AS service_class_name
    FROM runtime.work_items wi
    LEFT JOIN blueprint.stages s  ON s.id = wi.current_stage_id
    LEFT JOIN blueprint.service_classes sc ON sc.id = wi.service_class_id
    WHERE wi.uri = $1
  `, [uri])

  return result.rows[0] || null
}

export default { getWorkItemHierarchy }
