# Search v1 — Design Spec

**Status:** Draft
**Authored:** 2026-05-04 (Session 23)
**Depends on:** Event system (Session 20), Notifications v1 (Session 21), Audit trail v1 (Session 22)
**Roadmap slot:** Phase 2, item 4 (Search & saved filters); fills Tier-1 blocker #3 in `PRODUCT_PLAN.md`

---

## Goal

Give users a JQL-grade query language and a saved-filter library so they can find
work outside the board. Provide a Haiku-powered natural-language fallback that
translates plain English into JQL and lets the user edit and save the result.
Replace the current title-substring `ILIKE` endpoint, which is the only "search"
FlowOS has today.

Success criteria:

- Any user can type a JQL query and get correctly-scoped results in under 300 ms
  on a 100k-work-item table.
- Users can save filters with `private` / `org` / `global` scope, name them, and
  load them with one click from a sidebar panel on the Search page.
- A user without JQL knowledge can switch to "Ask" mode, type "show me my open
  P0 bugs," and receive editable JQL from Haiku that runs against the same engine.
- Search results respect the same org-visibility rules as the board — no work
  items leak into results the user can't otherwise see.
- Free-text queries match across title, description, custom text fields, and
  comments, with snippet highlighting on the matched span.
- The whole feature works on Postgres alone; no external search index dependency.

## Non-Goals (v1)

- Filter subscriptions / "notify me when this filter has new matches" — deferred
  to v2 for scope discipline. Schema is forward-compatible (adding a
  `runtime.filter_subscriptions` table later requires no change to the v1 design).
- Federated search across orgs/users/workflows/types as standalone result types —
  v1 returns work items only.
- "Open this filter as a board" — saved filters only render as a list in v1.
- Streaming Haiku responses — single-shot translate is sufficient for a short
  JQL string.
- Multi-provider AI translation — v1 supports Anthropic only; the toggle is
  disabled if `ANTHROPIC_API_KEY` is not set.
- Saved-filter migration on schema changes (e.g., a renamed lookup value
  invalidates a filter; user re-edits manually). Acceptable v1 fragility.
- Bulk operations on saved filters (delete-many, duplicate-to-org).
- External search index (Meilisearch/Typesense). Architecture preserves the
  swap path; no implementation in v1.

## Architectural Overview

Five components, three new subsystems:

1. **Search index** (new): a denorm table `runtime.work_item_search` keyed 1:1
   to `runtime.work_items`, holding a weighted `tsvector` over title +
   description + custom text fields + comments, plus the source text columns
   for `ts_headline()` snippet generation. GIN-indexed.

2. **Index maintenance** (new): a new event subscriber
   `runtime/subscribers/searchIndex.js` registered in the existing event
   processor. Listens to all work-item and comment mutation events and rebuilds
   affected rows. Same advisory-lock + cursor pattern as `neo4j-sync`,
   `audit-log`, and `notifications`.

3. **JQL parser + compiler** (new): `runtime/search/jql.js` exports
   `parse(string) → AST` and `compile(ast, userContext) → { sql, params }`.
   Grammar implemented via `peggy`. Compiler always appends an org-visibility
   predicate from `core/access.js` outside the user expression tree.

4. **Haiku translator** (new): `runtime/search/translate.js` wraps the
   Anthropic SDK. Builds a system prompt with the JQL grammar plus the
   user-visible field catalog. Returns JQL or a 4xx/5xx error. Disabled with
   501 if no API key is configured.

5. **Saved filters** (new): `blueprint.saved_filters` table + standard CRUD
   endpoints. Three share scopes: `private` / `org` / `global`. Permissions
   piggyback on the existing org-admin role.

The Search page (`admin-ui/src/pages/SearchPage.jsx`) is the primary UI surface,
reachable from a top-of-list sidebar entry and from a sidebar-bottom search icon
(quick-access shortcut, also bound to `/`).

## Units

- **`runtime/search/jql.peggy`** — PEG grammar source, `peggy`-generated parser.
- **`runtime/search/jql.js`** — `parse()` + `compile()` + `JQLSyntaxError` /
  `JQLSemanticError`. Pure (no DB access); takes a `userContext` for scope
  injection.
- **`runtime/search/translate.js`** — `translate({ prompt, userContext })`.
  One-shot Haiku call with one retry on parse failure. No streaming.
- **`runtime/search/fieldCatalog.js`** — builds the per-user field catalog
  (native + visible custom fields) used by both the autocomplete API and the
  Haiku system prompt. 60-second in-memory cache keyed by
  `(user_id, org_membership_set)`.
- **`runtime/subscribers/searchIndex.js`** — event handler registered in
  `runtime/eventProcessor.js`. Rebuilds `runtime.work_item_search` rows.
- **`scripts/backfillSearchIndex.js`** — idempotent backfill for initial
  population. Run once after migration 014 applies.
- **`admin-ui/src/pages/SearchPage.jsx`** — page shell + state management.
- **`admin-ui/src/components/SearchResultsList.jsx`** — table rendering (split
  out of SearchPage to stay under the 200-line cap).
- **`admin-ui/src/components/JQLEditor.jsx`** — query input with mode toggle
  (JQL / Ask), inline syntax-error highlighting, field autocomplete.
- **`admin-ui/src/components/SavedFiltersList.jsx`** — left rail: filters
  grouped by Mine / Org / Global with overflow menu per item.
- **`admin-ui/src/components/SavedFilterFormDrawer.jsx`** — Save / Save As /
  Edit drawer.
- **`admin-ui/src/components/SearchResultRow.jsx`** — single row with
  type icon, key, title, status, priority, assignee, snippet line.

Modified files:

- `admin/api.js` — 7 new endpoints (search, translate, saved-filters CRUD,
  fields catalog).
- `admin-ui/src/lib/api.js` — wrapper functions for each new endpoint.
- `admin-ui/src/App.jsx` — NAV entry "Search" + sidebar-bottom search icon +
  `/` keybinding + `tab=search` page route.
- `runtime/eventProcessor.js` — register the new `searchIndex` subscriber.
- `core/uri.js` — add `'saved_filters'` to valid URI entity types.
- `runtime/customFields.js` (or wherever `createFieldDefinition` lives) —
  validator rejecting reserved JQL field keys.
- `runtime/comments.js` (or equivalent) — emit the deferred
  `work_item.comment_edited` and `work_item.comment_deleted` events on the
  edit/delete code paths. Search v1 makes these events load-bearing for index
  freshness, so they ship as part of this work rather than being deferred again.

## JQL Grammar

```
query        := expression [ "ORDER BY" sort_list ]
expression   := or_expr
or_expr      := and_expr ("OR" and_expr)*
and_expr     := not_expr ("AND" not_expr)*
not_expr     := "NOT"? primary
primary      := "(" expression ")" | predicate
predicate    := field operator value
              | field "IN" "(" value_list ")"
              | field "NOT" "IN" "(" value_list ")"
              | field "IS" ("EMPTY"|"NULL"|"NOT" ("EMPTY"|"NULL"))
              | field "~" string
              | field "!~" string
field        := identifier
operator     := "=" | "!=" | ">" | ">=" | "<" | "<="
value        := string | number | function_call | identifier
value_list   := value ("," value)*
function_call:= identifier "(" [arg_list] ")"
arg_list     := value ("," value)*
sort_list    := sort_term ("," sort_term)*
sort_term    := field ["ASC"|"DESC"]
string       := "\"" ... "\"" | "'" ... "'"
number       := -?[0-9]+(\.[0-9]+)?
identifier   := [a-zA-Z_][a-zA-Z0-9_]*
```

### Reserved native fields

| Field | Type | Notes |
|---|---|---|
| `id` | int | internal id |
| `key` | string | display_key (e.g. `BUG.42`) |
| `title` | string | indexed (tsvector weight A) |
| `description` | string | indexed (weight B) |
| `text` | virtual | matches anywhere (title + description + custom + comments) |
| `status` | string | current stage name |
| `stage_class` | enum | `intake`/`triage`/`queued`/`in_progress`/`waiting`/`review`/`done`/`cancelled` |
| `substate` | enum | `active`/`blocked`/`waiting` |
| `org` | string | org slug or display name |
| `type` | string | WIT type name |
| `workflow` | string | workflow name |
| `priority` | int | 1–4 |
| `tags` | array | `tags = "p0"`, `tags IN ("p0","blocker")` |
| `assignee` | user | accepts email or `currentUser()` |
| `owner` | user | same |
| `requester` | user | same |
| `watcher` | user | matches via people relationships |
| `is_expedited` | bool | |
| `work_nature` | enum | `improvement`/`incident`/`request`/`task`/etc |
| `due_date` | date | accepts function values |
| `created` | date | created_at |
| `updated` | date | updated_at |
| `started` | date | started_at |
| `resolved` | date | resolved_at |
| `parent` | string | parent display_key |
| `origin` | enum | `manual`/`web`/`email`/`slack`/`api`/`spawn` |
| `estimate` | number | |
| `estimate_unit` | enum | `points`/`hours`/`days`/`dollars` |

### Reserved functions

`currentUser()`, `now()`, `today()`, `startOfDay()`, `endOfDay()`,
`startOfWeek()`, `endOfWeek()`, `startOfMonth()`, `endOfMonth()`,
`daysAgo(n)`, `daysFromNow(n)`.

### Custom field references

Any non-reserved identifier resolves to a custom field's `field_key` for the
user's visible orgs. Operators allowed depend on field type:

| Field type | Operators |
|---|---|
| text / textarea / url | `=`, `!=`, `~`, `!~`, `IS EMPTY`, `IN`, `NOT IN` |
| number | `=`, `!=`, `<`, `<=`, `>`, `>=`, `IS EMPTY`, `IN`, `NOT IN` |
| boolean | `=`, `!=` |
| date | same as number, plus function-call values |
| select | `=`, `!=`, `IN`, `NOT IN`, `IS EMPTY` |
| multi_select | `=` (any-match), `IN` (any-match), `IS EMPTY` |
| user / org | `=`, `!=`, `IN`, `NOT IN` |

Operator misuse on a field type returns `JQLSemanticError` with a helpful
message.

### Cross-org ambiguity

Custom fields are org-scoped. Two orgs may define a field with the same
`field_key`. For v1: a query that references a custom field without an `org`
filter resolves to "match any org's field with that key the user can see."
The JQLEditor surfaces a soft hint when an ambiguous reference is typed,
suggesting the user add an `org` clause.

### Lookup-list values

Resolved by display label (`severity = "P1"` matches the lookup value with
label "P1"). Renaming a lookup value breaks saved filters that reference the
old label; users re-edit and re-save manually. Acceptable v1 behavior; a future
"saved-filter healing" feature can address it.

### Examples

```jql
status = "Doing" AND assignee = currentUser()
text ~ "saml cert" AND created > daysAgo(30)
priority >= 2 AND stage_class != "done" ORDER BY due_date ASC
type = "BUG" AND severity IN ("P1", "P2") AND org = "platform-team"
tags = "blocker" AND substate = "blocked"
(assignee = currentUser() OR watcher = currentUser()) AND resolved IS EMPTY
```

## Data Model

Migration `014_search_v1.sql`:

```sql
-- 1. Search index denorm
CREATE TABLE IF NOT EXISTS runtime.work_item_search (
  work_item_id      INTEGER PRIMARY KEY REFERENCES runtime.work_items(id) ON DELETE CASCADE,
  search_doc        tsvector NOT NULL,
  title_text        TEXT NOT NULL DEFAULT '',
  description_text  TEXT NOT NULL DEFAULT '',
  custom_text       TEXT NOT NULL DEFAULT '',
  comments_text     TEXT NOT NULL DEFAULT '',
  refreshed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_item_search_doc
  ON runtime.work_item_search USING GIN (search_doc);

-- Trigram support for non-tsvector substring matches on key/title
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_work_items_title_trgm
  ON runtime.work_items USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_work_items_display_key_trgm
  ON runtime.work_items USING GIN (display_key gin_trgm_ops);

-- 2. Saved filters
CREATE TABLE IF NOT EXISTS blueprint.saved_filters (
  id              SERIAL PRIMARY KEY,
  uri             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  jql             TEXT NOT NULL,
  owner_user_id   INTEGER NOT NULL REFERENCES blueprint.users(id) ON DELETE CASCADE,
  share_scope     TEXT NOT NULL CHECK (share_scope IN ('private', 'org', 'global')),
  owner_org_id    INTEGER REFERENCES blueprint.organizations(id) ON DELETE CASCADE,
  sort_spec       JSONB NOT NULL DEFAULT '{}'::jsonb,
  column_spec     JSONB NOT NULL DEFAULT '{}'::jsonb,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT saved_filters_scope_consistency CHECK (
    (share_scope = 'org'     AND owner_org_id IS NOT NULL) OR
    (share_scope = 'private' AND owner_org_id IS NULL)     OR
    (share_scope = 'global'  AND owner_org_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_owner ON blueprint.saved_filters(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_saved_filters_org   ON blueprint.saved_filters(owner_org_id) WHERE owner_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_filters_scope ON blueprint.saved_filters(share_scope);

-- 3. Reserved JQL field keys
CREATE TABLE IF NOT EXISTS blueprint.reserved_field_keys (
  field_key TEXT PRIMARY KEY,
  reason    TEXT NOT NULL DEFAULT 'JQL native field'
);

INSERT INTO blueprint.reserved_field_keys (field_key, reason) VALUES
  ('id','JQL native'), ('key','JQL native'), ('title','JQL native'),
  ('description','JQL native'), ('text','JQL native'),
  ('status','JQL native'), ('stage_class','JQL native'), ('substate','JQL native'),
  ('org','JQL native'), ('type','JQL native'), ('workflow','JQL native'),
  ('priority','JQL native'), ('tags','JQL native'),
  ('assignee','JQL native'), ('owner','JQL native'), ('requester','JQL native'), ('watcher','JQL native'),
  ('is_expedited','JQL native'), ('work_nature','JQL native'),
  ('due_date','JQL native'), ('created','JQL native'), ('updated','JQL native'),
  ('started','JQL native'), ('resolved','JQL native'),
  ('parent','JQL native'), ('origin','JQL native'),
  ('estimate','JQL native'), ('estimate_unit','JQL native')
ON CONFLICT (field_key) DO NOTHING;

-- 4. Retire orphan
DROP TABLE IF EXISTS runtime.search_index_queue CASCADE;
```

Notes:

- Single denorm table chosen over a generated `tsvector` column on
  `runtime.work_items` because comments come from a separate table; a generated
  column on work_items can't include them, and bloating work_items with full
  description+comments text degrades the hot read path.
- `pg_trgm` is needed for substring matches on `display_key` and `title` that
  tsvector tokenization handles poorly (`BUG` does not match `BUG.42` under
  default English text-search config).
- Reserved field keys are stored in a table rather than a hardcoded JS array so
  additions are migration-driven.
- `runtime.notification_preferences` (orphan flagged in PARKING_LOT) is **not**
  retired in this migration; it ships in a separate cleanup migration to keep
  scope tight.

Code change accompanying the migration: `createFieldDefinition()` (wherever
custom fields are created) must reject any `field_key` present in
`blueprint.reserved_field_keys`. Existing custom fields are not retroactively
checked; if any collide, they win in the JQL resolution order via existing
deployments. (Audit query during rollout: `SELECT * FROM blueprint.field_definitions WHERE field_key IN (SELECT field_key FROM blueprint.reserved_field_keys);` — should return zero rows on a clean install.)

## API

All endpoints under `/admin/api`, all behind `requireAuth`.

```
GET  /admin/api/search
       ?q=<jql>
       &before=<int>       # cursor; default none
       &limit=<int>        # 1–200, default 50
       &include=<csv>      # 'snippet','total' opt-in
       &debug=1            # admin-only; returns parsed AST and compiled SQL

   200 → { rows: [...], next_before, total?, parsed_jql? }
   400 → { error: 'JQL_SYNTAX_ERROR'|'JQL_SEMANTIC_ERROR', message, position?, field? }

POST /admin/api/search/translate
   body: { prompt, max_tokens? }
   200 → { jql, warnings?, model: 'claude-haiku-4-5-20251001' }
   400 → { error: 'TRANSLATION_FAILED', message, raw_response? }    # admin-only raw_response
   501 → { error: 'TRANSLATOR_UNAVAILABLE' }                         # no API key configured
   503 → { error: 'TRANSLATOR_UPSTREAM' }                            # Haiku 5xx
   504 → { error: 'TRANSLATOR_TIMEOUT' }                             # >30s

GET  /admin/api/search/fields
   200 → {
     translator_available: <bool>,
     native: [ { key, type, description, operators, values? } ],
     custom: [ { key, type, description, org_slug, lookup_list_id?, values? } ]
   }

GET  /admin/api/saved-filters?scope=<all|mine|org|global>&org_id=<int>
   200 → { rows: [ { id, uri, name, jql, share_scope, owner_org_id, owner_user_id,
                     sort_spec, column_spec, description, created_at, updated_at,
                     is_owner, can_edit } ] }

GET  /admin/api/saved-filters/:id            # 404 if not visible

POST /admin/api/saved-filters
   body: { name, jql, share_scope, owner_org_id?, sort_spec?, column_spec?, description? }
   201 → { id, uri, ... }
   400 → JQL_SYNTAX_ERROR | JQL_SEMANTIC_ERROR
   403 → INSUFFICIENT_PERMISSIONS

PATCH /admin/api/saved-filters/:id
   body: same as POST, all optional
   200 | 403

DELETE /admin/api/saved-filters/:id
   204 | 403
```

### Permission rules on saved filters

| Action | Allowed when |
|---|---|
| List | Always; results filtered by visibility |
| Get | Filter is private-and-yours, org-scoped to a member org, or global |
| Create `private` | Always |
| Create `org` | You are a member of `owner_org_id` |
| Create `global` | You are a system admin (`is_admin = true`) |
| Update | You are the owner, OR (org-scoped AND you are an org admin of `owner_org_id`), OR (global AND `is_admin`) |
| Delete | Same as update |

The "manage filters" permission reuses the existing org admin role; no new role
keyword is added in v1.

### Validation order on POST/PATCH

1. Auth (requireAuth)
2. Permission check
3. JQL parse — broken queries rejected at save time
4. JQL semantic check — fields exist, operators valid for types
5. INSERT/UPDATE

### `/search/fields` caching

In-memory cache keyed by `(user_id, sorted org_membership_id list)`, 60-second
TTL. Invalidated implicitly on cache expiry; field/lookup/role mutations don't
trigger invalidation. Stale-by-up-to-60s catalog is acceptable v1 behavior.

## Data Flow

### Read path: typed JQL query

```
SearchPage / JQLEditor
  ↓ debounced or on Run/Cmd+Enter
GET /admin/api/search?q=...&before=...&limit=...
  ↓
admin/api.js search route
  ↓
runtime/search/jql.js
  parse(q) → AST
  compile(ast, userContext) → { sql, params }
    - access predicate from core/access.js appended outside user expression
    - LEFT JOIN runtime.work_item_search only when AST has free-text predicates
    - sort/limit/cursor clauses
  ↓
db/postgres.js query
  ↓
For rows where matched_in is description/comment/custom:
  ts_headline() generates snippet from the matching column
  ↓
JSON response → SearchPage → SearchResultsList
```

### Read path: NL query

```
JQLEditor in Ask mode
  ↓ on Enter
POST /admin/api/search/translate { prompt }
  ↓
runtime/search/translate.js
  - builds field catalog from runtime/search/fieldCatalog.js
  - Anthropic SDK call: claude-haiku-4-5-20251001, no streaming, max 500 output tokens
  - validates returned JQL parses cleanly via jql.js parse()
  - if parse fails: one retry with the parser error appended to the prompt
  - second failure returns 400 with raw_response (admin-only)
  ↓
{ jql, warnings? }
  ↓
SearchPage:
  - mode auto-switches to JQL
  - query box shows the generated JQL
  - original prompt appears as a removable chip ("From: 'show me my open P0 bugs'")
  - immediately runs the typed-JQL flow above
```

### Write path: index maintenance

```
work_item.* or comment.* mutation in admin/api.js or runtime/*
  ↓
emitEvent(client, ...)  [in transaction]
  ↓
COMMIT
  ↓
nudgeAfterCommit() → wakes eventProcessor
  ↓
runtime/subscribers/searchIndex.js claims event(s) via cursor
  ↓
For each event involving a work item id:
  - read current state: title, description, field_values, comments
  - rebuild search_doc tsvector with weights A/B/C/D
  - UPSERT into runtime.work_item_search
  ↓
advance cursor, release advisory lock
```

Subscriber listens to: `work_item.created`, `work_item.edited`,
`work_item.commented`, `work_item.comment_edited`, `work_item.comment_deleted`,
`work_item.assigned`, `work_item.unassigned` (the assignment events affect the
people-relationship denorm but not the search_doc; they're listed for
completeness — handler can no-op for events that don't change indexed text).

### Write path: saved filters

Standard REST CRUD against `blueprint.saved_filters`. No event emission in v1.

## Pagination, Sorting, Counts

- **Cursor-based**: `?before=<id>&limit=50`, response includes `next_before`.
  Default 50, max 200. Matches the audit-trail pattern from Session 22.
- **Default sort**: `priority DESC NULLS LAST, updated_at DESC`.
- **Saved-filter sort**: stored in `sort_spec` JSONB,
  `{ field, direction, nulls? }`. Sort on un-indexed JSONB custom fields is
  rejected at compile time.
- **Total count**: opt-in via `include=total`. For tables over 10k rows, uses
  `count_estimate(query)` (planner row estimate, fast, approximate). Exact
  count under 10k. UI shows "~12,400" when approximate, "127" when exact.

## Done-Item Retention

Search excludes resolved items past the per-org `done_retention_days` window
(migration 008) **unless** the JQL contains an explicit reference to a
resolved-state predicate. The compiler treats the following as opt-in to
including older resolved items, and removes the retention filter when any
appears in the AST:

- `resolved` referenced in any predicate (`resolved IS NOT EMPTY`,
  `resolved > daysAgo(180)`, `resolved < daysAgo(365)`, etc.)
- `stage_class = "done"` or `stage_class IN (...)` containing `"done"`
- `status` referenced with a value belonging to a terminal stage
- `id = <int>` or `key = "<display_key>"` (specific-item lookup)
- `is_terminal = true` (if the field is added later)

All other queries get an implicit `(resolved IS EMPTY OR resolved > NOW() - INTERVAL '<retention> days')`
appended. Resolved items within the retention window are always included.

## Permission Scoping

The compiler always appends, outside the user expression tree:

```sql
AND wi.owner_org_id IN (<user-visible-org-ids>)
```

The org list comes from `core/access.js` resolution at request time. No JQL
expression can short-circuit this predicate because it sits outside the user's
parenthesization scope.

Free-text snippets (`ts_headline()`) are generated only on rows that pass the
visibility filter. No information leakage through snippets.

## Error Handling

### JQL parser errors

`JQLSyntaxError` (400): query does not parse. Body contains:
- `position` — character offset of the error
- `snippet` — line of the query with `^` indicator
- `expected` — list of token types expected at the position

`JQLSemanticError` (400): query parses but is invalid. Body contains:
- `field` — the offending field name
- `reason` — `unknown_field` | `wrong_operator_for_type` | `empty_in_list` | `unindexed_sort` | etc.
- `suggestion` — Levenshtein-1 nearest field name when applicable

UI underlines the bad span and shows the message inline below the query box.
No silent fallback to ILIKE.

### Haiku translator failures

| Failure | Status | UI behavior |
|---|---|---|
| API key not configured | 501 | Ask toggle disabled at page load via `translator_available` flag; tooltip explains |
| Anthropic 5xx | 503 | Toast: "Translation upstream failed — try again or use JQL mode" |
| Bad JQL after one retry | 400 | Inline error on Ask box; admins see `raw_response` |
| >30s elapsed | 504 | Inline error: "Translation timed out" |

Per-user rate limit: 30 calls/hour, configurable via env var.

### Index freshness edge cases

| Scenario | Behavior |
|---|---|
| Item created → searched before subscriber drains | Excluded; subscriber catches up within event-processor tick |
| In-flight search during description edit | Reflects pre-event state; no locking |
| Comment deleted, snippet stale for one tick | `ts_headline()` falls back if underlying text changed; no error |
| Bulk import of N items | Subscriber processes serially; results trickle in; backfill takes minutes for N=10k |
| `work_item_search` row missing for an item | `LEFT JOIN`; item still searchable on native fields; free-text predicates miss it until row exists |

### JQL injection / safety

- Parser returns a typed AST. Compiler emits **only** parameterized SQL with
  field names from a whitelist. Strings/numbers go through `pg`'s parameter
  binding, never interpolated.
- Field names not in the whitelist throw `JQLSemanticError` before SQL is
  generated.
- Access-control predicate is appended unconditionally outside the user
  expression tree.
- Adversarial test fixtures cover: SQL injection in string literals, identifier
  injection in field positions, parser depth limit (50), oversized input
  (1 MB cap).

## Performance Targets

| Scale | Response target | Strategy |
|---|---|---|
| 1k work items | < 50 ms | tsvector + GIN, single SELECT |
| 10k | < 100 ms | same |
| 100k | < 300 ms | same; `count_estimate` over exact COUNT |
| 1M+ | not v1 | external index becomes the answer |

Architecture preserves the swap path: the search query path is mediated by
`runtime/search/jql.js compile()`, which today emits SQL but could emit a
Meili/Typesense query in v2 without touching call sites. JQL is the durable
contract; the index is a swappable implementation.

## Testing

### Unit tests (no server)

- **`tests/search-jql.test.js`** — ~75 tests
  - Parser: every operator, function, precedence, error position correctness
  - Compiler: SQL correctness across all field types
  - Adversarial: SQL injection, identifier injection, depth limit, oversize

- **`tests/search-translate.test.js`** — ~10 tests
  - Mock `@anthropic-ai/sdk`; fixture-based responses
  - System prompt construction
  - Retry logic on bad JQL
  - Error mapping
  - No real Haiku calls in CI

### Integration tests (server running)

- **`tests/search-api.test.js`** — ~20 tests
  - Each endpoint happy path + permission failure + edge cases
  - Index maintenance: emit event → poll until `work_item_search` row exists → query
  - Comment edit/delete reflected in search
  - Org-visibility: user A cannot see hits indexed in user B's exclusive org

- **`tests/saved-filters-api.test.js`** — ~15 tests
  - CRUD + permission checks per scope
  - Constraint enforcement (`org` requires `owner_org_id`, etc.)

### Manual smoke (out of CI)

Documented in this spec and added to the followup list:

- Real Haiku call from the running app, end-to-end
- 100k-row backfill timing on a representative dataset
- Browser verification of the Search page on the cartography theme

## Out of v1, Explicitly

Reiterated for clarity (see Non-Goals above):

- Filter subscriptions / "notify me when this filter has new matches"
- Federated search (orgs, users, workflows, types as standalone result types)
- "Open this filter as a board" view
- Streaming Haiku responses
- Multi-provider AI translation
- Saved-filter healing on schema rename
- Bulk operations on saved filters
- External search index implementation

## Followups Triggered by This Work

- **Wire `comment_edited` / `comment_deleted` event emissions** — done as part
  of v1 (was on the deferred list from notifications v1).
- **Manual smoke of Haiku translator** — added to the existing manual-smoke list
  for notification channels.
- **`runtime.notification_preferences` retirement** — separate migration 015,
  not bundled into 014.
- **ESLint config** — still missing project-wide; flagged as ongoing.
- **Saved-filter healing on lookup-value rename** — v2 candidate.
- **External search index swap path** — design preserves it; no implementation
  in v1.
- **Filter subscriptions for notifications** — v2; `runtime.filter_subscriptions`
  table addable without changing the v1 schema.

## File Inventory

### New files

- `db/migrations/014_search_v1.sql`
- `runtime/search/jql.peggy`
- `runtime/search/jql.js`
- `runtime/search/translate.js`
- `runtime/search/fieldCatalog.js`
- `runtime/subscribers/searchIndex.js`
- `scripts/backfillSearchIndex.js`
- `admin-ui/src/pages/SearchPage.jsx`
- `admin-ui/src/components/SearchResultsList.jsx`
- `admin-ui/src/components/JQLEditor.jsx`
- `admin-ui/src/components/SavedFiltersList.jsx`
- `admin-ui/src/components/SavedFilterFormDrawer.jsx`
- `admin-ui/src/components/SearchResultRow.jsx`
- `tests/search-jql.test.js`
- `tests/search-translate.test.js`
- `tests/search-api.test.js`
- `tests/saved-filters-api.test.js`

### Modified files

- `admin/api.js` — 7 new endpoints; remove the existing
  `/work-items/search` route (superseded; the SearchPage replaces its
  functionality and JQL `text ~ "..."` covers the use case)
- `admin-ui/src/lib/api.js` — wrappers for new endpoints
- `admin-ui/src/App.jsx` — NAV entry, sidebar bottom icon, `/` keybinding
- `runtime/eventProcessor.js` — register searchIndex subscriber
- `core/uri.js` — add `'saved_filters'` to valid entity types
- `admin/api.js` custom-field write sites — reserved-key validator added at
  the two `INSERT INTO blueprint.work_item_class_fields` and
  `INSERT INTO blueprint.work_item_type_fields` paths (currently at
  `admin/api.js:876`, `admin/api.js:1900`, `admin/api.js:1989`). Validator
  rejects with 400 when `field_key` is present in
  `blueprint.reserved_field_keys`.
- Comment endpoints — emit `comment_edited` / `comment_deleted`

### Dependency additions

- **`peggy`** — parser generator. ~50 KB, MIT, no transitive runtime deps.
  Required for the JQL grammar; hand-rolling a parser with proper precedence
  would be 3-4× the LOC and harder to audit.

## Rollout Plan

1. Apply migration 014 (creates tables, indexes, reserved keys, drops orphan).
2. Deploy code with `searchIndex` subscriber registered. Subscriber starts
   processing live events immediately; existing items are not yet indexed.
3. Run `scripts/backfillSearchIndex.js` once. Idempotent — safe to re-run.
   Estimated time on 100k items: a few minutes.
4. Verify `runtime.work_item_search` row count matches `runtime.work_items`
   (excluding deleted items).
5. Enable Search page in production. Sidebar entry visible.
6. Manual smoke: Haiku translator end-to-end, browser verification of UI on
   cartography theme.

Rollback: revert code; migration 014 is forward-only. The orphan
`runtime.search_index_queue` is dropped in this migration; rollback would
recreate it (unused table, harmless).

## Open Questions Resolved During Design

- DSL grammar: JQL-faithful (Q1)
- Free-text scope: title + description + custom fields + comments (Q2)
- Saved filters: first-class entity (Q3)
- UI surface: dedicated Search page primary, sidebar-bottom icon as shortcut (Q4)
- NL UX: two-mode toggle, Haiku server-side, no streaming (Q5)
- Result types: work items only, comment match shown inline on row (Q6)
- Custom field references: bare names with reserved-key enforcement (Q7)
- Filter subscriptions: v2 follow-up (Q8)
- `comment_edited` / `comment_deleted` event emission: in v1
- Org-scope permission: reuse existing org admin role
