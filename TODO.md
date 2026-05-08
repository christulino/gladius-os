# FlowOS — TODO

## Flagged Items from Last Session (2026-05-08, Session 25)

Bring up at the start of the next session:

- **Attachments v1 shipped end-to-end.** Migration 015, pluggable storage adapter
  (local fs default, 25 MB cap), 5 REST endpoints, multer for multipart, search-index
  + audit-trail integration, UI in WorkItemDetail with file/camera/link upload. 24
  commits merged to `main` and pushed. 7/7 integration tests green; browser-verified
  end-to-end. Two follow-up plans queued in the feature plan's "Follow-up plan
  triggers" section: stage-evidence requirements (named slots) and S3/MinIO adapter.
- **[P1] Stage-evidence requirements** — the second half of the original "evidence"
  mental model. Per-stage named slots ("Permit to Operate", "Copy of CDL") with
  accepted MIME types, fulfilled by binding existing or newly-uploaded attachments.
  Gates stage transition. Design: `blueprint.stage_evidence_requirements` +
  `runtime.evidence_fulfillments` join. Brainstorm before plan.
- **[P1] S3/MinIO storage adapter** — `core/storage/s3Storage.js` against the existing
  `getStorage()` interface. Single new file + an `else if (TYPE === 's3')` in the
  factory. Worth doing whenever a self-hoster asks, or before public release.
- **[P2] Attachment-event janitor** — files written to `./uploads` before the DB tx
  commits are orphaned if the process crashes between `storage.put()` and `BEGIN`.
  Best-effort catch-block cleanup handles tx failure but not crash. Janitor task to
  scan for orphan files (file on disk with no matching `runtime.attachments.storage_key`)
  and remove them.
- **[P2] Notifications subscriber for attachment events** — `runtime/subscribers/notifications.js`
  has a hardcoded HANDLED set that doesn't include `work_item.attachment_added` /
  `attachment_removed`. Watchers on busy work items get no notification when attachments
  land. Reasonable v1 scope but worth wiring when notifications v2 lands.
- **[P2] `auth.me()` stale within session** — admin-status display in WorkItemDetail
  is fetched once on mount and cached. Server enforces permissions either way; this is
  cosmetic only.
- **[P2] Non-ASCII filename `filename*=UTF-8''…` form** — already implemented per
  RFC 6266, but worth a manual test with CJK / emoji filenames in a real browser
  before fully trusting it.

## Carried from Session 24 (still open)

- **[P1] Comment edit / delete endpoints + event emissions** —
  searchIndex subscriber declares `work_item.comment_edited` and `comment_deleted` handlers
  but the API doesn't expose PATCH/DELETE on comments yet. When those endpoints land, wire
  `emitEvent` so the search index refreshes.
- **[P2] Test isolation between search-* and comments-api** — comments-api fails 6 tests when run
  AFTER search-* in the same `node --test` invocation; passes 10/10 alone. Same shape as the
  pre-existing events/notifications baseline flake. The test's `before` does
  `SELECT first work_item from /work-items?limit=1` which gets churned by search test fixtures.
  Cleaner: have each test file create its own scratch work_item. Not a code regression.
  **(Worse than recorded — full `npm test` now hangs `node --test` workers; killed manually
  during attachments session 25. P2 priority is probably under-graded; may want a P1 sweep.)**
- **[P2] WorkItemDetail Sheet a11y** (carried) — Radix logs `DialogContent requires a
  DialogTitle`. Existing component missing SheetTitle (or VisuallyHidden wrapper).
- **[P2] Real RBAC for org-visibility** (carried) — compiler currently does a hard `is_admin`
  bypass; long-term shape is access-class permissions in `core/access.js`. Blocked on
  auth-system buildout (see `project_auth_system` memory).
- **[P2] Bundle size warning** (carried) — admin-ui dist 906 KB (255 KB gzip). Vite suggests
  dynamic imports / manualChunks. Cosmetic until second-load latency starts mattering.

## Carried from Session 22 (still open)

- **[P1] Manual browser verification of the Activity tab** — separate from search smoke. Integration
  tests cover the API contract; the rendering wasn't clicked through.
- **Audit trail v2 candidates**: event-type filter, search-within-history, diff viewer for long text,
  click-through to spawned children. None required for v1.

## Carried from Session 21 (still open)

- Manual smoke tests of all 3 outbound notification channels (webhook, SMTP, agent-channel against real LLM).
- Orphan `runtime.notification_preferences` table — cleanup migration (call it 016, since 015 is now used).
- Missing ESLint config — every subagent flags it; add a config or remove the rule from CLAUDE.md.

## Cross-cutting

- **Open-source release blockers**: README, LICENSE, seed-and-go (`docker-compose up` → working board),
  cross-instance service requests. Worth sequencing before the next feature push if going public soon.
- **Agent Collaboration v1 design spec** still queued — bidirectional protocol, context engine, tool-use
  policies, response handling. The notifications agent-channel reservation remains forward-compatible.
- **Schema migration sweep** — project still uses v1 doc layout (TODO/PARKING_LOT). PROJECT_SCHEMA.md
  defines STATE/BACKLOG/DECISIONS/GOALS/RISKS/QUESTIONS. Worth a dedicated session to migrate.

## Done (Session 25)

- [done 2026-05-08] feat(attachments): migration 015 — runtime.attachments table (file + link kinds; ON DELETE CASCADE; idx_ index naming)
- [done 2026-05-08] feat(attachments): pluggable storage adapter (`core/storage/`) with local fs implementation; path-traversal guard; env-var validation at module load
- [done 2026-05-08] feat(attachments): runtime CRUD with event emission (`work_item.attachment_added` / `removed`); race-aware delete with in-tx work-item ownership check; `getClient` pattern parity with rest of runtime
- [done 2026-05-08] feat(attachments): GET list + POST (multipart=file, JSON=link) endpoints; multer with `MAX_ATTACHMENT_BYTES` limit; URL scheme guard against `javascript:`
- [done 2026-05-08] feat(attachments): GET download (RFC 6266 dual-form filename, CTL strip, mid-stream error guard) and DELETE (uploader-or-admin permission folded into runtime helper)
- [done 2026-05-08] feat(attachments): search-index subscriber concatenates filenames + link titles + URLs into D-weight `custom_text`
- [done 2026-05-08] feat(attachments): audit trail rendering — `attached X` / `removed attachment X` summaries on Activity tab
- [done 2026-05-08] feat(admin-ui): API client functions (`listAttachments`, `uploadAttachment` with XHR progress, `addLinkAttachment`, `attachmentDownloadUrl`, `deleteAttachment`); `auth.me()` import (not `api.me`)
- [done 2026-05-08] feat(admin-ui): AttachmentsList component (icons, file/link rendering, download, delete with error handling)
- [done 2026-05-08] feat(admin-ui): AttachmentUpload component (Add file / Take photo / Add link with `accept="image/*" capture="environment"` for mobile camera)
- [done 2026-05-08] feat(admin-ui): integrate Attachments section into WorkItemDetail Details tab (between People and URI)
- [done 2026-05-08] test(attachments): 7 integration tests for upload/list/download/delete + edge cases; all green
- [done 2026-05-08] build: multer dep added; `.env.example` created; `uploads/` gitignored; admin-ui dist rebuilt
- [done 2026-05-08] docs: feature plan (`feature_plans/attachments-v1.md`); CLAUDE.md Key Patterns + Key Files; PRODUCT_PLAN.md Tier 1 row 4 marked DONE; ARCHITECTURE.md Repository Structure + runtime tables updated

## Done (Session 24)

- [done 2026-05-07] fix(search): Anthropic SDK timeout option moved to request-options arg (translator was 100% broken with real key)
- [done 2026-05-07] feat(search): `~` operator compiles to to_tsquery with `:*` prefix-suffix
- [done 2026-05-07] feat(search): display_key concatenated into title-weight search_doc tsvector
- [done 2026-05-07] feat(search): WorkItemDetail picker migrated to /search; legacy /work-items/search deleted
- [done 2026-05-07] chore(search): backfill of 25,239 work_item_search rows
- [done 2026-05-07] build(admin-ui): dist rebuild with prefix-match picker
- [done 2026-05-07] test(search): updated `~` compile-test, added multi-word and empty-input cases
