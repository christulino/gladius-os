/**
 * graph/orgTree.js
 * Neo4j traversal for org hierarchy queries.
 *
 * Used by:
 *   - Board query (Step 1: which orgs to include)
 *   - canAccess() for descendant/ancestor scope resolution
 *   - Visibility rule evaluation
 *
 * Usage:
 *   import { getDescendantOrgUris, getAncestorOrgUris, syncOrg } from '../graph/orgTree.js'
 *
 *   const uris = await getDescendantOrgUris('flowos://engineering/orgs/uuid')
 *   // → ['flowos://engineering/orgs/uuid', 'flowos://mobile/orgs/uuid', ...]
 */

import { runQuery, runWriteQuery } from '../db/neo4j.js'

/**
 * Get all descendant org URIs for a given org (includes the root org itself).
 * Used by board query and all_descendants visibility scope.
 *
 * @param {string} orgUri - URI of the root org
 * @returns {Promise<string[]>} Array of org URIs (root + all descendants)
 */
export async function getDescendantOrgUris(orgUri) {
  const records = await runQuery(`
    MATCH (root:Organization {uri: $uri})-[:PARENT_OF*0..]->(org:Organization)
    WHERE org.is_active = true
    RETURN org.uri AS uri
  `, { uri: orgUri })

  return records.map(r => r.uri)
}

/**
 * Get all ancestor org URIs for a given org (excludes the org itself).
 * Used by ancestor_members visibility scope and role inheritance.
 *
 * @param {string} orgUri
 * @returns {Promise<string[]>}
 */
export async function getAncestorOrgUris(orgUri) {
  const records = await runQuery(`
    MATCH (ancestor:Organization)-[:PARENT_OF*1..]->(org:Organization {uri: $uri})
    RETURN ancestor.uri AS uri
  `, { uri: orgUri })

  return records.map(r => r.uri)
}

/**
 * Get direct child org URIs (one level down only).
 *
 * @param {string} orgUri
 * @returns {Promise<string[]>}
 */
export async function getDirectChildOrgUris(orgUri) {
  const records = await runQuery(`
    MATCH (root:Organization {uri: $uri})-[:PARENT_OF]->(child:Organization)
    WHERE child.is_active = true
    RETURN child.uri AS uri
  `, { uri: orgUri })

  return records.map(r => r.uri)
}

/**
 * Get sibling org URIs (orgs sharing the same parent).
 *
 * @param {string} orgUri
 * @returns {Promise<string[]>}
 */
export async function getSiblingOrgUris(orgUri) {
  const records = await runQuery(`
    MATCH (parent:Organization)-[:PARENT_OF]->(org:Organization {uri: $uri})
    MATCH (parent)-[:PARENT_OF]->(sibling:Organization)
    WHERE sibling.uri <> $uri AND sibling.is_active = true
    RETURN sibling.uri AS uri
  `, { uri: orgUri })

  return records.map(r => r.uri)
}

/**
 * Check if orgA is an ancestor of orgB.
 * Used for permission boundary checks in hierarchy traversal.
 *
 * @param {string} ancestorUri
 * @param {string} descendantUri
 * @returns {Promise<boolean>}
 */
export async function isAncestorOf(ancestorUri, descendantUri) {
  const records = await runQuery(`
    MATCH path = (a:Organization {uri: $ancestorUri})-[:PARENT_OF*1..]->(d:Organization {uri: $descendantUri})
    RETURN count(path) > 0 AS result
  `, { ancestorUri, descendantUri })

  return records[0]?.result === true
}

// =============================================================================
// SYNC — Keep Neo4j org tree in sync with PostgreSQL
// Called by syncToGraph() in graph/sync.js
// =============================================================================

/**
 * Upsert an Organization node and its PARENT_OF relationship.
 * Safe to call on create or update — uses MERGE.
 *
 * @param {Object} org - Organization row from PostgreSQL blueprint.organizations
 */
export async function syncOrg(org) {
  // Upsert the org node
  await runWriteQuery(`
    MERGE (o:Organization {uri: $uri})
    SET o += {
      slug:           $slug,
      name:           $name,
      org_type:       $org_type,
      depth:          $depth,
      is_active:      $is_active,
      network_visible:$network_visible
    }
  `, {
    uri:             org.uri,
    slug:            org.slug,
    name:            org.name,
    org_type:        org.org_type || 'team',
    depth:           org.depth    || 0,
    is_active:       org.is_active,
    network_visible: org.network_visible || false,
  })

  // Create PARENT_OF relationship if this org has a parent
  if (org.parent_uri) {
    await runWriteQuery(`
      MATCH (parent:Organization {uri: $parentUri})
      MATCH (child:Organization  {uri: $childUri})
      MERGE (parent)-[:PARENT_OF]->(child)
    `, {
      parentUri: org.parent_uri,
      childUri:  org.uri,
    })
  }
}

/**
 * Deactivate an org node (soft delete — never remove from graph).
 *
 * @param {string} orgUri
 */
export async function deactivateOrg(orgUri) {
  await runWriteQuery(
    'MATCH (o:Organization {uri: $uri}) SET o.is_active = false',
    { uri: orgUri }
  )
}

/**
 * Update depth property on an org and all its descendants.
 * Called when an org is moved to a different parent.
 *
 * @param {string} orgUri   - Root org whose depth changed
 * @param {number} newDepth - New depth of the root org
 */
export async function updateDescendantDepths(orgUri, newDepth) {
  await runWriteQuery(`
    MATCH (root:Organization {uri: $uri})-[:PARENT_OF*0..]->(org:Organization)
    WITH org, length(shortestPath((root)-[:PARENT_OF*]->(org))) AS relativeDepth
    SET org.depth = $baseDepth + relativeDepth
  `, { uri: orgUri, baseDepth: newDepth })
}

export default {
  getDescendantOrgUris,
  getAncestorOrgUris,
  getDirectChildOrgUris,
  getSiblingOrgUris,
  isAncestorOf,
  syncOrg,
  deactivateOrg,
  updateDescendantDepths,
}
