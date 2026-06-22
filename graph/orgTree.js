/**
 * graph/orgTree.js
 * Org hierarchy queries — PostgreSQL implementation.
 *
 * Neo4j was removed. All traversals now use recursive CTEs against
 * blueprint.organizations. Graph write functions (syncOrg, deactivateOrg,
 * updateDescendantDepths) are no-ops — PostgreSQL is the single source of truth.
 *
 * Used by:
 *   - board/boardQuery.js (getDescendantOrgUris)
 *   - core/access.js (visibility rule evaluation)
 */

import { query } from '../db/postgres.js'

/**
 * Get all descendant org URIs for a given org (includes the root org itself).
 * Used by board query and all_descendants visibility scope.
 *
 * @param {string} orgUri - URI of the root org
 * @returns {Promise<string[]>} Array of org URIs (root + all descendants)
 */
export async function getDescendantOrgUris(orgUri) {
  const result = await query(`
    WITH RECURSIVE descendants AS (
      SELECT id, uri FROM blueprint.organizations WHERE uri = $1
      UNION ALL
      SELECT o.id, o.uri FROM blueprint.organizations o
      JOIN descendants d ON o.parent_id = d.id
      WHERE o.is_active = true
    )
    SELECT uri FROM descendants
  `, [orgUri])
  return result.rows.map(r => r.uri)
}

/**
 * Get all ancestor org URIs for a given org (excludes the org itself).
 *
 * @param {string} orgUri
 * @returns {Promise<string[]>}
 */
export async function getAncestorOrgUris(orgUri) {
  const result = await query(`
    WITH RECURSIVE ancestors AS (
      SELECT o.parent_id AS id FROM blueprint.organizations o WHERE o.uri = $1
      UNION ALL
      SELECT o.parent_id FROM blueprint.organizations o JOIN ancestors a ON o.id = a.id
      WHERE o.parent_id IS NOT NULL
    )
    SELECT o.uri FROM ancestors a JOIN blueprint.organizations o ON o.id = a.id WHERE a.id IS NOT NULL
  `, [orgUri])
  return result.rows.map(r => r.uri)
}

/**
 * Get direct child org URIs (one level down only).
 *
 * @param {string} orgUri
 * @returns {Promise<string[]>}
 */
export async function getDirectChildOrgUris(orgUri) {
  const result = await query(`
    SELECT o.uri FROM blueprint.organizations o
    JOIN blueprint.organizations parent ON parent.uri = $1
    WHERE o.parent_id = parent.id AND o.is_active = true
  `, [orgUri])
  return result.rows.map(r => r.uri)
}

/**
 * Get sibling org URIs (orgs sharing the same parent).
 *
 * @param {string} orgUri
 * @returns {Promise<string[]>}
 */
export async function getSiblingOrgUris(orgUri) {
  const result = await query(`
    SELECT sibling.uri FROM blueprint.organizations sibling
    JOIN blueprint.organizations org ON org.uri = $1
    WHERE sibling.parent_id = org.parent_id AND sibling.uri <> $1 AND sibling.is_active = true
  `, [orgUri])
  return result.rows.map(r => r.uri)
}

/**
 * Check if orgA is an ancestor of orgB.
 *
 * @param {string} ancestorUri
 * @param {string} descendantUri
 * @returns {Promise<boolean>}
 */
export async function isAncestorOf(ancestorUri, descendantUri) {
  const result = await query(`
    WITH RECURSIVE ancestors AS (
      SELECT o.parent_id AS id FROM blueprint.organizations o WHERE o.uri = $2
      UNION ALL
      SELECT o.parent_id FROM blueprint.organizations o JOIN ancestors a ON o.id = a.id
      WHERE o.parent_id IS NOT NULL
    )
    SELECT 1 FROM ancestors a
    JOIN blueprint.organizations o ON o.id = a.id
    WHERE o.uri = $1
    LIMIT 1
  `, [ancestorUri, descendantUri])
  return result.rows.length > 0
}

// =============================================================================
// SYNC STUBS — Neo4j removed; PostgreSQL is the source of truth
// =============================================================================

/** No-op: org data lives in PostgreSQL only. */
export async function syncOrg(_org) {}

/** No-op: org data lives in PostgreSQL only. */
export async function deactivateOrg(_orgUri) {}

/** No-op: depth is stored in blueprint.organizations. */
export async function updateDescendantDepths(_orgUri, _newDepth) {}

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
