# FlowOS — TODO

## Flagged Items from Last Session (2026-05-06, Session 23)

Bring up at the start of the next session:

- **Search v1 shipped** (24 commits on `main`, ahead of origin until pushed). New endpoints
  `GET /search`, `GET /search/fields`, `POST /search/translate`, `GET|POST|PATCH|DELETE /saved-filters`.
  76/76 unit + integration tests green; smoke verified end-to-end in browser via Playwright.
- **[P0] Manual Haiku translator smoke against real Anthropic endpoint** — translator never exercised
  with `ANTHROPIC_API_KEY` set in this session. Set the env var, restart the server, hit
  `POST /admin/api/search/translate` with `{ "prompt": "show my open P1 items" }`. Verify the JQL parses
  and budgets are tracked in `runtime.translator_usage`. Cap-breach behavior (rate_limited / budget_exhausted)
  needs at least one real-traffic exercise.
- **[P1] Migrate WorkItemDetail's related-item picker** off legacy `/work-items/search` and onto the new
  `/search` (e.g., JQL like `key ~ "X" OR title ~ "X" ORDER BY updated DESC LIMIT 20`). Then delete the
  legacy endpoint. Plan called for removal but it's still in use; tech debt.
- **[P1] Comment edit / delete endpoints + event emissions** — searchIndex subscriber declares
  `work_item.comment_edited` and `comment_deleted` handlers but the API doesn't expose PATCH/DELETE on
  comments yet (comments are immutable). When those endpoints land, wire `emitEvent` so the search
  index refreshes.
- **[P2] WorkItemDetail Sheet a11y** — Radix logged `DialogContent requires a DialogTitle` during
  smoke. The existing component is missing a SheetTitle (or a VisuallyHidden wrapper). Not new in this
  session; surfaced because SearchPage opened the drawer.
- **[P2] Real RBAC for org-visibility** — compiler currently does a hard `is_admin` bypass; the right
  long-term shape is access-class permissions checked against `core/access.js`. Blocked on the
  auth-system buildout (see `project_auth_system` memory).
- **[P2] Bundle size warning** — admin-ui dist now 898 KB (253 KB gzip). Vite suggests dynamic imports
  / manualChunks. Search added the JQL editor + Anthropic SDK bringing it past the 500 KB warning.
  Cosmetic until the second-load latency starts mattering.

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
