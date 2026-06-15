// runtime/orgAiModels.js
import crypto from 'node:crypto'
import { pool } from '../db/postgres.js'

const ALGO = 'aes-256-gcm'
const KEY_HEX = process.env.FLOWOS_ENCRYPTION_KEY

function getKey() {
  if (!KEY_HEX) throw new Error('FLOWOS_ENCRYPTION_KEY env var not set')
  return Buffer.from(KEY_HEX, 'hex')
}

export function encryptApiKey(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join('.')
}

export function decryptApiKey(ciphertext) {
  const key = getKey()
  const [ivHex, encHex, tagHex] = ciphertext.split('.')
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()])
  return dec.toString('utf8')
}

export async function listOrgAiModels(orgId) {
  const r = await pool.query(
    `SELECT id,org_id,name,provider,model,is_active,created_at,updated_at
     FROM blueprint.org_ai_models WHERE org_id=$1 ORDER BY name`,
    [orgId]
  )
  return r.rows  // api_key_enc NEVER returned to client
}

export async function createOrgAiModel(orgId, { name, provider, model, apiKey }) {
  const enc = apiKey ? encryptApiKey(apiKey) : null
  const r = await pool.query(`
    INSERT INTO blueprint.org_ai_models (org_id,name,provider,model,api_key_enc)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING id,org_id,name,provider,model,is_active,created_at,updated_at
  `, [orgId, name, provider || 'anthropic', model, enc])
  return r.rows[0]
}

export async function updateOrgAiModel(id, orgId, { name, provider, model, apiKey, isActive }) {
  const sets = ['updated_at=now()'], params = []
  if (name     !== undefined) { params.push(name);     sets.push(`name=$${params.length}`) }
  if (provider !== undefined) { params.push(provider); sets.push(`provider=$${params.length}`) }
  if (model    !== undefined) { params.push(model);    sets.push(`model=$${params.length}`) }
  if (isActive !== undefined) { params.push(isActive); sets.push(`is_active=$${params.length}`) }
  if (apiKey   !== undefined) { params.push(encryptApiKey(apiKey)); sets.push(`api_key_enc=$${params.length}`) }
  params.push(id, orgId)
  const r = await pool.query(
    `UPDATE blueprint.org_ai_models SET ${sets.join(',')} WHERE id=$${params.length - 1} AND org_id=$${params.length}
     RETURNING id,org_id,name,provider,model,is_active,created_at,updated_at`,
    params
  )
  return r.rows[0] || null
}

export async function deleteOrgAiModel(id, orgId) {
  const r = await pool.query(
    `DELETE FROM blueprint.org_ai_models WHERE id=$1 AND org_id=$2 RETURNING id`,
    [id, orgId]
  )
  return r.rowCount > 0
}

// Used internally by playbookExecutor — decrypts key for AI call
export async function resolveModelConfig(orgId, modelName = 'default') {
  const r = await pool.query(
    `SELECT * FROM blueprint.org_ai_models WHERE org_id=$1 AND name=$2 AND is_active=true`,
    [orgId, modelName]
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    provider: row.provider,
    model:    row.model,
    apiKey:   row.api_key_enc ? decryptApiKey(row.api_key_enc) : null,
  }
}
