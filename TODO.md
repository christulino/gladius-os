# FlowOS — TODO

## Flagged Items from Last Session (2026-05-07, Session 24)

Bring up at the start of the next session:

- **Search v1 follow-ups complete.** Translator smoke-tested with real Anthropic key (1 real bug
  found and fixed: `timeout` was inside the request body instead of SDK request options — every
  call returned a misclassified 504). WorkItemDetail picker migrated to `/search`; legacy
  `/work-items/search` deleted. `~` operator now compiles to `to_tsquery` with `:*` prefix tokens
  so partial typing matches; `display_key` is in the title-weight tsvector. 25,239 rows
  backfilled. Browser-verified end to end.
- **[P1] Comment edit / delete endpoints + event emissions** (carried from session 23) —
  searchIndex subscriber declares `work_item.comment_edited` and `comment_deleted` handlers
  but the API doesn't expose PATCH/DELETE on comments yet. When those endpoints land, wire
  `emitEvent` so the search index refreshes.
- **[P2] Test isolation between search-* and comments-api** — comments-api fails 6 tests when run
  AFTER search-* in the same `node --test` invocation; passes 10/10 alone. Same shape as the
  pre-existing events/notifications baseline flake. The test's `before` does
  `SELECT first work_item from /work-items?limit=1` which gets churned by search test fixtures.
  Cleaner: have each test file create its own scratch work_item. Not a code regression.
- **[P2] WorkItemDetail Sheet a11y** (carried) — Radix logs `DialogContent requires a
  DialogTitle`. Existing component missing SheetTitle (or VisuallyHidden wrapper).
- **[P2] Real RBAC for org-visibility** (carried) — compiler currently does a hard `is_admin`
  bypass; long-term shape is access-class permissions in `core/access.js`. Blocked on
  auth-system buildout (see `project_auth_system` memory).
- **[P2] Bundle size warning** (carried) — admin-ui dist 898 KB (253 KB gzip). Vite suggests
  dynamic imports / manualChunks. Cosmetic until second-load latency starts mattering.

## Carried from Session 22 (still open)

- **[P1] Manual browser verification of the Activity tab** — separate from search smoke. Integration
  tests cover the API contract; the rendering wasn't clicked through.
- **Audit trail v2 candidates**: event-type filter, search-within-history, diff viewer for long text,
  click-through to spawned children. None required for v1.

## Carried from Session 21 (still open)

- Manual smoke tests of all 3 outbound notification channels (webhook, SMTP, agent-channel against real LLM).
- Orphan `runtime.notification_preferences` table — cleanup migration (call it 015).
- Missing ESLint config — every subagent flags it; add a config or remove the rule from CLAUDE.md.

## Cross-cutting

- **Open-source release blockers**: README, LICENSE, seed-and-go (`docker-compose up` → working board),
  cross-instance service requests. Worth sequencing before the next feature push if going public soon.
- **Agent Collaboration v1 design spec** still queued — bidirectional protocol, context engine, tool-use
  policies, response handling. The notifications agent-channel reservation remains forward-compatible.
- **Schema migration sweep** — project still uses v1 doc layout (TODO/PARKING_LOT). PROJECT_SCHEMA.md
  defines STATE/BACKLOG/DECISIONS/GOALS/RISKS/QUESTIONS. Worth a dedicated session to migrate.

## Done (Session 24)

- [done 2026-05-07] fix(search): Anthropic SDK timeout option moved to request-options arg (translator was 100% broken with real key)
- [done 2026-05-07] feat(search): `~` operator compiles to to_tsquery with `:*` prefix-suffix
- [done 2026-05-07] feat(search): display_key concatenated into title-weight search_doc tsvector
- [done 2026-05-07] feat(search): WorkItemDetail picker migrated to /search; legacy /work-items/search deleted
- [done 2026-05-07] chore(search): backfill of 25,239 work_item_search rows
- [done 2026-05-07] build(admin-ui): dist rebuild with prefix-match picker
- [done 2026-05-07] test(search): updated `~` compile-test, added multi-word and empty-input cases

## Done (Session 23)

- [done 2026-05-06] feat(search): migration 014 — work_item_search, saved_filters, reserved_field_keys, translator_usage
- [done 2026-05-06] feat(search): peggy JQL grammar + parser + JQLSyntaxError/JQLSemanticError
- [done 2026-05-06] feat(search): JQL compiler — parameterized SQL, org-scope (admin bypass), done-retention
- [done 2026-05-06] feat(search): per-user field catalog (60s cache)
- [done 2026-05-06] feat(search): search-index event subscriber + 25,237-item backfill
- [done 2026-05-06] feat(search): Haiku NL→JQL translator with abuse hardening (input cap, budgets, output filter, retry)
- [done 2026-05-06] feat(search): reserved-key validator on POST /class-fields and POST /type-fields
- [done 2026-05-06] feat(search): API endpoints — /search, /search/fields, /search/translate, /saved-filters CRUD
- [done 2026-05-06] feat(search): admin-ui SearchPage with JQLEditor, SavedFiltersList, SearchResultRow
- [done 2026-05-06] feat(search): sidebar Search nav, header search icon, '/' keybinding
- [done 2026-05-06] test(search): 63 unit tests + 13 integration tests, all passing
- [done 2026-05-06] fix(search): work_item_user_relationships table name; admin org bypass
- [done 2026-05-06] chore(build): @anthropic-ai/sdk + peggy added; admin-ui dist rebuilt
