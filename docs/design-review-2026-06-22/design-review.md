# Gladius OS — Critical Design Review

*2026-06-22 · branch `design-review` · post FlowOS→Gladius pivot*

## How this was produced

Five parallel read-only audits against the source tree and the live app on `:3000`:
backend feature inventory, AI-core readiness, dogfood-journey trace, tests/functioning
baseline, and a live UI walkthrough (23 screenshots in `./screenshots/`). No code was
changed. Every claim below is cited `file:line`.

**Scope as you set it:** optimize for *you dogfooding heavily solo for ~2 weeks*, then
public OSS launch. Everything is fair game — including the cuts already in flight and the
reframe thesis itself. Findings are tagged **[SOLO]** (blocks your 2-week run) or
**[LAUNCH]** (blocks public release) so you can sequence.

---

## ⚠️ Read this first — the branch/environment situation

The review surfaced a structural confusion worth fixing before anything else:

1. **`design-review` is `main` frozen 3 commits ago, with zero commits of its own.** Main
   has since fixed three things this branch still shows as broken:
   - `64537d5` — MCP handler arg-name mismatches (`entry_type`/`type`,
     `target_stage_id`/`to_stage_id`) — **the MCP write/transition breakage the journey
     audit found is already fixed on main, not here.**
   - `4ce998d` — work-item drawer widened to 960px.
   - `817ee43` — deleted the dead `SavedFilterFormDrawer`.
   → **Action: `git merge --ff-only main` in this worktree** (trivial, no conflicts) so the
   review baseline is current. Three findings below evaporate on fast-forward; they're
   marked *(fixed on main)*.

2. **`node_modules/` in this worktree is empty; the running app (`pm2 gladius-os`) actually
   serves from `/Users/chris/Documents/ai/gladius-os` (main).** So the UI audit and the
   "73 passing" HTTP tests exercised **main's** running server, while the source-file audits
   read **design-review's** files. The in-process DB-layer tests (6 of them) didn't run at
   all here — they fail with `Cannot find package 'pg'`, an env gap, not bugs
   (`tests/events-*.test.js`, `tests/notifications-*.test.js`, `tests/search-*.test.js`).
   → **Action: decide which worktree is the dogfood instance, run `npm ci` there, and point
   PM2 at it.** Right now you're editing one checkout and running another.

---

## The one-paragraph verdict

The product thesis is sound and the *plumbing is more coherent than the navigation
suggests* — the journal types, org context library, playbook YAML, AI-model config, and MCP
tools all interlock with consistent vocabulary, and the Org Context / AI Models screens are
genuinely well-built. **Three things are actively broken in the daily loop** (the journal
renders AI output as raw escaped JSON; NL search is dead; the notification subscriber is in
a permanent crash loop), **the cold-start path doesn't work as documented** (migrations are
never applied; the seed is a 12-org enterprise simulation, not a starter), and **the
interface is inverted** (board-first; journal/playbooks/MCP buried). None of this is a
rebuild. It's a focused punch-list: fix the loop, make first-run real, demote the board, and
finish the cuts you've already started. The moat — playbooks firing an LLM on transition and
writing typed context back — *works end to end but is thin and untested*, and it's the thing
most worth hardening before others see it.

---

## 1. Functioning baseline — what's broken right now

These block the 2-week run. Fix order is roughly this order.

| # | Defect | Impact | Evidence | Tag |
|---|--------|--------|----------|-----|
| 1 | **Notification crash loop (DEBT.25359)** — live and flooding logs. Orphaned `work_item_user_relationships` rows point at non-existent users (`{1,201,202,203,236,237,238}`, e.g. WI 106). Subscriber inserts them → FK violation → throws. The event processor **stops advancing the cursor on any throw, with no max-retry or dead-letter**, so one poison event wedges *all* notifications forever. | `failure_count=24527`; notifications dead for events 1223→2364 (1,141 events). Will never self-recover. | `runtime/subscribers/notifications.js:82-118`; `runtime/eventProcessor.js:241-244`; FK `db/migrations/012_notifications.sql:98` | SOLO |
| 2 | **Journal renders AI output as raw escaped JSON** — *the single worst UI failure.* Entry bodies aren't markdown-parsed (`proseCount:0`); the flagship "AI Analysis" entry shows literal `[{"type":"note","content":"## …\\n\\n…"}]` with visible `\n` and `##`. | The core daily surface is unreadable. | UI audit `07-journal-populated.png`; DOM-confirmed | SOLO |
| 3 | **NL search is dead** — client posts the wrong body field; server wants `prompt`. Box silently degrades to keyword while advertising "describe what you're looking for." | `POST /admin/api/search/translate → 400 "prompt is required"` | UI audit `22-search.png`; `runtime/search/translate.js` | SOLO |
| 4 | **Cold-start has no AI-loop tables** — `docker-compose.yml:29` mounts only `db/init/` into Postgres init; **`db/migrations/` is applied by nothing** (no migration runner). Migration 017 creates `context_entries`, `stage_playbooks`, `org_context`, `org_ai_models` — the entire product. README's "Run migrations and seed: `npm run seed`" is false (seed ≠ migrate); `seed.js` is a 12-org enterprise sim with zero playbooks/context/agent-user/AI-model. | Nobody (including a fresh you) can stand the app up as documented. | `docker-compose.yml:29`; `db/seeds/seed.js`; `README.md:100` | SOLO + LAUNCH |
| 5 | **Exit-criteria waiver bug** — `evaluateSingleCriterion` only honors `waived` status for the `manual` tier; `codified` and `api` tiers re-evaluate live and never read the persisted waiver. An authorized override of an automated gate does nothing. | First misfiring gate = a hard wall you can't pass. Hits UI and MCP. One-function fix. | `runtime/exitCriteria.js:95-125`, fails into `failed[]` at `:74-76` | SOLO |
| 6 | **`graph/hierarchy.js` is a lying API** — `runQuery()` always returns `[]`; the work-item hierarchy endpoint silently returns empty trees, yet is wired and called. | Child/parent hierarchy views silently incomplete. | `graph/hierarchy.js:27,79-202`; called `api/routes/workItems.js:16,61` | SOLO |
| 7 | **`/health` is blind to subscriber health** — checks only Postgres; returns `status:ok` while a subscriber is 1,141 events behind with 24k failures. | A 2-week unattended run *looks* healthy while a core subsystem is dead. | `api/server.js:99-107` | SOLO |
| 8 | **No global `unhandledRejection`/`uncaughtException` handler** — async fire-and-forget paths (`setImmediate` nudge, delivery worker timer) have no top-level catch; one unhandled rejection crashes the process. | Flaky unattended uptime. | `runtime/eventProcessor.js:163-166`; grep: none registered | SOLO |

**Proposed fix for #1 (described, not applied):**
*Data* — `DELETE FROM runtime.work_item_user_relationships WHERE user_id NOT IN (SELECT id FROM blueprint.users)` (and null orphan `requester_id`s) to unblock the poison event.
*Code* — filter candidate user-ids against `blueprint.users` before insert **and** add a poison-event escape hatch in `eventProcessor.drainOne` (after N failures on one event id, log + advance past it). The structural flaw is unbounded head-of-line blocking.

---

## 2. What to cut — validated against the code

The reframe doc's cut list is mostly right. Where the code changes the calculus, I push
back. **Bold = my recommendation where it differs from the reframe.**

| Feature | Reframe says | Code reality | My call |
|---------|--------------|--------------|---------|
| Neo4j | Cut (done) | **Not clean.** A `flowos-neo4j` container is *still running* (orphaned; current compose has no neo4j service so `down` won't remove it). A `neo4j-sync` row persists in `runtime.event_subscribers` (cursor 2308) advancing a cursor nothing reads. ~7 stale comments; README still lists it. | **Finish the cut** — kill container, delete subscriber row, scrub comments, fix README |
| JQL | Cut (done) | Migration `018` dropped it. Residue: `.eslintrc.json:13` ignores a file that no longer exists; `compilerInput` in `fieldCatalog.js:120-127` feeds the deleted compiler (no consumer); `'non_jql'` label; "reserved JQL identifier" string. | Finish the cut — delete residue |
| Email/webhook delivery | Cut (done) | Code clean (only `agent` channel survives). But live DB `CHECK` constraints still permit `'email','webhook'`; `HostRateLimiter` (`rateLimiter.js:8`) is now dead, kept alive only by a test. | Finish the cut — tighten constraints, delete `HostRateLimiter` |
| Service-class CoS vocab | Cut, keep `priority`+`due_date` | Resolved in `runtime/workItems.js:120-139` (non-null `service_class_id` on every INSERT) and JOINed in the **orphaned** `board/boardQuery.js:151-155`. | Cut. **Bonus: deleting `board/boardQuery.js` + `api/routes/board.js` erases most CoS *and* substate vocab for free** — it's the heaviest carrier and even has a *stale third substate enum* (`waiting\|active\|review`) conflicting with runtime's `active\|blocked\|waiting` |
| Substates + waiting queue | Simplify to single `blocked` | Same orphaned board file carries it. | Cut with the board twin above; keep `blocked` |
| File attachments | Cut | Code **cleanly separates** `createLinkAttachment` (~30 lines, no dep) from `createFileAttachment` (multer + storage + dead MinIO). | **Cut *files*, keep *links*.** Links (attach a PR/Figma/doc URL) are real ergonomics at ~0 cost; cutting files lets you delete `core/storage/*` and the MinIO container |
| Public intake forms | Defer | **Fully built and wired** — `api/routes/forms.js` + `IntakeForm.jsx` + link generation + SPA route. Not a stub. | **Keep.** "Defer" = delete working code and re-pay later. A bookmarked intake form is the cleanest way to file work into Gladius from outside the admin UI |
| Exit-criteria condition types | 4 codified → 2 | The real liability isn't the codified types — it's the **`api` tier** (`exitCriteria.js:227-273`): live `fetch()` to arbitrary endpoints that **blocks transitions on network failure**, an SSRF-shaped footgun with zero solo use. | **Cut the `api` tier.** Keep `manual` + codified `field_value`; leave the other 3 codified types dark (self-contained `case` arms, not worth deleting) |
| Custom field types | 10 → 5 | Types exist **only** as a frontend dropdown (`FieldsEditor.jsx:13-24`); backend accepts any string (no enum); live data uses only 4 (`text,textarea,number,select`). | Trim the dropdown (pure frontend, no migration). Keep `textarea`; cut `url,multi_select,user,org` |
| Org Center fragmentation | Consolidate "too many pages" | **Mostly already solved** — Org Center is one master-detail (Settings/Catalog/Policies/Members/Workflows/Context/AI Models). | Minor: WIP limits live in *two* places (Org Policies + inline board headers); playbooks live in Workflows, not beside AI config |

### Dead scaffolding to delete (not on the reframe's radar — pure residue)

- **The entire `/v1` API surface** (`api/routes/workItems|organizations|catalog|board.js` +
  `board/boardQuery.js`) — mounted but the React UI calls it **zero** times. An untested
  parallel backend that has already drifted (the substate-enum conflict). Before OSS: promote
  `/v1` to *the* public API and delete the admin-API duplication, **or** delete `/v1`.
  Shipping both invites contributors to fix the wrong one.
- **`core/inheritance.js`** — 211-line org-tree inheritance feature, **zero importers**.
- **`core/access.js`** — 314-line multi-tenant ACL; only caller is the unreachable
  `graph/hierarchy.js`. Solo needs `requireAuth` + `is_admin`, nothing more.
- **`graph/sync.js`** — no-op Neo4j stub, zero callers.
- **MinIO** — `docker-compose.yml:37-59`, nothing connects; `OBJECT_STORAGE_*` env vars
  referenced nowhere; s3 adapter throws. Dead infrastructure.
- **`db/init/runtime_schema.sql`** carries a *stale, divergent* `runtime.notifications`
  definition (UI-era shape) that only works because migration `013` later DROP+RECREATEs it.
  A clean `docker volume rm` + rebuild creates the wrong table first.

---

## 3. What's missing — gaps in the dogfood loop

Traced end-to-end: create → journal context → transition → playbook fires → exit-criteria
gate → MCP agent reads/writes → human reviews/resolves → done. The holes:

| Gap | Why it blocks the loop | Size | Tag |
|-----|------------------------|------|-----|
| **No seed-and-go path** | Between "empty DB" and "12-org enterprise sim" there's nothing. After `/auth/setup` you get a user but no org/workflow/type/agent-user/AI-model/playbook. You must hand-build the whole spine before the loop runs. Need a *solo starter* seed: 1 org + membership + a feature workflow + 1 WIT type + an agent user + an AI model + 2–3 canonical playbooks. | M | SOLO+LAUNCH |
| **No playbooks seeded; no Discovery/Planning playbook** | Nothing fires on any transition out of the box — the entire "AI-native" promise is invisible until you hand-author YAML. | M | SOLO+LAUNCH |
| **Decision open/resolved state missing** | `decision` is just a journal type string — no `resolved` column, no resolve action, no view. A decision becomes indistinguishable from a note forever; you can't gate a transition on "decisions resolved." STATE.md's FEAT.25360 is correct that this is absent. | M | LAUNCH (solo-annoying) |
| **No cross-item view** of open decisions / recent journal / agent output | Everything is locked inside one item's drawer. To run daily at scale you need "show me every open decision" and "what did agents write since I last looked." | M | SOLO at scale |
| **`.env.example` omits the two keys the loop requires** | `GLADIUS_ENCRYPTION_KEY` (or AI-model storage throws) and `GLADIUS_AGENT_USER_ID` (or MCP writes throw) are documented in README but absent from the file people copy. Playbooks silently no-op without the key. | XS | SOLO |
| **Journal taxonomy not enforced** | The 8 types are prose-only; `type` is free text on both `context_entries` and `org_context`. Context assembly is type-keyed, so a typo or agent hallucination silently fragments your context-pull. Add a CHECK constraint or shared validator. | S | SOLO |
| **Playbook write-allowlist defaults to `['note']`** | A Discovery playbook that emits `decision`/`discovery` entries silently drops them unless its frontmatter overrides `context.write`. Easy footgun. | S | SOLO |
| **Playbook execution is unobservable** | Fire-and-forget; success/failure is `console.log` only. No persisted run record (model, tokens, `stop_reason`, entries-written, error), no UI signal it ran. You can't tell when a playbook silently wrote nothing. | M | SOLO+LAUNCH |
| **No "what should I work on next" for the agent** | `search_work_items` exists but there's no "next item in my queue" tool; the agent must be spoon-fed IDs. | M | LAUNCH |
| **MCP has no `create_work_item`** | An external agent can read/transition/comment but not create. | S | LAUNCH |
| **Discovery-readiness check missing** | No way to mark an item "ready to leave Discovery"; you transition manually with nothing enforcing discovery happened. STATE.md's FEAT.25361. | S–M | LAUNCH |
| **No exit-criterion type reads journal/decision state** | "All decisions resolved" or "discovery complete" can't be a gate — the thing that would make the journal *load-bearing* in the workflow. | M | LAUNCH |

---

## 4. UI / IA assessment

**Verdict: inverted (board-first, product buried), but the fix is navigation and a few
renders — not a rebuild.** The plumbing already tells the product story with consistent
vocabulary; the *nav* tells a Kanban-tool story.

- **Landing is an empty Kanban board.** No top-level **Journal / Playbooks / Context / AI**
  in the sidebar. The three flagship surfaces are each buried: journal is tab #2 behind a
  long Details form; the playbook editor is a collapsed accordion at the bottom of a stage
  editor (discoverability ≈ 0; nothing signals a stage even *has* a playbook); the MCP
  reference sits under **DEV TOOLS** next to the DB console, framing the headline integration
  as a debug utility.
- **Counter-evidence it's not a total inversion:** the Org Context Library and AI Models
  pages are genuinely well-built and thesis-aligned ("Background knowledge injected into
  every agent working in this org.").
- **The board is over-featured:** 3,199px-wide scroll area in a 1,018px viewport (3× h-scroll),
  13+ columns, spanning headers, swimlanes, dual timers per card, CoS borders, waiting-queue
  splits, inline WIP — plus test-data noise ("Event system e2e…" ×11). The reframe's "stop
  expanding the board" is right; it needs *de-weighting*, not growth.
- **Polish bugs:** exit-condition rule renders `…exists undefined`; journal entry author
  shows "unknown"; work-item URI still shows `flowos://`; two editors (Exit-Conditions,
  Edit-Class) render as **modals** over a dimmed backdrop, violating the drawer-only tenet;
  Radix `DialogTitle`/`Description` warnings and a controlled/uncontrolled Switch warning on
  every drawer; journal filter chips use `text-[10px]` (violates the 3-font-size rule).

**Ranked UI work:** (1) fix journal markdown + AI-JSON parsing [SOLO]; (2) fix NL search or
relabel it [SOLO]; (3) make Journal the drawer's default tab [SOLO, one-line]; (4) add a
top-level Context/AI grouping or a landing dashboard (recent journal activity, open
decisions, playbook runs) and move MCP out of Dev Tools [LAUNCH]; (5) surface playbook
configured/fired state on the board/item [LAUNCH]; (6) de-noise and de-weight the board;
(7) the polish pass above.

**Strategic UI question (you said the thesis is open to challenge):** the reframe says "the
React admin UI is a demo shell, not the product; document the API first." For your 2-week
solo run that's *backwards* — you'll live in this UI daily, so its loop ergonomics (items
1–3) are your highest-ROI fixes. For public launch the API-first framing holds. So: **fix
the UI loop for yourself now; treat broader UI polish as launch-tier.** Don't let "the UI is
just a shell" justify shipping a broken journal — it's *your* primary tool for the next two
weeks.

---

## 5. The moat — AI core quality & security

The five pillars (playbooks, journal, MCP, exit-criteria policies, org context) work end to
end but are **thin, and the entire moat is untested** (`tests/context-api.test.js` covers
only CRUD + one IDOR case — zero coverage of `playbookExecutor`, `assembleContext`,
`evaluateExitCriteria`, waivers, or the MCP server). Concrete concerns to harden before
others depend on it:

- **Prompt injection / no provenance boundary.** Org context and journal entries are
  concatenated verbatim into the system prompt with no delimiting (`contextAssembler.js:72-94`).
  Agents write back into the *same* journal (`isAgent:true`), so a hallucinated or hostile
  entry becomes trusted instruction on the next playbook run. There's no human-vs-agent
  provenance fence in the prompt.
- **No context budget.** `assembleContext` pulls all item entries (no LIMIT), 50 ancestors,
  and *all* org-context rows of the requested types. A long-lived item will blow the model's
  window with no truncation or token accounting.
- **Fragile response parsing.** Only `content[0].text` is read (drops multi-block/thinking
  responses); `stop_reason` is never inspected (a `max_tokens` truncation is invisible and
  silently writes nothing); the code-fence-stripping regex is global (corrupts fences *inside*
  the JSON); the greedy `[\s\S]*` array match grabs the wrong span if the model emits prose
  containing brackets.
- **No retries/backoff.** A transient 429/529 just logs and writes nothing — for a side
  effect that fires on every transition, this will routinely no-op under load.
- **MCP org-scoping holes.** `list_context_entries` and `write_context_entry` take a
  `work_item_id` with **no org check** → cross-org read/write from a misconfigured agent. All
  tools act as one shared `GLADIUS_AGENT_USER_ID` (no per-agent attribution). The direct-DB
  coupling (bypassing the REST auth stack) is the architectural root; FEAT.25338's refactor
  branch exists but is stale (it renames back to "flowos").
- **Orphaned authorship.** Playbook-written entries set `author_id=NULL` (`playbookExecutor.js:111`);
  the REST POST path can't set `is_agent`; POST uses `req.session?.userId` while PATCH/DELETE
  use `req.userId`, so human entries can land `author_id=NULL` and become un-editable. (This
  is also why the UI shows author "unknown.")
- **Encryption is correct** (AES-256-GCM, key never returned to clients) — but `decryptApiKey`
  doesn't validate the `iv.enc.tag` split, and the failure is swallowed by the executor's
  catch-all, so a corrupt key reads as "no entries written" with no diagnostic.

The `provider` field on `org_ai_models` is stored but never branched on — the executor always
instantiates Anthropic. Harmless today, misleading for contributors.

---

## 6. Sequenced punch-list

**Stage 0 — unblock the environment (do first, ~30 min)**
- [ ] `git merge --ff-only main` in this worktree (kills 3 stale findings).
- [ ] Decide the dogfood checkout; `npm ci` there; point PM2 at it.
- [ ] Clear the crash loop: delete orphaned `work_item_user_relationships` rows; restart.

**Stage 1 — make the daily loop work [SOLO]**
- [ ] Fix the notification subscriber (user-id filter + poison-event escape hatch in the processor).
- [ ] Fix journal markdown rendering + normalize agent JSON into typed entries.
- [ ] Fix NL search body field (or relabel as keyword).
- [ ] Fix the exit-criteria waiver bug (consult `waived` status for all tiers).
- [ ] Make Journal the work-item drawer's default tab.
- [ ] Add `GLADIUS_ENCRYPTION_KEY` + `GLADIUS_AGENT_USER_ID` to `.env.example`.

**Stage 2 — make cold-start real [SOLO+LAUNCH]**
- [ ] Write a migration runner; wire `db:migrate` (and fix the README claim).
- [ ] Write a *solo starter* seed (1 org + membership + feature workflow + 1 WIT type + agent user + AI model + 2–3 playbooks incl. Discovery/Planning).
- [ ] Enforce the journal taxonomy (CHECK or shared validator).
- [ ] Add playbook-run observability (persisted run record + a UI signal).

**Stage 3 — finish the cuts [LAUNCH]**
- [ ] Neo4j: kill container, delete `neo4j-sync` subscriber row, scrub comments + README.
- [ ] JQL residue: eslint ignore, `compilerInput`, stale strings.
- [ ] Email/webhook: tighten DB CHECK constraints, delete `HostRateLimiter`.
- [ ] CoS + substates: delete `board/boardQuery.js` + `api/routes/board.js`; decouple `service_class_id` from the INSERT.
- [ ] Attachments: cut files, keep links; delete `core/storage/*` + MinIO.
- [ ] Exit criteria: cut the `api` tier.
- [ ] Delete dead scaffolding: `core/inheritance.js`, `core/access.js`, `graph/sync.js`, the `/v1` surface (or promote it).
- [ ] Fix or cut `graph/hierarchy.js` (port to recursive CTE).
- [ ] Custom field dropdown 10→5.

**Stage 4 — launch-readiness [LAUNCH]**
- [ ] IA reframe: top-level Context/AI nav + landing dashboard; move MCP out of Dev Tools.
- [ ] Decision resolved-state + cross-item open-decisions view.
- [ ] MCP: org-scope all tools, add `create_work_item` + a "my queue" tool, finish FEAT.25338 (REST coupling).
- [ ] Harden the LLM path: context budget, retries, provenance fence, robust parsing.
- [ ] Tests for the moat (`playbookExecutor`, `assembleContext`, exit-criteria, waivers, MCP).
- [ ] `/health` reports subscriber lag; add global rejection handlers; fail-fast env validation; graceful shutdown.
- [ ] GitHub: enable Issues + Discussions, add `.github/ISSUE_TEMPLATE/` (bug + feature).

---

## Appendix — open strategic questions

1. **Board's actual role.** The reframe says keep it as the status view. The audit confirms
   it's heavy and noisy but the *real* board (`/admin/api/board`) is fine; the bloat is mostly
   in the orphaned `/v1` twin you can delete for free. Recommendation: keep a *de-weighted*
   board, delete the twin. Agree?
2. **One UI or API-first?** For your 2-week run the UI is the product; for launch the API is.
   Recommendation: fix the UI loop now, document the API before launch. Agree?
3. **MCP architecture.** Finish FEAT.25338 (route MCP through REST so auth is uniform) vs.
   accept direct-DB and bolt org-checks onto every tool. The former is the right long-term
   call but is a bigger lift. Which for the 2-week window?
