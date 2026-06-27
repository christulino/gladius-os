/**
 * db/migrate.js
 * Migration runner — applies any pending SQL migration files from db/migrations/.
 *
 * Usage:
 *   node db/migrate.js          # apply all pending migrations
 *   npm run db:migrate
 *
 * Tracks applied migrations in public.schema_migrations. Each migration runs
 * inside its own transaction; on failure the transaction is rolled back and the
 * runner exits non-zero (subsequent migrations are NOT attempted).
 *
 * Safe to run multiple times — already-applied migrations are skipped.
 */

import 'dotenv/config'
import pg from 'pg'
import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MIGRATIONS_DIR = join(__dirname, 'migrations')

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPool () {
  const { Pool } = pg
  return new Pool({
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB       || 'flowos',
    user:     process.env.POSTGRES_USER     || 'flowos',
    password: process.env.POSTGRES_PASSWORD,
  })
}

/** Ensure the tracking table exists. */
async function ensureTrackingTable (client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   TEXT NOT NULL PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

/** Return the set of already-applied migration filenames. */
async function appliedMigrations (client) {
  const result = await client.query(
    'SELECT filename FROM public.schema_migrations ORDER BY filename'
  )
  return new Set(result.rows.map(r => r.filename))
}

/** Return migration filenames in numeric order. */
async function pendingMigrations (applied) {
  const files = await readdir(MIGRATIONS_DIR)
  return files
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort()
    .filter(f => !applied.has(f))
}

// ---------------------------------------------------------------------------
// Core migration function (exported for use by seed.js)
// ---------------------------------------------------------------------------

/**
 * Apply all pending migrations.
 * @param {{ pool?: pg.Pool, quiet?: boolean }} [opts]
 * @returns {Promise<{ applied: string[], skipped: string[] }>}
 */
export async function migrate ({ pool: providedPool, quiet = false } = {}) {
  const pool = providedPool ?? buildPool()
  const ownPool = !providedPool

  const client = await pool.connect()
  const log = quiet ? () => {} : console.log

  try {
    await ensureTrackingTable(client)
    const applied = await appliedMigrations(client)
    const pending = await pendingMigrations(applied)

    if (pending.length === 0) {
      log('  No pending migrations.')
      return { applied: [], skipped: [...applied] }
    }

    log(`  ${pending.length} pending migration(s):`)

    const appliedNow = []

    for (const filename of pending) {
      const filepath = join(MIGRATIONS_DIR, filename)
      const sql = await readFile(filepath, 'utf8')

      log(`    → ${filename}`)

      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
          [filename]
        )
        await client.query('COMMIT')
        appliedNow.push(filename)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`\n  ✗ Migration failed: ${filename}`)
        console.error(`    ${err.message}\n`)
        throw err
      }
    }

    log(`  ✓ Applied ${appliedNow.length} migration(s).\n`)
    return { applied: appliedNow, skipped: [...applied] }

  } finally {
    client.release()
    if (ownPool) await pool.end()
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('\n🗄️  Running migrations...\n')
  migrate()
    .then(({ applied }) => {
      if (applied.length) {
        console.log(`✅ Migrations complete — ${applied.length} applied.\n`)
      } else {
        console.log('✅ Already up to date.\n')
      }
      process.exit(0)
    })
    .catch(err => {
      console.error('❌ Migration runner failed.\n', err)
      process.exit(1)
    })
}
