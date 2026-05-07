# Attachments v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file & link attachments to work items, with pluggable storage (local filesystem default), 25 MB per-file cap, and full integration with the existing event/audit/search systems.

**Architecture:** New `runtime.attachments` table holds metadata for both files and links. A pluggable storage adapter writes file bytes to a configurable backend (local fs in v1; S3 deferred). REST endpoints under `/admin/api/work-items/:id/attachments` for upload/list/download/delete, secured by `requireAuth`. Two new event types (`work_item.attachment_added`, `work_item.attachment_removed`) flow through the existing event processor — picked up by the search-index subscriber (filenames/link titles join the search doc) and rendered in the Activity tab via `workItemHistory.js`. The frontend exposes attachments as a section inside the existing `WorkItemDetail` drawer.

**Tech Stack:** Node.js ESM, Express, `multer` (new dep) for multipart parsing, PostgreSQL, React 18 + Vite + shadcn/ui, browser-native `<input type="file" capture="environment">` for mobile camera capture.

**Explicitly out of scope (separate follow-up plan):**
- Stage-evidence requirements (`blueprint.stage_evidence_requirements`) and fulfillment join
- Exit-criteria expressions like `attachments > 0`, `attachments.name = *invoice*`, `attachments.type IN [jpg,png]`
- S3/MinIO storage adapter implementation (interface designed in v1, swap-in is a single new file)
- Server-side image thumbnail generation (browsers render `<img>` directly from download URL)
- Antivirus / MIME sniffing / signed download URLs

The existing unused `runtime.evidence` table is **not touched** by this plan; it'll be revisited (likely dropped) when stage evidence is implemented in the follow-up.

---

## File Structure

**Created:**
- `db/migrations/015_attachments.sql` — table + indexes
- `core/storage/index.js` — adapter factory; reads env, returns the active storage
- `core/storage/localStorage.js` — local filesystem adapter
- `runtime/attachments.js` — CRUD logic, event emission
- `tests/attachments-api.test.js` — integration test suite
- `admin-ui/src/components/AttachmentsList.jsx` — list rendering
- `admin-ui/src/components/AttachmentUpload.jsx` — upload + link + camera UI

**Modified:**
- `package.json` — add `multer` dependency
- `admin/api.js` — five new routes; multer middleware
- `runtime/subscribers/searchIndex.js` — handle two new event types, index filenames/link titles
- `runtime/workItemHistory.js` — render attachment events in audit trail
- `admin-ui/src/lib/api.js` — five new client functions
- `admin-ui/src/pages/WorkItemDetail.jsx` — embed attachments section
- `.env.example` — document new env vars
- `CLAUDE.md` — add attachments section under Key Patterns

**Configuration (env vars, all optional with defaults):**
- `FLOWOS_STORAGE_TYPE` — `local` (default) or `s3` (not implemented in v1)
- `FLOWOS_STORAGE_LOCAL_DIR` — `./uploads` (default)
- `FLOWOS_MAX_ATTACHMENT_MB` — `25` (default)

---

## Tasks

### Task 1: Database migration

**Files:**
- Create: `db/migrations/015_attachments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 015_attachments.sql
-- Generic attachments on work items: files (binary in object storage) + links.

CREATE TABLE IF NOT EXISTS runtime.attachments (
    id                   SERIAL PRIMARY KEY,
    uri                  TEXT NOT NULL UNIQUE,
    work_item_id         INTEGER NOT NULL REFERENCES runtime.work_items(id) ON DELETE CASCADE,
    kind                 TEXT NOT NULL CHECK (kind IN ('file', 'link')),

    -- file fields (NULL for kind='link')
    storage_key          TEXT,
    file_name            TEXT,
    file_size_bytes      BIGINT,
    mime_type            TEXT,

    -- link fields (NULL for kind='file')
    url                  TEXT,
    url_title            TEXT,

    uploaded_by_user_id  INTEGER NOT NULL REFERENCES blueprint.users(id),
    uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attachments_kind_fields CHECK (
        (kind = 'file' AND storage_key IS NOT NULL AND file_name IS NOT NULL AND file_size_bytes IS NOT NULL)
        OR
        (kind = 'link' AND url IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS attachments_work_item_idx ON runtime.attachments(work_item_id);
CREATE INDEX IF NOT EXISTS attachments_uploader_idx  ON runtime.attachments(uploaded_by_user_id);
```

- [ ] **Step 2: Apply the migration**

Run: `psql $DATABASE_URL -f db/migrations/015_attachments.sql`
Expected: `CREATE TABLE`, `CREATE INDEX` x2 (or no-ops if already applied).

- [ ] **Step 3: Verify table shape**

Run: `psql $DATABASE_URL -c "\\d runtime.attachments"`
Expected: 11 columns, the `attachments_kind_fields` CHECK constraint, two indexes.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/015_attachments.sql
git commit -m "feat(attachments): migration 015 — runtime.attachments table"
```

---

### Task 2: Add multer dependency and env-var defaults

**Files:**
- Modify: `package.json`
- Modify: `.env.example` (create if missing)

- [ ] **Step 1: Install multer**

Run: `npm install multer`
Expected: `package.json` and `package-lock.json` updated; no audit failures.

- [ ] **Step 2: Document env vars**

If `.env.example` exists, append. If not, create it with at least:

```
# Storage backend for work-item attachments
FLOWOS_STORAGE_TYPE=local
FLOWOS_STORAGE_LOCAL_DIR=./uploads
FLOWOS_MAX_ATTACHMENT_MB=25
```

- [ ] **Step 3: Add `uploads/` to .gitignore**

Append `uploads/` to the project root `.gitignore` (verify it isn't already there with `grep -n "^uploads" .gitignore`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "build(attachments): add multer; document storage env vars"
```

---

### Task 3: Storage adapter interface + local filesystem implementation

**Files:**
- Create: `core/storage/index.js`
- Create: `core/storage/localStorage.js`
- Test: inline at the bottom of each file via `node --test` smoke test in Task 4.

- [ ] **Step 1: Write the local storage adapter**

Create `core/storage/localStorage.js`:

```js
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
```

- [ ] **Step 2: Write the storage factory**

Create `core/storage/index.js`:

```js
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

const TYPE = process.env.FLOWOS_STORAGE_TYPE || 'local'
const LOCAL_DIR = process.env.FLOWOS_STORAGE_LOCAL_DIR || './uploads'

export function buildStorageKey(uuid) {
  return `${uuid.slice(0, 2)}/${uuid}`
}

let _adapter = null

export function getStorage() {
  if (_adapter) return _adapter
  if (TYPE === 'local') {
    _adapter = createLocalStorage(LOCAL_DIR)
  } else {
    throw new Error(`unsupported FLOWOS_STORAGE_TYPE: ${TYPE} (only 'local' supported in v1)`)
  }
  return _adapter
}

export const MAX_ATTACHMENT_BYTES =
  parseInt(process.env.FLOWOS_MAX_ATTACHMENT_MB || '25', 10) * 1024 * 1024
```

- [ ] **Step 3: Smoke test the adapter**

Run a one-liner sanity check:

```bash
node --input-type=module -e "
import { getStorage, buildStorageKey, MAX_ATTACHMENT_BYTES } from './core/storage/index.js'
const s = getStorage()
const key = buildStorageKey('abcdef12-3456-7890-abcd-ef1234567890')
await s.put(key, Buffer.from('hello attachments'))
const chunks = []
for await (const c of s.getReadStream(key)) chunks.push(c)
console.log('roundtrip:', Buffer.concat(chunks).toString(), '| max bytes:', MAX_ATTACHMENT_BYTES)
await s.delete(key)
console.log('deleted ok')
"
```

Expected:
```
roundtrip: hello attachments | max bytes: 26214400
deleted ok
```

- [ ] **Step 4: Commit**

```bash
git add core/storage/
git commit -m "feat(attachments): pluggable storage adapter; local fs implementation"
```

---

### Task 4: Runtime CRUD logic with event emission

**Files:**
- Create: `runtime/attachments.js`

- [ ] **Step 1: Write the runtime helper**

Create `runtime/attachments.js`:

```js
/**
 * runtime/attachments.js
 * CRUD for work item attachments. Emits work_item.attachment_added /
 * attachment_removed events inside the same transaction.
 */

import crypto from 'node:crypto'
import { pool } from '../db/postgres.js'
import { generateUri } from '../core/uri.js'
import { emitEvent, nudgeAfterCommit } from '../core/events.js'
import { getStorage, buildStorageKey } from '../core/storage/index.js'

export async function listAttachments(workItemId) {
  const r = await pool.query(`
    SELECT a.id, a.uri, a.work_item_id, a.kind,
           a.storage_key, a.file_name, a.file_size_bytes, a.mime_type,
           a.url, a.url_title,
           a.uploaded_by_user_id, a.uploaded_at,
           u.display_name AS uploaded_by_name
    FROM runtime.attachments a
    LEFT JOIN blueprint.users u ON u.id = a.uploaded_by_user_id
    WHERE a.work_item_id = $1
    ORDER BY a.uploaded_at DESC, a.id DESC
  `, [workItemId])
  return r.rows
}

export async function getAttachment(attachmentId) {
  const r = await pool.query(
    `SELECT * FROM runtime.attachments WHERE id = $1`,
    [attachmentId]
  )
  return r.rows[0] || null
}

export async function createFileAttachment({ workItemId, fileName, mimeType, buffer, userId }) {
  const storage = getStorage()
  const uuid = crypto.randomUUID()
  const storageKey = buildStorageKey(uuid)

  // Write bytes BEFORE the DB transaction so a failed write doesn't leave
  // a row pointing at missing data. If the DB tx then fails, we orphan
  // the file on disk — accept that for v1; a janitor task can sweep later.
  await storage.put(storageKey, buffer)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const uri = generateUri('system', 'attachments')
    const ins = await client.query(`
      INSERT INTO runtime.attachments
        (uri, work_item_id, kind, storage_key, file_name, file_size_bytes, mime_type, uploaded_by_user_id)
      VALUES ($1, $2, 'file', $3, $4, $5, $6, $7)
      RETURNING id, uri, work_item_id, kind, storage_key, file_name, file_size_bytes,
                mime_type, url, url_title, uploaded_by_user_id, uploaded_at
    `, [uri, workItemId, storageKey, fileName, buffer.length, mimeType || null, userId])
    const row = ins.rows[0]

    await emitEvent(client, {
      eventType: 'work_item.attachment_added',
      entityId: workItemId,
      actorId: userId,
      payload: {
        attachment_id: row.id,
        kind: 'file',
        file_name: fileName,
        file_size_bytes: buffer.length,
        mime_type: mimeType || null,
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return row
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    // Best effort: clean up the orphan file we just wrote.
    await storage.delete(storageKey).catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function createLinkAttachment({ workItemId, url, title, userId }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const uri = generateUri('system', 'attachments')
    const ins = await client.query(`
      INSERT INTO runtime.attachments
        (uri, work_item_id, kind, url, url_title, uploaded_by_user_id)
      VALUES ($1, $2, 'link', $3, $4, $5)
      RETURNING id, uri, work_item_id, kind, storage_key, file_name, file_size_bytes,
                mime_type, url, url_title, uploaded_by_user_id, uploaded_at
    `, [uri, workItemId, url, title || null, userId])
    const row = ins.rows[0]

    await emitEvent(client, {
      eventType: 'work_item.attachment_added',
      entityId: workItemId,
      actorId: userId,
      payload: {
        attachment_id: row.id,
        kind: 'link',
        url,
        url_title: title || null,
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
    return row
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function deleteAttachment({ attachmentId, userId }) {
  const att = await getAttachment(attachmentId)
  if (!att) return { deleted: false, reason: 'not_found' }

  const storage = getStorage()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM runtime.attachments WHERE id = $1`, [attachmentId])
    await emitEvent(client, {
      eventType: 'work_item.attachment_removed',
      entityId: att.work_item_id,
      actorId: userId,
      payload: {
        attachment_id: attachmentId,
        kind: att.kind,
        file_name: att.file_name || null,
        url: att.url || null,
      },
    })
    await client.query('COMMIT')
    nudgeAfterCommit()
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  if (att.kind === 'file' && att.storage_key) {
    await storage.delete(att.storage_key).catch(() => {})
  }
  return { deleted: true, attachment: att }
}
```

- [ ] **Step 2: Lint check**

Run: `npx eslint runtime/attachments.js core/storage/`
Expected: no errors. (If the project still has no eslint config, the carry-over P2 from the TODO applies — proceed without lint.)

- [ ] **Step 3: Commit**

```bash
git add runtime/attachments.js
git commit -m "feat(attachments): runtime CRUD with event emission"
```

---

### Task 5: API endpoints — list, upload file, add link

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 1: Add multer + handlers**

At the top of `admin/api.js`, near the other imports, add:

```js
import multer from 'multer'
import {
  listAttachments,
  createFileAttachment,
  createLinkAttachment,
  deleteAttachment,
  getAttachment,
} from '../runtime/attachments.js'
import { getStorage, MAX_ATTACHMENT_BYTES } from '../core/storage/index.js'

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
})
```

Then, near the comment routes (search for `/work-items/:id/comments` to find the area), add:

```js
router.get('/work-items/:id/attachments', async (req, res, next) => {
  try {
    const workItemId = Number(req.params.id)
    if (!Number.isInteger(workItemId)) return res.status(400).json({ error: 'invalid work item id' })
    const rows = await listAttachments(workItemId)
    res.json({ attachments: rows })
  } catch (err) { next(err) }
})

router.post('/work-items/:id/attachments',
  (req, res, next) => {
    // Route by Content-Type: multipart = file, json = link.
    const ct = req.headers['content-type'] || ''
    if (ct.startsWith('multipart/form-data')) {
      attachmentUpload.single('file')(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `file exceeds ${MAX_ATTACHMENT_BYTES} bytes` })
        }
        if (err) return next(err)
        next()
      })
    } else {
      next()
    }
  },
  async (req, res, next) => {
    try {
      const workItemId = Number(req.params.id)
      if (!Number.isInteger(workItemId)) return res.status(400).json({ error: 'invalid work item id' })

      const userId = req.session?.userId
      if (!userId) return res.status(401).json({ error: 'auth required' })

      // Verify work item exists.
      const wi = await pool.query(`SELECT id FROM runtime.work_items WHERE id = $1`, [workItemId])
      if (wi.rowCount === 0) return res.status(404).json({ error: 'work item not found' })

      if (req.file) {
        const row = await createFileAttachment({
          workItemId,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          buffer: req.file.buffer,
          userId,
        })
        return res.status(201).json({ attachment: row })
      }

      // Link path
      const { url, title } = req.body || {}
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url required for link attachment' })
      }
      const row = await createLinkAttachment({
        workItemId,
        url,
        title: title || null,
        userId,
      })
      return res.status(201).json({ attachment: row })
    } catch (err) { next(err) }
  }
)
```

(The `pool` import already exists at the top of `admin/api.js`. If not, add `import { pool } from '../db/postgres.js'`.)

- [ ] **Step 2: Restart dev server, smoke test list endpoint**

The dev server (`npm run dev`) auto-reloads. Wait for restart, then:

```bash
# Get a session cookie via the test login flow first; see tests/helpers/auth.js.
# For an ad-hoc smoke test:
curl -i -b cookies.txt http://localhost:3000/admin/api/work-items/1/attachments
```

Expected: `200 OK`, body `{"attachments":[]}` for a fresh work item.

- [ ] **Step 3: Commit**

```bash
git add admin/api.js package.json package-lock.json
git commit -m "feat(attachments): GET list and POST endpoints (file + link)"
```

---

### Task 6: API endpoints — download and delete

**Files:**
- Modify: `admin/api.js`

- [ ] **Step 1: Add download + delete handlers**

After the POST handler from Task 5, append:

```js
router.get('/work-items/:id/attachments/:attId/download', async (req, res, next) => {
  try {
    const attachmentId = Number(req.params.attId)
    if (!Number.isInteger(attachmentId)) return res.status(400).json({ error: 'invalid attachment id' })
    const att = await getAttachment(attachmentId)
    if (!att) return res.status(404).json({ error: 'attachment not found' })
    if (att.work_item_id !== Number(req.params.id)) {
      return res.status(404).json({ error: 'attachment not found' })
    }
    if (att.kind !== 'file') {
      return res.status(400).json({ error: 'only file attachments can be downloaded' })
    }
    const storage = getStorage()
    res.setHeader('Content-Type', att.mime_type || 'application/octet-stream')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${att.file_name.replace(/"/g, '')}"`
    )
    if (att.file_size_bytes) res.setHeader('Content-Length', att.file_size_bytes)
    const stream = storage.getReadStream(att.storage_key)
    stream.on('error', next)
    stream.pipe(res)
  } catch (err) { next(err) }
})

router.delete('/work-items/:id/attachments/:attId', async (req, res, next) => {
  try {
    const attachmentId = Number(req.params.attId)
    const workItemId = Number(req.params.id)
    if (!Number.isInteger(attachmentId) || !Number.isInteger(workItemId)) {
      return res.status(400).json({ error: 'invalid id' })
    }
    const userId = req.session?.userId
    if (!userId) return res.status(401).json({ error: 'auth required' })

    const att = await getAttachment(attachmentId)
    if (!att || att.work_item_id !== workItemId) {
      return res.status(404).json({ error: 'attachment not found' })
    }

    // Permission: uploader OR admin can delete.
    const isUploader = att.uploaded_by_user_id === userId
    const adminRes = await pool.query(
      `SELECT is_admin FROM blueprint.users WHERE id = $1`,
      [userId]
    )
    const isAdmin = adminRes.rows[0]?.is_admin === true
    if (!isUploader && !isAdmin) {
      return res.status(403).json({ error: 'only the uploader or an admin can delete this attachment' })
    }

    const result = await deleteAttachment({ attachmentId, userId })
    res.json({ deleted: true, id: attachmentId })
  } catch (err) { next(err) }
})
```

- [ ] **Step 2: Smoke test download (manual; use UI in Task 13)**

For now, just confirm the route is registered:

```bash
curl -i -b cookies.txt http://localhost:3000/admin/api/work-items/1/attachments/999999/download
```

Expected: `404 Not Found` body `{"error":"attachment not found"}`.

- [ ] **Step 3: Commit**

```bash
git add admin/api.js
git commit -m "feat(attachments): GET download and DELETE endpoints with permission check"
```

---

### Task 7: Integration tests

**Files:**
- Create: `tests/attachments-api.test.js`

- [ ] **Step 1: Write the test file**

Create `tests/attachments-api.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { login, request } from './helpers/auth.js'

const BASE = 'http://localhost:3000'

async function pickWorkItem(cookie) {
  const r = await fetch(`${BASE}/admin/api/work-items?limit=1`, { headers: { cookie } })
  const body = await r.json()
  assert.ok(body.workItems?.length, 'expected at least one work item to test against')
  return body.workItems[0].id
}

test('attachments: list is empty initially', async () => {
  const { cookie } = await login()
  const id = await pickWorkItem(cookie)
  const r = await fetch(`${BASE}/admin/api/work-items/${id}/attachments`, { headers: { cookie } })
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.ok(Array.isArray(body.attachments))
})

test('attachments: upload a file roundtrips list + download', async () => {
  const { cookie } = await login()
  const id = await pickWorkItem(cookie)

  const fd = new FormData()
  fd.set('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/octet-stream' }), 'hello.bin')

  const up = await fetch(`${BASE}/admin/api/work-items/${id}/attachments`, {
    method: 'POST',
    headers: { cookie },
    body: fd,
  })
  assert.equal(up.status, 201, await up.text())
  const { attachment } = await up.json()
  assert.equal(attachment.kind, 'file')
  assert.equal(attachment.file_name, 'hello.bin')
  assert.equal(attachment.file_size_bytes, 4)

  const list = await fetch(`${BASE}/admin/api/work-items/${id}/attachments`, { headers: { cookie } })
  const listBody = await list.json()
  assert.ok(listBody.attachments.some(a => a.id === attachment.id))

  const dl = await fetch(`${BASE}/admin/api/work-items/${id}/attachments/${attachment.id}/download`, {
    headers: { cookie },
  })
  assert.equal(dl.status, 200)
  const buf = Buffer.from(await dl.arrayBuffer())
  assert.deepEqual([...buf], [1, 2, 3, 4])

  // cleanup
  const del = await fetch(`${BASE}/admin/api/work-items/${id}/attachments/${attachment.id}`, {
    method: 'DELETE',
    headers: { cookie },
  })
  assert.equal(del.status, 200)
})

test('attachments: link attachment with title', async () => {
  const { cookie } = await login()
  const id = await pickWorkItem(cookie)
  const r = await fetch(`${BASE}/admin/api/work-items/${id}/attachments`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/spec.pdf', title: 'Spec' }),
  })
  assert.equal(r.status, 201, await r.text())
  const { attachment } = await r.json()
  assert.equal(attachment.kind, 'link')
  assert.equal(attachment.url, 'https://example.com/spec.pdf')
  assert.equal(attachment.url_title, 'Spec')

  await fetch(`${BASE}/admin/api/work-items/${id}/attachments/${attachment.id}`, {
    method: 'DELETE',
    headers: { cookie },
  })
})

test('attachments: link without url is 400', async () => {
  const { cookie } = await login()
  const id = await pickWorkItem(cookie)
  const r = await fetch(`${BASE}/admin/api/work-items/${id}/attachments`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'no url' }),
  })
  assert.equal(r.status, 400)
})

test('attachments: file over size limit is 413', async () => {
  const { cookie } = await login()
  const id = await pickWorkItem(cookie)
  // 26 MB > 25 MB default
  const big = new Uint8Array(26 * 1024 * 1024)
  const fd = new FormData()
  fd.set('file', new Blob([big], { type: 'application/octet-stream' }), 'big.bin')

  const r = await fetch(`${BASE}/admin/api/work-items/${id}/attachments`, {
    method: 'POST',
    headers: { cookie },
    body: fd,
  })
  assert.equal(r.status, 413)
})

test('attachments: delete by non-uploader non-admin is 403', async () => {
  // This test depends on having two users; if the test helpers only support one,
  // skip via assert.ok(true) and capture a manual-verify TODO. See helpers/auth.js.
  const { cookie } = await login()
  const id = await pickWorkItem(cookie)
  const r = await fetch(`${BASE}/admin/api/work-items/${id}/attachments`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com', title: 'temp' }),
  })
  const { attachment } = await r.json()

  // Try to log in as a different non-admin user, if available
  let secondCookie
  try {
    secondCookie = (await login({ email: 'tester2@flowos.local' })).cookie
  } catch {
    // single-user test setup — clean up the attachment and skip
    await fetch(`${BASE}/admin/api/work-items/${id}/attachments/${attachment.id}`, {
      method: 'DELETE', headers: { cookie },
    })
    return
  }

  const del = await fetch(`${BASE}/admin/api/work-items/${id}/attachments/${attachment.id}`, {
    method: 'DELETE', headers: { cookie: secondCookie },
  })
  assert.equal(del.status, 403)
  await fetch(`${BASE}/admin/api/work-items/${id}/attachments/${attachment.id}`, {
    method: 'DELETE', headers: { cookie },
  })
})
```

- [ ] **Step 2: Run the test file**

Run: `node --test tests/attachments-api.test.js`

Expected: 6 tests, all pass (the multi-user test will silently skip if there's only one seeded user).

- [ ] **Step 3: Run the full suite**

Run: `npm test`

Expected: at least all attachment tests pass, no regressions in other suites. The pre-existing search-* / comments-api ordering flake (TODO P2) may still appear; that's not new.

- [ ] **Step 4: Commit**

```bash
git add tests/attachments-api.test.js
git commit -m "test(attachments): integration tests for upload/list/download/delete"
```

---

### Task 8: Search index integration

**Files:**
- Modify: `runtime/subscribers/searchIndex.js`

- [ ] **Step 1: Add the new event types and pull attachment text**

Edit `runtime/subscribers/searchIndex.js`:

Update the `HANDLED` set to include the two new types:

```js
const HANDLED = new Set([
  'work_item.created',
  'work_item.edited',
  'work_item.commented',
  'work_item.comment_edited',
  'work_item.comment_deleted',
  'work_item.attachment_added',
  'work_item.attachment_removed',
])
```

Inside `searchIndexHandler`, add an attachments query alongside the existing comments query:

```js
const attachmentsRes = await query(`
  SELECT file_name, url_title, url FROM runtime.attachments WHERE work_item_id = $1
`, [workItemId])
const attachmentsText = attachmentsRes.rows
  .map(r => [r.file_name, r.url_title, r.url].filter(Boolean).join(' '))
  .join(' ')
```

Then concatenate `attachmentsText` into the `customText` weight (D), since attachment text is metadata-ish and shouldn't outrank titles. Modify the UPSERT call's `customText.trim()` argument to:

```js
(customText.trim() + ' ' + attachmentsText).trim()
```

- [ ] **Step 2: Smoke test search-index integration**

Restart the API server. Upload a file with a distinctive filename via the API or test:

```bash
# Pre-req: have a session cookie in cookies.txt
echo 'distinctive-zorblax-content' > /tmp/zorblax.txt
curl -X POST -b cookies.txt \
  -F "file=@/tmp/zorblax.txt" \
  http://localhost:3000/admin/api/work-items/1/attachments
```

Then query via search:

```bash
curl -b cookies.txt 'http://localhost:3000/admin/api/search?q=text%20~%20%22zorblax%22'
```

Expected: the returned `results` array contains work item 1.

- [ ] **Step 3: Commit**

```bash
git add runtime/subscribers/searchIndex.js
git commit -m "feat(attachments): index filenames and link titles in work_item_search"
```

---

### Task 9: Audit trail rendering

**Files:**
- Modify: `runtime/workItemHistory.js`

The file uses an allowlist `HISTORY_EVENT_TYPES` (line 10) that constrains which events are returned, and a `switch (e.event_type)` block (around line 108) that builds `{ ...base, summary, details }` per type. Both need updating.

- [ ] **Step 1: Add the two new types to the allowlist**

In the `HISTORY_EVENT_TYPES` array at line 10, append:

```js
'work_item.attachment_added',
'work_item.attachment_removed',
```

- [ ] **Step 2: Add cases to the rendering switch**

In the switch at line 108, after the existing `work_item.commented` / `work_item.linked` cases, add:

```js
case 'work_item.attachment_added': {
  const what = p.kind === 'file'
    ? (p.file_name || 'a file')
    : (p.url_title || p.url || 'a link')
  return { ...base, summary: `attached ${what}`, details: null }
}
case 'work_item.attachment_removed': {
  const what = p.kind === 'file'
    ? (p.file_name || 'a file')
    : (p.url || 'a link')
  return { ...base, summary: `removed attachment ${what}`, details: null }
}
```

(`base` and `p` are already destructured earlier in the function — same pattern as the comment/linked cases.)

- [ ] **Step 3: Verify history endpoint shows new events**

Upload a file via the API (Task 5 endpoint). Then:

```bash
curl -b cookies.txt http://localhost:3000/admin/api/work-items/1/history | python3 -m json.tool | head -40
```

Expected: a recent entry with `event_type: "work_item.attachment_added"` and a populated `summary`.

- [ ] **Step 4: Commit**

```bash
git add runtime/workItemHistory.js
git commit -m "feat(attachments): audit trail rendering for attachment events"
```

---

### Task 10: Frontend API client

**Files:**
- Modify: `admin-ui/src/lib/api.js`

- [ ] **Step 1: Add five client functions**

Find the comment-related helpers and add nearby:

```js
export async function listAttachments(workItemId) {
  const r = await fetch(`/admin/api/work-items/${workItemId}/attachments`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`listAttachments: ${r.status}`)
  return (await r.json()).attachments
}

export async function uploadAttachment(workItemId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/admin/api/work-items/${workItemId}/attachments`)
    xhr.withCredentials = true
    if (onProgress) {
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress(e.loaded / e.total)
      })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).attachment) }
        catch (e) { reject(e) }
      } else if (xhr.status === 413) {
        reject(new Error('File exceeds the maximum allowed size'))
      } else {
        reject(new Error(`uploadAttachment: ${xhr.status} ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('upload network error'))
    xhr.send(fd)
  })
}

export async function addLinkAttachment(workItemId, url, title) {
  const r = await fetch(`/admin/api/work-items/${workItemId}/attachments`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, title }),
  })
  if (!r.ok) throw new Error(`addLinkAttachment: ${r.status}`)
  return (await r.json()).attachment
}

export function attachmentDownloadUrl(workItemId, attachmentId) {
  return `/admin/api/work-items/${workItemId}/attachments/${attachmentId}/download`
}

export async function deleteAttachment(workItemId, attachmentId) {
  const r = await fetch(`/admin/api/work-items/${workItemId}/attachments/${attachmentId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!r.ok) throw new Error(`deleteAttachment: ${r.status}`)
  return (await r.json())
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-ui/src/lib/api.js
git commit -m "feat(attachments): admin-ui API client functions"
```

---

### Task 11: AttachmentsList component

**Files:**
- Create: `admin-ui/src/components/AttachmentsList.jsx`

- [ ] **Step 1: Write the component**

Create `admin-ui/src/components/AttachmentsList.jsx`:

```jsx
import { Trash2, FileText, Image as ImageIcon, Link as LinkIcon, Download } from 'lucide-react'
import { attachmentDownloadUrl, deleteAttachment } from '../lib/api'
import { Button } from './ui/button'

function formatBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function iconFor(att) {
  if (att.kind === 'link') return LinkIcon
  if (att.mime_type?.startsWith('image/')) return ImageIcon
  return FileText
}

export default function AttachmentsList({ workItemId, attachments, currentUserId, isAdmin, onChanged }) {
  if (!attachments?.length) {
    return <div className="text-xs text-muted-foreground">No attachments yet.</div>
  }

  async function handleDelete(att) {
    if (!confirm(`Remove ${att.file_name || att.url_title || att.url}?`)) return
    await deleteAttachment(workItemId, att.id)
    onChanged?.()
  }

  return (
    <ul className="divide-y divide-black/5">
      {attachments.map(att => {
        const Icon = iconFor(att)
        const canDelete = att.uploaded_by_user_id === currentUserId || isAdmin
        const label = att.kind === 'file' ? att.file_name : (att.url_title || att.url)
        const meta = att.kind === 'file'
          ? `${formatBytes(att.file_size_bytes)} · ${att.uploaded_by_name || ''}`
          : (att.uploaded_by_name || '')

        return (
          <li key={att.id} className="flex items-center gap-2 py-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              {att.kind === 'file' ? (
                <a
                  className="text-sm hover:underline truncate block"
                  href={attachmentDownloadUrl(workItemId, att.id)}
                  download={att.file_name}
                >
                  {label}
                </a>
              ) : (
                <a
                  className="text-sm hover:underline truncate block"
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label}
                </a>
              )}
              <div className="text-xs text-muted-foreground truncate">{meta}</div>
            </div>
            {att.kind === 'file' && (
              <a
                className="p-1 rounded hover:bg-black/[0.03]"
                href={attachmentDownloadUrl(workItemId, att.id)}
                download={att.file_name}
                aria-label="Download"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleDelete(att)}
                aria-label="Remove attachment"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-ui/src/components/AttachmentsList.jsx
git commit -m "feat(attachments): AttachmentsList component"
```

---

### Task 12: AttachmentUpload component (file + link + camera)

**Files:**
- Create: `admin-ui/src/components/AttachmentUpload.jsx`

- [ ] **Step 1: Write the component**

Create `admin-ui/src/components/AttachmentUpload.jsx`:

```jsx
import { useRef, useState } from 'react'
import { Upload, Camera, Link as LinkIcon } from 'lucide-react'
import { uploadAttachment, addLinkAttachment } from '../lib/api'
import { Button } from './ui/button'
import { Input } from './ui/input'

export default function AttachmentUpload({ workItemId, onUploaded }) {
  const fileRef = useRef(null)
  const cameraRef = useRef(null)
  const [linkMode, setLinkMode] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  async function handleFiles(files) {
    setError(null)
    for (const f of files) {
      try {
        setProgress(0)
        await uploadAttachment(workItemId, f, p => setProgress(p))
        onUploaded?.()
      } catch (e) {
        setError(e.message)
      } finally {
        setProgress(null)
      }
    }
  }

  async function handleAddLink() {
    setError(null)
    if (!linkUrl.trim()) return
    try {
      await addLinkAttachment(workItemId, linkUrl.trim(), linkTitle.trim() || null)
      setLinkUrl(''); setLinkTitle(''); setLinkMode(false)
      onUploaded?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5 mr-1.5" /> Add file
        </Button>
        <Button variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
          <Camera className="h-3.5 w-3.5 mr-1.5" /> Take photo
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLinkMode(v => !v)}>
          <LinkIcon className="h-3.5 w-3.5 mr-1.5" /> Add link
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          multiple
          onChange={e => { handleFiles([...e.target.files]); e.target.value = '' }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => { handleFiles([...e.target.files]); e.target.value = '' }}
        />
      </div>

      {linkMode && (
        <div className="space-y-1.5 border border-black/5 rounded p-2">
          <Input
            placeholder="https://..."
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
          />
          <Input
            placeholder="Title (optional)"
            value={linkTitle}
            onChange={e => setLinkTitle(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddLink}>Save link</Button>
            <Button size="sm" variant="ghost" onClick={() => setLinkMode(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {progress !== null && (
        <div className="text-xs text-muted-foreground">Uploading… {Math.round(progress * 100)}%</div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-ui/src/components/AttachmentUpload.jsx
git commit -m "feat(attachments): upload component with file, camera, and link modes"
```

---

### Task 13: Wire into WorkItemDetail

**Files:**
- Modify: `admin-ui/src/pages/WorkItemDetail.jsx`

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "Comments\|TabsContent\|Details" admin-ui/src/pages/WorkItemDetail.jsx | head -20`

Find a good spot in the Details tab — between the description block and the Comments/People sections is natural.

- [ ] **Step 2: Add imports + state**

At the top of the file:

```jsx
import AttachmentsList from '../components/AttachmentsList'
import AttachmentUpload from '../components/AttachmentUpload'
import { listAttachments } from '../lib/api'
```

Inside the component, add state and a loader (model after how comments are loaded — there's already a pattern):

```jsx
const [attachments, setAttachments] = useState([])

async function loadAttachments() {
  if (!workItem?.id) return
  try {
    setAttachments(await listAttachments(workItem.id))
  } catch { /* ignore */ }
}

useEffect(() => { loadAttachments() }, [workItem?.id])
```

- [ ] **Step 3: Render the section**

In the Details tab JSX:

```jsx
<section className="space-y-2">
  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
    Attachments
  </div>
  <AttachmentUpload workItemId={workItem.id} onUploaded={loadAttachments} />
  <AttachmentsList
    workItemId={workItem.id}
    attachments={attachments}
    currentUserId={currentUser?.id}
    isAdmin={currentUser?.is_admin}
    onChanged={loadAttachments}
  />
</section>
```

(`currentUser` is already wired in `WorkItemDetail`; if not, follow how `Comments` accesses it and replicate.)

- [ ] **Step 4: Visual smoke test**

Open `http://localhost:5173/admin/`, navigate to a work item, open the drawer. Verify:
- "Attachments" section renders with three buttons (Add file / Take photo / Add link)
- File upload works end-to-end (small file)
- File appears in the list, click downloads it
- Link upload works
- Delete button removes the row
- Activity tab shows `attached <name>` event after upload

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/pages/WorkItemDetail.jsx
git commit -m "feat(attachments): integrate attachments section into WorkItemDetail"
```

---

### Task 14: Production build of admin-ui

**Files:**
- Modify: `admin-ui/dist/` (build artifact, committed per repo convention)

- [ ] **Step 1: Build**

Run: `cd admin-ui && npm run build`
Expected: build succeeds, dist regenerates. Bundle warning may appear (existing TODO P2).

- [ ] **Step 2: Smoke test the built version**

Browse to `http://localhost:3000/admin/` (the API serves the dist) and re-run the visual smoke test from Task 13.

- [ ] **Step 3: Commit**

```bash
git add admin-ui/dist
git commit -m "build(admin-ui): dist with attachments UI"
```

---

### Task 15: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add an Attachments section under Key Patterns**

After the Search section, add:

```markdown
- **Attachments:** `runtime.attachments` holds files (kind='file', written via
  pluggable storage adapter — local fs in v1, S3 designed not built) and links
  (kind='link'). Per-file cap from `FLOWOS_MAX_ATTACHMENT_MB` (default 25).
  Endpoints: `GET /work-items/:id/attachments`, `POST` (multipart=file,
  json=link), `GET .../:attId/download`, `DELETE .../:attId` (uploader or
  admin only). Events `work_item.attachment_added` and
  `work_item.attachment_removed` flow through the search-index subscriber
  (filenames + link titles indexed in the D-weight custom_text) and are
  rendered in the Activity tab. **Stage-evidence requirements are NOT
  built yet** — that's a follow-up feature; attachments today have no
  exit-criteria semantics.
```

Also update the `Last updated` line and the Key Files table:

```
| `runtime/attachments.js` | Attachment CRUD + event emission |
| `core/storage/index.js` | Storage adapter factory + size limit constant |
| `core/storage/localStorage.js` | Local filesystem storage adapter |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(attachments): add to CLAUDE.md Key Patterns and Key Files"
```

---

## Verification Checklist (post-execution)

Before declaring the feature done, verify:

- [ ] `npm test` passes (attachments suite green; no regressions on workflow-api or comments-api beyond the known ordering flake)
- [ ] Manual UI smoke: file upload, link add, mobile camera capture (test on a phone or with devtools device emulation), file download, delete-as-uploader, delete-as-admin, oversized file blocked
- [ ] Search smoke: upload file with distinctive filename → search finds the work item
- [ ] Activity tab shows `attached X` and `removed attachment X` events
- [ ] `curl -i .../attachments` for an unauthenticated request returns 401
- [ ] `uploads/` directory contains the sharded `<aa>/<uuid>` files; deleting an attachment removes the file
- [ ] No `console.error` in browser devtools on a fresh load with attachments visible

## Follow-up plan triggers

After this lands, the following plans become unblocked:

1. **Stage evidence v2** — `blueprint.stage_evidence_requirements` (named slots: "Permit to Operate", description, accepted MIME types) + `runtime.evidence_fulfillments` (attachment ↔ slot binding). Exit-criteria gate transitions when required slots are unfilled. UI: per-stage requirement list with "select existing" / "upload new" / "take photo" actions per slot.
2. **S3/MinIO storage adapter** — implement `core/storage/s3Storage.js` against `getStorage()` interface; switch via `FLOWOS_STORAGE_TYPE=s3`.
3. **Attachment exit-criteria expressions** — once stage-evidence v2 is real-world tested, decide whether generic predicates (`attachments > 0`, `attachments.name = *invoice*`) are still needed.
