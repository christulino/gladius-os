import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import 'dotenv/config'
import { applyBaseSchema } from '../db/applyBaseSchema.js'

const SCRATCH_DB = 'gladius_bootstrap_test'

function poolFor (database) {
  const { Pool } = pg
  return new Pool({
    host:     process.env.POSTGRES_HOST || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432'),
    database,
    user:     process.env.POSTGRES_USER || 'flowos',
    password: process.env.POSTGRES_PASSWORD,
  })
}

before(async () => {
  const admin = poolFor(process.env.POSTGRES_DB || 'flowos')
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`)
  await admin.end()
})

after(async () => {
  const admin = poolFor(process.env.POSTGRES_DB || 'flowos')
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
  await admin.end()
})

test('applies base schema to a fresh database', async () => {
  const pool = poolFor(SCRATCH_DB)
  const res = await applyBaseSchema({ pool, quiet: true })
  assert.equal(res.applied, true)

  const schema = await pool.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'blueprint'`
  )
  assert.equal(schema.rowCount, 1)

  const table = await pool.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'blueprint' AND table_name = 'organizations'`
  )
  assert.equal(table.rowCount, 1)
  await pool.end()
})

test('is idempotent — skips when blueprint schema already present', async () => {
  const pool = poolFor(SCRATCH_DB)
  const res = await applyBaseSchema({ pool, quiet: true })
  assert.equal(res.applied, false)
  await pool.end()
})
