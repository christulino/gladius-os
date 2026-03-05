/**
 * db/neo4j.js
 * Neo4j driver and session management.
 *
 * Usage:
 *   import { runQuery, runWriteQuery } from '../db/neo4j.js'
 *
 *   // Read query
 *   const records = await runQuery(
 *     'MATCH (o:Organization {uri: $uri})-[:PARENT_OF*]->(child) RETURN child',
 *     { uri: 'flowos://engineering/org/uuid' }
 *   )
 *
 *   // Write query
 *   await runWriteQuery(
 *     'MERGE (o:Organization {uri: $uri}) SET o += $props',
 *     { uri, props }
 *   )
 */

import neo4j from 'neo4j-driver'
import 'dotenv/config'

const driver = neo4j.driver(
  process.env.NEO4J_URI      || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER     || 'neo4j',
    process.env.NEO4J_PASSWORD || ''
  ),
  {
    maxConnectionPoolSize: 50,
    connectionAcquisitionTimeout: 5000,
    logging: {
      level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'warn',
      logger: (level, message) => {
        if (level === 'error') console.error('[neo4j]', message)
        else if (process.env.LOG_LEVEL === 'debug') console.debug('[neo4j]', message)
      }
    }
  }
)

/**
 * Run a read query and return all records as plain objects.
 * @param {string} cypher - Cypher query string
 * @param {Object} params - Query parameters
 * @returns {Promise<Object[]>} Array of record objects
 */
export async function runQuery(cypher, params = {}) {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ })
  try {
    const result = await session.run(cypher, params)
    return result.records.map(record => {
      const obj = {}
      record.keys.forEach(key => {
        const val = record.get(key)
        // Unwrap Neo4j node/relationship objects to plain data
        obj[key] = unwrap(val)
      })
      return obj
    })
  } catch (err) {
    console.error('[neo4j] Read query error:', err.message, '\nCypher:', cypher)
    throw err
  } finally {
    await session.close()
  }
}

/**
 * Run a write query. Returns summary (counters etc).
 * @param {string} cypher - Cypher query string
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Query summary
 */
export async function runWriteQuery(cypher, params = {}) {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  try {
    const result = await session.run(cypher, params)
    return result.summary
  } catch (err) {
    console.error('[neo4j] Write query error:', err.message, '\nCypher:', cypher)
    throw err
  } finally {
    await session.close()
  }
}

/**
 * Run multiple write queries in a single transaction.
 * All succeed or all roll back.
 * @param {Array<{cypher: string, params: Object}>} queries
 * @returns {Promise<void>}
 */
export async function runWriteTransaction(queries) {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE })
  const tx = session.beginTransaction()
  try {
    for (const { cypher, params } of queries) {
      await tx.run(cypher, params || {})
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    console.error('[neo4j] Transaction error:', err.message)
    throw err
  } finally {
    await session.close()
  }
}

/**
 * Health check — verifies Neo4j is reachable.
 * @returns {Promise<boolean>}
 */
export async function healthCheck() {
  try {
    await driver.verifyConnectivity()
    return true
  } catch {
    return false
  }
}

/**
 * Gracefully close the driver on shutdown.
 */
export async function close() {
  await driver.close()
}

/**
 * Unwrap Neo4j node/relationship/path objects into plain JS objects.
 * Handles Neo4j integers, dates, and nested structures.
 * @param {*} val
 * @returns {*}
 */
function unwrap(val) {
  if (val === null || val === undefined) return val
  if (neo4j.isInt(val)) return val.toNumber()
  if (val instanceof neo4j.types.Node) return { ...val.properties, _labels: val.labels }
  if (val instanceof neo4j.types.Relationship) return { ...val.properties, _type: val.type }
  if (val instanceof neo4j.types.Path) return val.segments.map(s => ({
    start: unwrap(s.start),
    relationship: unwrap(s.relationship),
    end: unwrap(s.end)
  }))
  if (Array.isArray(val)) return val.map(unwrap)
  if (typeof val === 'object') {
    const out = {}
    for (const k of Object.keys(val)) out[k] = unwrap(val[k])
    return out
  }
  return val
}

export default { runQuery, runWriteQuery, runWriteTransaction, healthCheck, close }
