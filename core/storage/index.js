/**
 * core/storage/index.js
 * Storage adapter factory. Reads env at module load.
 *
 * Adapter contract:
 *   put(key: string, buffer: Buffer): Promise<void>
 *   getReadStream(key: string): NodeJS.ReadableStream
 *   delete(key: string): Promise<void>
 *   type: string  // 'local' | 's3'
 *
 * Keys are opaque to callers — runtime/attachments.js generates UUID-based keys
 * with a 2-char shard prefix.
 */

import { createLocalStorage } from './localStorage.js'

const TYPE = process.env.GLADIUS_STORAGE_TYPE || 'local'
const LOCAL_DIR = process.env.GLADIUS_STORAGE_LOCAL_DIR || './uploads'

export function buildStorageKey(uuid) {
  return `${uuid.slice(0, 2)}/${uuid}`
}

let _adapter = null

export function getStorage() {
  if (_adapter) return _adapter
  if (TYPE === 'local') {
    _adapter = createLocalStorage(LOCAL_DIR)
  } else {
    throw new Error(`unsupported GLADIUS_STORAGE_TYPE: ${TYPE} (only 'local' supported in v1)`)
  }
  return _adapter
}

const _maxMb = parseInt(process.env.GLADIUS_MAX_ATTACHMENT_MB || '25', 10)
if (!Number.isFinite(_maxMb) || _maxMb <= 0) {
  throw new Error(
    `GLADIUS_MAX_ATTACHMENT_MB must be a positive integer; got: ${JSON.stringify(process.env.GLADIUS_MAX_ATTACHMENT_MB)}`
  )
}
export const MAX_ATTACHMENT_MB = _maxMb
export const MAX_ATTACHMENT_BYTES = _maxMb * 1024 * 1024
