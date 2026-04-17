/**
 * db/postgres.js
 * PostgreSQL connection pool.
 *
 * Usage:
 *   import { query, getClient } from '../db/postgres.js'
 *
 *   // Single query
 *   const result = await query('SELECT * FROM blueprint.organizations WHERE uri = $1', [uri])
 *
 *   // Transaction
 *   const client = await getClient()
 *   try {
 *     await client.query('BEGIN')
 *     await client.query('INSERT INTO ...', [...])
 *     await client.query('INSERT INTO ...', [...])
 *     await client.query('COMMIT')
 *   } catch (err) {
 *     await client.query('ROLLBACK')
 *     throw err
 *   } finally {
 *     client.release()
 *   }
 */

import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB       || 'flowos',
  user:     process.env.POSTGRES_USER     || 'flowos',
  password: process.env.POSTGRES_PASSWORD,
  min:      parseInt(process.env.POSTGRES_POOL_MIN || '2'),
  max:      parseInt(process.env.POSTGRES_POOL_MAX || '10'),
})

// Log connection errors without crashing
pool.on('error', (err) => {
  console.error('[postgres] Unexpected pool error:', err.message)
})

/**
 * Run a single query against the pool.
 * @param {string} text - SQL query string with $1, $2 placeholders
 * @param {Array}  params - Parameter values
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  const start = Date.now()
  try {
    const result = await pool.query(text, params)
    const duration = Date.now() - start
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[postgres] query (${duration}ms):`, text.slice(0, 80))
    }
    return result
  } catch (err) {
    console.error('[postgres] Query error:', err.message, '\nQuery:', text)
    throw err
  }
}

/**
 * Get a client from the pool for manual transaction control.
 * Caller is responsible for client.release().
 * @returns {Promise<pg.PoolClient>}
 */
export async function getClient() {
  return pool.connect()
}

/**
 * Health check — verifies the database is reachable.
 * @returns {Promise<boolean>}
 */
export async function healthCheck() {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

export { pool }
export default { pool, query, getClient, healthCheck }
