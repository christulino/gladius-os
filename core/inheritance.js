/**
 * core/inheritance.js
 * Resolves inherited policies for orgs that don't define their own.
 *
 * Pattern: check own definition → check parent → check grandparent → system default
 * Applies to: workflows, work_item_types, service_catalog, business_calendar, roles
 *
 * Usage:
 *   import { resolveInheritedPolicy, resolveInheritedResource } from '../core/inheritance.js'
 *
 *   // Get the effective inheritance mode for workflows in this org
 *   const policy = await resolveInheritedPolicy(orgId, 'workflow')
 *   // → { org_id, resource_type, inheritance_mode: 'inherit_and_extend' }
 *
 *   // Get the full set of workflows available to this org (own + inherited)
 *   const workflows = await resolveInheritedResource(orgId, 'workflow')
 */

import { query } from '../db/postgres.js'

/**
 * Valid resource types that support inheritance.
 */
const INHERITABLE_TYPES = new Set([
  'workflow',
  'work_item_type',
  'service_catalog',
  'business_calendar',
  'role',
])

/**
 * Resolve the effective inheritance policy for a resource type in an org.
 * Walks up the org tree until a policy is found.
 * Default (no policy anywhere in chain): 'inherit_and_extend'
 *
 * @param {number} orgId        - blueprint.organizations.id
 * @param {string} resourceType - One of INHERITABLE_TYPES
 * @returns {Promise<Object>} Effective policy object
 */
export async function resolveInheritedPolicy(orgId, resourceType) {
  if (!INHERITABLE_TYPES.has(resourceType)) {
    throw new Error(`[inheritance] Unknown resource type: "${resourceType}". Valid: ${[...INHERITABLE_TYPES].join(', ')}`)
  }

  // Walk up the tree with recursive CTE, find nearest policy
  const result = await query(`
    WITH RECURSIVE org_chain AS (
      SELECT id, parent_id, 0 AS depth
      FROM blueprint.organizations
      WHERE id = $1

      UNION ALL

      SELECT o.id, o.parent_id, oc.depth + 1
      FROM blueprint.organizations o
      JOIN org_chain oc ON o.id = oc.parent_id
    )
    SELECT
      ip.org_id,
      ip.resource_type,
      ip.inheritance_mode,
      oc.depth AS found_at_depth
    FROM org_chain oc
    JOIN blueprint.inheritance_policies ip
      ON ip.org_id = oc.id
      AND ip.resource_type = $2
    ORDER BY oc.depth ASC
    LIMIT 1
  `, [orgId, resourceType])

  if (result.rows.length) {
    return result.rows[0]
  }

  // No policy found anywhere in the chain — return system default
  return {
    org_id: orgId,
    resource_type: resourceType,
    inheritance_mode: 'inherit_and_extend',
    found_at_depth: null,
    is_default: true,
  }
}

/**
 * Resolve the full set of a resource type available to an org,
 * respecting its inheritance policy.
 *
 * inheritance_mode behaviors:
 *   'own_only'          → return only resources owned by this org
 *   'inherit'           → return only resources from the nearest ancestor that defines them
 *   'inherit_and_extend'→ return own resources PLUS all ancestor resources (most common)
 *   'override'          → if org has any own resources, return only own; else inherit
 *
 * @param {number} orgId
 * @param {string} resourceType
 * @returns {Promise<Object[]>} Array of resource rows
 */
export async function resolveInheritedResource(orgId, resourceType) {
  const policy = await resolveInheritedPolicy(orgId, resourceType)

  switch (policy.inheritance_mode) {

    case 'own_only':
      return fetchOwnResources(orgId, resourceType)

    case 'inherit': {
      // Find nearest ancestor that has resources of this type
      const ancestorId = await findNearestAncestorWithResources(orgId, resourceType)
      if (!ancestorId) return []
      return fetchOwnResources(ancestorId, resourceType)
    }

    case 'inherit_and_extend': {
      // Collect all ancestor org IDs including self
      const orgChain = await getOrgChain(orgId)
      const allResources = []
      const seenUris = new Set()

      for (const chainOrgId of orgChain) {
        const resources = await fetchOwnResources(chainOrgId, resourceType)
        for (const r of resources) {
          if (!seenUris.has(r.uri)) {
            seenUris.add(r.uri)
            allResources.push({ ...r, inherited: chainOrgId !== orgId })
          }
        }
      }
      return allResources
    }

    case 'override': {
      const own = await fetchOwnResources(orgId, resourceType)
      if (own.length > 0) return own
      // Fall back to nearest ancestor
      const ancestorId = await findNearestAncestorWithResources(orgId, resourceType)
      if (!ancestorId) return []
      return fetchOwnResources(ancestorId, resourceType)
    }

    default:
      console.warn(`[inheritance] Unknown inheritance_mode: "${policy.inheritance_mode}"`)
      return fetchOwnResources(orgId, resourceType)
  }
}

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Fetch resources of a type owned directly by a specific org.
 */
async function fetchOwnResources(orgId, resourceType) {
  const tableMap = {
    workflow:          { table: 'blueprint.workflows',            col: 'owner_org_id' },
    work_item_type:    { table: 'blueprint.work_item_types',      col: 'owner_org_id' },
    service_catalog:   { table: 'blueprint.service_catalog_items',col: 'owner_org_id' },
    business_calendar: { table: 'blueprint.business_calendars',   col: 'org_id'       },
    role:              { table: 'blueprint.roles',                col: 'org_id'       },
  }

  const { table, col } = tableMap[resourceType]

  const result = await query(
    `SELECT * FROM ${table} WHERE ${col} = $1 AND is_active = true ORDER BY created_at ASC`,
    [orgId]
  )
  return result.rows
}

/**
 * Get the ordered org chain from self up to root.
 * Returns array of org IDs: [selfId, parentId, grandparentId, ...]
 */
async function getOrgChain(orgId) {
  const result = await query(`
    WITH RECURSIVE org_chain AS (
      SELECT id, parent_id, 0 AS depth
      FROM blueprint.organizations
      WHERE id = $1

      UNION ALL

      SELECT o.id, o.parent_id, oc.depth + 1
      FROM blueprint.organizations o
      JOIN org_chain oc ON o.id = oc.parent_id
    )
    SELECT id FROM org_chain ORDER BY depth ASC
  `, [orgId])

  return result.rows.map(r => r.id)
}

/**
 * Find the nearest ancestor org (including self) that has resources
 * of the given type defined directly.
 */
async function findNearestAncestorWithResources(orgId, resourceType) {
  const chain = await getOrgChain(orgId)

  for (const chainOrgId of chain) {
    const resources = await fetchOwnResources(chainOrgId, resourceType)
    if (resources.length > 0) return chainOrgId
  }

  return null
}

export default { resolveInheritedPolicy, resolveInheritedResource }
