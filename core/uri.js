/**
 * core/uri.js
 * Generates globally unique, stable URIs for every entity in the system.
 *
 * Format: flowos://org-slug/entity-type/uuid
 *
 * URIs are the cross-system identity — used in Neo4j, external APIs,
 * federation, and gossip. Local DB primary keys are internal only.
 *
 * Usage:
 *   import { generateUri, parseUri, isValidUri } from '../core/uri.js'
 *
 *   const uri = generateUri('bank-of-america-mobile', 'work-items')
 *   // → 'flowos://bank-of-america-mobile/work-items/a1b2c3d4-...'
 *
 *   const parsed = parseUri(uri)
 *   // → { scheme: 'flowos', orgSlug: 'bank-of-america-mobile', entityType: 'work-items', id: 'a1b2c3d4-...' }
 */

import { v4 as uuidv4 } from 'uuid'

// Valid entity types — helps catch typos early
const ENTITY_TYPES = new Set([
  'orgs',
  'users',
  'roles',
  'work-items',
  'work-item-types',
  'work-item-type-classes',
  'workflows',
  'stages',
  'service-catalog',
  'connections',
  'evidence',
  'board-views',
  'visibility-rules',
  'business-calendars',
])

// System-level entities not scoped to an org use this slug
const SYSTEM_SLUG = 'system'

/**
 * Generate a new globally unique URI for an entity.
 *
 * @param {string} orgSlug   - URL-safe org slug. Use 'system' for system-level entities.
 * @param {string} entityType - Entity type (see ENTITY_TYPES)
 * @param {string} [id]      - Optional: provide existing UUID (e.g. when syncing from external source)
 * @returns {string} URI string
 *
 * @throws {Error} If entityType is not recognized
 */
export function generateUri(orgSlug, entityType, id = null) {
  if (!ENTITY_TYPES.has(entityType)) {
    throw new Error(`[uri] Unknown entity type: "${entityType}". Valid types: ${[...ENTITY_TYPES].join(', ')}`)
  }
  if (!orgSlug || typeof orgSlug !== 'string') {
    throw new Error('[uri] orgSlug is required and must be a string')
  }

  const slug = orgSlug.toLowerCase().trim()
  const uuid  = id || uuidv4()

  return `flowos://${slug}/${entityType}/${uuid}`
}

/**
 * Generate a system-level URI (not scoped to an org).
 * Used for system default classes, workflows, roles etc.
 *
 * @param {string} entityType
 * @param {string} [id]
 * @returns {string}
 */
export function generateSystemUri(entityType, id = null) {
  return generateUri(SYSTEM_SLUG, entityType, id)
}

/**
 * Parse a URI into its components.
 *
 * @param {string} uri
 * @returns {{ scheme: string, orgSlug: string, entityType: string, id: string }}
 * @throws {Error} If URI format is invalid
 */
export function parseUri(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('[uri] URI must be a non-empty string')
  }

  // Expected format: flowos://org-slug/entity-type/uuid
  const match = uri.match(/^([a-z]+):\/\/([^/]+)\/([^/]+)\/([^/]+)$/)

  if (!match) {
    throw new Error(`[uri] Invalid URI format: "${uri}". Expected: flowos://org-slug/entity-type/uuid`)
  }

  const [, scheme, orgSlug, entityType, id] = match

  return { scheme, orgSlug, entityType, id }
}

/**
 * Extract just the UUID from a URI.
 *
 * @param {string} uri
 * @returns {string} UUID portion
 */
export function extractId(uri) {
  return parseUri(uri).id
}

/**
 * Extract the org slug from a URI.
 *
 * @param {string} uri
 * @returns {string}
 */
export function extractOrgSlug(uri) {
  return parseUri(uri).orgSlug
}

/**
 * Validate that a URI is well-formed.
 *
 * @param {string} uri
 * @returns {boolean}
 */
export function isValidUri(uri) {
  try {
    parseUri(uri)
    return true
  } catch {
    return false
  }
}

export default { generateUri, generateSystemUri, parseUri, extractId, extractOrgSlug, isValidUri }
