/**
 * graph/hierarchy.js
 * Work Item Detail View — hierarchy navigator.
 *
 * Resolves the full work item tree centered on a focus item:
 *   - Parent chain (ancestors up to permission boundary or root)
 *   - Siblings (peer items sharing the same parent)
 *   - All descendants (any depth — decomposed + spawned)
 *   - Cross-org spawned items (both directions)
 *   - Blocking relationships
 *
 * Neo4j resolves which items exist and how they relate.
 * PostgreSQL fetches full property data for each item.
 * Permission filtering applied at each node before returning.
 *
 * Usage:
 *   import { getWorkItemHierarchy } from '../graph/hierarchy.js'
 *
 *   const tree = await getWorkItemHierarchy('flowos://org/work-items/uuid', userId)
 */

import { runQuery } from '../db/neo4j.js'
import { query }    from '../db/postgres.js'
import { canAccess } from '../core/access.js'

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

  const canSeeFocus = await canAccess(userId, 'work_item', focusItem.id, 'view')
  if (!canSeeFocus) throw new Error(`[hierarchy] Access denied to work item: ${workItemUri}`)

  // Run all five hierarchy queries in parallel
  const [ancestors, siblings, descendants, spawned, blocking] = await Promise.all([
    queryAncestors(workItemUri),
    querySiblings(workItemUri),
    queryDescendants(workItemUri),
    querySpawned(workItemUri),
    queryBlocking(workItemUri),
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
// NEO4J QUERIES (HN-1 through HN-5)
// =============================================================================

/**
 * HN-1: Parent chain — all ancestors ordered by distance.
 */
async function queryAncestors(workItemUri) {
  return runQuery(`
    MATCH path = (ancestor:WorkItem)-[:DECOMPOSES_INTO*]->(focus:WorkItem {uri: $uri})
    WITH ancestor, length(path) AS depth
    ORDER BY depth DESC
    RETURN
      ancestor.uri             AS uri,
      ancestor.title           AS title,
      ancestor.current_stage_class AS stage_class,
      ancestor.sla_status      AS sla_status,
      ancestor.spawn_state     AS spawn_state,
      ancestor.owner_org_uri   AS owner_org_uri,
      ancestor.service_class   AS service_class,
      depth
  `, { uri: workItemUri })
}

/**
 * HN-2: Siblings — peer items sharing the same parent.
 */
async function querySiblings(workItemUri) {
  return runQuery(`
    MATCH (parent:WorkItem)-[:DECOMPOSES_INTO]->(focus:WorkItem {uri: $uri})
    MATCH (parent)-[:DECOMPOSES_INTO]->(sibling:WorkItem)
    WHERE sibling.uri <> $uri
    RETURN
      sibling.uri              AS uri,
      sibling.title            AS title,
      sibling.current_stage_class AS stage_class,
      sibling.sla_status       AS sla_status,
      sibling.spawn_state      AS spawn_state,
      sibling.owner_org_uri    AS owner_org_uri,
      sibling.service_class    AS service_class,
      'sibling'                AS relationship_kind
  `, { uri: workItemUri })
}

/**
 * HN-3: All descendants — decomposed + spawned, any depth.
 * Returns relationship_kind to distinguish DECOMPOSES_INTO vs SPAWNED for UI styling.
 */
async function queryDescendants(workItemUri) {
  return runQuery(`
    MATCH (focus:WorkItem {uri: $uri})-[r:DECOMPOSES_INTO|SPAWNED*]->(descendant:WorkItem)
    RETURN
      descendant.uri             AS uri,
      descendant.title           AS title,
      descendant.current_stage_class AS stage_class,
      descendant.sla_status      AS sla_status,
      descendant.spawn_state     AS spawn_state,
      descendant.owner_org_uri   AS owner_org_uri,
      descendant.service_class   AS service_class,
      type(last(r))              AS relationship_kind,
      length(r)                  AS depth
  `, { uri: workItemUri })
}

/**
 * HN-4: Cross-org spawned items — both inbound and outbound.
 */
async function querySpawned(workItemUri) {
  const outbound = await runQuery(`
    MATCH (focus:WorkItem {uri: $uri})-[:SPAWNED]->(spawned:WorkItem)
    RETURN
      spawned.uri            AS uri,
      spawned.title          AS title,
      spawned.current_stage_class AS stage_class,
      spawned.spawn_state    AS spawn_state,
      spawned.owner_org_uri  AS owner_org_uri,
      spawned.service_class  AS service_class,
      'outbound'             AS direction
  `, { uri: workItemUri })

  const inbound = await runQuery(`
    MATCH (origin:WorkItem)-[:SPAWNED]->(focus:WorkItem {uri: $uri})
    RETURN
      origin.uri             AS uri,
      origin.title           AS title,
      origin.current_stage_class AS stage_class,
      origin.spawn_state     AS spawn_state,
      origin.owner_org_uri   AS owner_org_uri,
      origin.service_class   AS service_class,
      'inbound'              AS direction
  `, { uri: workItemUri })

  return [...outbound, ...inbound]
}

/**
 * HN-5: Blocking relationships — items blocking this one and items this one blocks.
 * Only returns active (non-terminal) blockers.
 */
async function queryBlocking(workItemUri) {
  const blockingMe = await runQuery(`
    MATCH (blocker:WorkItem)-[:BLOCKS]->(focus:WorkItem {uri: $uri})
    WHERE blocker.spawn_state <> 'done' AND blocker.spawn_state <> 'cancelled'
    RETURN
      blocker.uri            AS uri,
      blocker.title          AS title,
      blocker.current_stage_class AS stage_class,
      blocker.sla_status     AS sla_status,
      blocker.owner_org_uri  AS owner_org_uri,
      'blocking_me'          AS direction
  `, { uri: workItemUri })

  const iAmBlocking = await runQuery(`
    MATCH (focus:WorkItem {uri: $uri})-[:BLOCKS]->(blocked:WorkItem)
    RETURN
      blocked.uri            AS uri,
      blocked.title          AS title,
      blocked.current_stage_class AS stage_class,
      blocked.sla_status     AS sla_status,
      blocked.owner_org_uri  AS owner_org_uri,
      'i_am_blocking'        AS direction
  `, { uri: workItemUri })

  return [...blockingMe, ...iAmBlocking]
}

// =============================================================================
// PERMISSION FILTERING + POSTGRES ENRICHMENT
// =============================================================================

/**
 * For each node returned by Neo4j:
 *   - Check canAccess()
 *   - If allowed: fetch full data from PostgreSQL and return
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

    // Item not found in PostgreSQL (sync lag or deleted) — treat as restricted
    if (!workItem) {
      return { restricted: true, reason: 'not_found', depth: node.depth, nodeRole }
    }

    const allowed = await canAccess(userId, 'work_item', workItem.id, 'view')

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

    // Merge Neo4j traversal metadata with full PostgreSQL data
    return {
      ...workItem,
      depth:             node.depth,
      relationship_kind: node.relationship_kind, // DECOMPOSES_INTO vs SPAWNED
      direction:         node.direction,          // inbound/outbound for spawned
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
      wi.sla_status, wi.due_date,
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
