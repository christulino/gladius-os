/**
 * core/storage/localStorage.js
 * Local filesystem adapter for attachment storage.
 *
 * Layout: <rootDir>/<aa>/<full-uuid-key>
 * The 2-char shard prevents directory bloat at scale and is free now.
 */

import fs from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createLocalStorage(rootDir) {
  if (!rootDir) throw new Error('createLocalStorage requires rootDir')

  function fullPath(key) {
    if (key.includes('..') || path.isAbsolute(key)) {
      throw new Error('invalid storage key')
    }
    return path.join(rootDir, key)
  }

  return {
    type: 'local',

    async put(key, buffer) {
      const target = fullPath(key)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, buffer)
    },

    getReadStream(key) {
      return fs.createReadStream(fullPath(key))
    },

    async delete(key) {
      try {
        await unlink(fullPath(key))
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    },
  }
}
