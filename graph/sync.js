/**
 * graph/sync.js
 * Neo4j sync — removed. PostgreSQL is the single source of truth.
 *
 * This file is retained as a stub so any future call to syncToGraph
 * fails silently rather than causing a module-not-found error.
 */

/**
 * No-op stub. Neo4j was removed; this function intentionally does nothing.
 *
 * @param {string} _entityType
 * @param {string} _entityUri
 * @param {string} _operation
 * @param {Object} _payload
 * @returns {Promise<void>}
 */
export async function syncToGraph(_entityType, _entityUri, _operation, _payload) {}

export default { syncToGraph }
