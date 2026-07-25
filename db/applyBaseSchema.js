/**
 * db/applyBaseSchema.js
 * Applies the base blueprint + runtime schema to a fresh database.
 *
 * Used by the container entrypoint on first boot, where there is no local
 * checkout to bind-mount into Postgres `initdb.d`. Runs the two schema files
 * directly through the pg driver (never 01_schemas.sql — that uses the psql
 * `\i` meta-command). The base schema files are NOT idempotent, so this is
 * guarded: it only runs when the `blueprint` schema is absent.
 *
 * Usage:
 *   node db/applyBaseSchema.js
 */

import 'dotenv/config'
import pg from 'pg'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INIT_DIR = join(__dirname, 'init')

function buildPool () {
  const { Pool } = pg
  return new Pool({
    host:     process.env.POSTGRES_HOST || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB   || 'flowos',
    user:     process.env.POSTGRES_USER || 'flowos',
    password: process.env.POSTGRES_PASSWORD,
  })
}

async function blueprintExists (client) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'blueprint'`
  )
  return r.rowCount > 0
}

/**
 * Apply the base schema if the blueprint schema does not yet exist.
 * @param {{ pool?: pg.Pool, quiet?: boolean }} [opts]
 * @returns {Promise<{ applied: boolean }>}
 */
export async function applyBaseSchema ({ pool: providedPool, quiet = false } = {}) {
  const pool = providedPool ?? buildPool()
  const ownPool = !providedPool
  const client = await pool.connect()
  const log = quiet ? () => {} : console.log

  try {
    if (await blueprintExists(client)) {
      log('  Base schema already present — skipping.')
      return { applied: false }
    }

    const blueprintSql = await readFile(join(INIT_DIR, 'blueprint_schema.sql'), 'utf8')
    const runtimeSql   = await readFile(join(INIT_DIR, 'runtime_schema.sql'), 'utf8')

    try {
      await client.query('BEGIN')
      await client.query(blueprintSql)
      await client.query(runtimeSql)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    log('  ✓ Base schema applied (blueprint + runtime).')
    return { applied: true }
  } finally {
    client.release()
    if (ownPool) await pool.end()
  }
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyBaseSchema()
    .then(({ applied }) => {
      console.log(applied ? '✅ Base schema applied.' : '✅ Base schema already present.')
      process.exit(0)
    })
    .catch(err => {
      console.error('❌ Base schema apply failed.\n', err)
      process.exit(1)
    })
}
