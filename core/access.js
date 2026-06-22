/**
 * core/access.js
 * Universal visibility rule evaluator — canAccess()
 *
 * One function, one table (blueprint.visibility_rules), controls access
 * to every resource in the system. No explicit org-to-org relationships.
 * Scales to any org size — zero rows needed per new org added.
 *
 * Rules are evaluated in priority order (lower number = first).
 * First matching rule wins. Default (no rules) = members only.
 * DENY rules can carve out exceptions from broad ALLOW rules.
 *
 * Usage:
 *   import { canAccess, filterAccessible } from '../core/access.js'
 *
 *   const allowed = await canAccess(userId, 'work_item', workItemUri, 'view')
 *   const visible = await filterAccessible(userId, 'service_catalog_item', itemUris, 'request')
 */

import { query } from '../db/postgres.js'

/**
 * Check if a user can perform an action on a resource.
 *
 * @param {number} userId         - blueprint.users.id
 * @param {string} resourceType   - 'service_catalog_item'|'work_item_type'|'org'|'workflow'
 * @param {number} resourceId     - ID of the resource in its PostgreSQL table
 * @param {string} permissionType - 'view'|'request'|'use'
 * @returns {Promise<boolean>}
 */
export async function canAccess(userId, resourceType, resourceId, permissionType) {
  // Fetch user's org memberships and roles (needed for rule evaluation)
  const userContext = await getUserContext(userId)

  // Fetch applicable visibility rules for this resource, ordered by priority
  const rulesResult = await query(`
    SELECT scope_type, tag_key, tag_value, role_id, effect
    FROM blueprint.visibility_rules
    WHERE resource_type = $1
      AND resource_id   = $2
      AND permission_type IN ($3, 'view')   -- 'request' also implies 'view'
      AND is_active = true
    ORDER BY priority ASC
  `, [resourceType, resourceId, permissionType])

  const rules = rulesResult.rows

  // No rules defined — default is members_only
  if (!rules.length) {
    return isOrgMember(userContext, await getResourceOwnerOrgId(resourceType, resourceId))
  }

  // Evaluate rules in priority order — first match wins
  for (const rule of rules) {
    const matches = await evaluateRule(rule, userContext, resourceType, resourceId)
    if (matches) {
      return rule.effect === 'allow'
    }
  }

  // No rules matched — deny by default
  return false
}

/**
 * Filter a list of resource IDs to only those the user can access.
 * More efficient than calling canAccess() in a loop for large sets.
 *
 * @param {number}   userId
 * @param {string}   resourceType
 * @param {number[]} resourceIds
 * @param {string}   permissionType
 * @returns {Promise<number[]>} Subset of resourceIds the user can access
 */
export async function filterAccessible(userId, resourceType, resourceIds, permissionType) {
  if (!resourceIds.length) return []

  const results = await Promise.all(
    resourceIds.map(async id => ({
      id,
      allowed: await canAccess(userId, resourceType, id, permissionType)
    }))
  )

  return results.filter(r => r.allowed).map(r => r.id)
}

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Load user's org memberships and roles.
 * Cached per request in production — here fetched fresh each call.
 *
 * @param {number} userId
 * @returns {Promise<Object>} { orgIds, roleIds, orgRoleMap }
 */
async function getUserContext(userId) {
  const result = await query(`
    SELECT
      om.org_id,
      om.role_id AS primary_role_id,
      ARRAY_AGG(DISTINCT omr.role_id) FILTER (WHERE omr.role_id IS NOT NULL) AS additional_role_ids,
      o.uri AS org_uri,
      r.name AS role_name
    FROM blueprint.org_memberships om
    JOIN blueprint.organizations o ON o.id = om.org_id
    JOIN blueprint.roles r ON r.id = om.role_id
    LEFT JOIN blueprint.org_membership_roles omr ON omr.org_membership_id = om.id AND omr.is_active = true
    WHERE om.user_id = $1
      AND om.is_active = true
    GROUP BY om.org_id, om.role_id, o.uri, r.name
  `, [userId])

  const orgIds    = result.rows.map(r => r.org_id)
  const orgUris   = result.rows.map(r => r.org_uri)
  const roleIds   = [...new Set(result.rows.flatMap(r => [
    r.primary_role_id,
    ...(r.additional_role_ids || [])
  ].filter(Boolean)))]

  // Map: orgId → [roleIds]
  const orgRoleMap = {}
  for (const row of result.rows) {
    orgRoleMap[row.org_id] = [row.primary_role_id, ...(row.additional_role_ids || [])].filter(Boolean)
  }

  return { orgIds, orgUris, roleIds, orgRoleMap }
}

/**
 * Evaluate a single visibility rule against the user's context.
 *
 * @param {Object} rule        - Rule row from blueprint.visibility_rules
 * @param {Object} userContext - From getUserContext()
 * @param {string} resourceType
 * @param {number} resourceId
 * @returns {Promise<boolean>} Whether this rule matches
 */
async function evaluateRule(rule, userContext, resourceType, resourceId) {
  const ownerOrgId = await getResourceOwnerOrgId(resourceType, resourceId)

  switch (rule.scope_type) {

    case 'members_only':
      return isOrgMember(userContext, ownerOrgId)

    case 'all_authenticated':
      return true

    case 'direct_children': {
      // User is member of the owner org OR a direct child org
      const childOrgIds = await getDirectChildOrgIds(ownerOrgId)
      return userContext.orgIds.some(id => id === ownerOrgId || childOrgIds.includes(id))
    }

    case 'all_descendants': {
      // User is member of owner org or any descendant org
      const descendantOrgUris = await getDescendantOrgUrisById(ownerOrgId)
      return userContext.orgUris.some(uri => descendantOrgUris.includes(uri))
          || isOrgMember(userContext, ownerOrgId)
    }

    case 'siblings': {
      // User is member of an org with the same parent as the owner org
      const siblingOrgIds = await getSiblingOrgIds(ownerOrgId)
      return userContext.orgIds.some(id => siblingOrgIds.includes(id))
    }

    case 'ancestor_members': {
      // User is member of any ancestor org of the owner org
      const ancestorOrgUris = await getAncestorOrgUris(ownerOrgId)
      return userContext.orgUris.some(uri => ancestorOrgUris.includes(uri))
    }

    case 'same_depth': {
      // User is member of an org at the same depth as the owner org
      const ownerDepth = await getOrgDepth(ownerOrgId)
      const userOrgDepths = await getOrgDepths(userContext.orgIds)
      return userOrgDepths.some(d => d === ownerDepth)
    }

    case 'tag_match': {
      // User is member of an org tagged with the rule's tag_key:tag_value
      if (!rule.tag_key || !rule.tag_value) return false
      const taggedOrgIds = await getOrgsWithTag(rule.tag_key, rule.tag_value)
      return userContext.orgIds.some(id => taggedOrgIds.includes(id))
    }

    case 'role_in_org': {
      // User has the specified role in the owner org
      if (!rule.role_id) return false
      const orgRoles = userContext.orgRoleMap[ownerOrgId] || []
      return orgRoles.includes(rule.role_id)
    }

    case 'role_in_ancestor': {
      // User has the specified role in any ancestor org
      if (!rule.role_id) return false
      const ancestorOrgIds = await getAncestorOrgIds(ownerOrgId)
      return ancestorOrgIds.some(ancestorId => {
        const roles = userContext.orgRoleMap[ancestorId] || []
        return roles.includes(rule.role_id)
      })
    }

    default:
      console.warn(`[access] Unknown scope_type: "${rule.scope_type}" — skipping rule`)
      return false
  }
}

// --- Org tree helpers (PostgreSQL) ---

function isOrgMember(userContext, orgId) {
  return userContext.orgIds.includes(orgId)
}

async function getResourceOwnerOrgId(resourceType, resourceId) {
  const tableMap = {
    service_catalog_item: 'blueprint.service_catalog_items',
    work_item_type:        'blueprint.work_item_types',
    org:                   'blueprint.organizations',
    workflow:              'blueprint.workflows',
  }
  const table = tableMap[resourceType]
  if (!table) throw new Error(`[access] Unknown resource type: ${resourceType}`)

  const col = resourceType === 'org' ? 'id' : 'owner_org_id'
  const result = await query(`SELECT ${col} AS org_id FROM ${table} WHERE id = $1`, [resourceId])
  return result.rows[0]?.org_id || null
}

async function getDirectChildOrgIds(orgId) {
  const result = await query(
    'SELECT id FROM blueprint.organizations WHERE parent_id = $1 AND is_active = true',
    [orgId]
  )
  return result.rows.map(r => r.id)
}

async function getSiblingOrgIds(orgId) {
  const result = await query(
    'SELECT id FROM blueprint.organizations WHERE parent_id = (SELECT parent_id FROM blueprint.organizations WHERE id = $1) AND id <> $1 AND is_active = true',
    [orgId]
  )
  return result.rows.map(r => r.id)
}

async function getAncestorOrgIds(orgId) {
  const result = await query(`
    WITH RECURSIVE ancestors AS (
      SELECT parent_id AS id FROM blueprint.organizations WHERE id = $1
      UNION ALL
      SELECT o.parent_id FROM blueprint.organizations o JOIN ancestors a ON o.id = a.id
      WHERE o.parent_id IS NOT NULL
    )
    SELECT id FROM ancestors WHERE id IS NOT NULL
  `, [orgId])
  return result.rows.map(r => r.id)
}

async function getAncestorOrgUris(orgId) {
  const result = await query(`
    WITH RECURSIVE ancestors AS (
      SELECT parent_id AS id FROM blueprint.organizations WHERE id = $1
      UNION ALL
      SELECT o.parent_id FROM blueprint.organizations o JOIN ancestors a ON o.id = a.id
      WHERE o.parent_id IS NOT NULL
    )
    SELECT o.uri FROM ancestors a JOIN blueprint.organizations o ON o.id = a.id WHERE a.id IS NOT NULL
  `, [orgId])
  return result.rows.map(r => r.uri)
}

async function getOrgDepth(orgId) {
  const result = await query('SELECT depth FROM blueprint.organizations WHERE id = $1', [orgId])
  return result.rows[0]?.depth ?? 0
}

async function getOrgDepths(orgIds) {
  if (!orgIds.length) return []
  const result = await query(
    'SELECT depth FROM blueprint.organizations WHERE id = ANY($1)',
    [orgIds]
  )
  return result.rows.map(r => r.depth)
}

async function getOrgsWithTag(tagKey, tagValue) {
  const result = await query(
    'SELECT org_id FROM blueprint.org_tags WHERE tag_key = $1 AND tag_value = $2',
    [tagKey, tagValue]
  )
  return result.rows.map(r => r.org_id)
}

// PostgreSQL recursive CTE for descendant org URIs (Neo4j removed)
async function getDescendantOrgUrisById(orgId) {
  const result = await query(`
    WITH RECURSIVE descendants AS (
      SELECT id, uri FROM blueprint.organizations WHERE id = $1
      UNION ALL
      SELECT o.id, o.uri FROM blueprint.organizations o
      JOIN descendants d ON o.parent_id = d.id
      WHERE o.is_active = true
    )
    SELECT uri FROM descendants WHERE id <> $1
  `, [orgId])
  return result.rows.map(r => r.uri)
}

export default { canAccess, filterAccessible }
