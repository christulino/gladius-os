# SESSION 26 — Plan & Kickoff Brief

> Authored 2026-06-13 (planning session, Cowork). Execution venue: **Claude Code CLI on the Mac**.
> Picks up from Session 25 (Attachments v1). HEAD = `b99d3e8`, clean tree, all merged to `origin/main`.
> Goal of this session: **close the last Tier-1 go-live blocker** so FlowOS clears "cannot go live without."

---

## Why the CLI, not Cowork

The planning for this session was done in Cowork, whose Linux sandbox has **no Docker, no
Postgres, no root**, and cannot reach the Mac's `localhost:5432`. FlowOS tests are
**integration tests against a live API + DB**, so sub-agents in the sandbox can't actually
run them. Run this session from the CLI on the Mac, where `docker-compose up`, `npm run dev`,
and `npm test` all hit the real stack. Verification loop closed.

## Model strategy (decided: "Sonnet everything")

```bash
cd ~/Documents/ai/flowos
docker-compose up -d        # Postgres + Neo4j
claude --model sonnet       # Sonnet orchestrator; sub-agents default to Sonnet too
```

- One flag gets Sonnet for both the orchestrator and Task-tool sub-agents (sub-agents
  default to Sonnet when no `model=` is passed).
- Alternative if you want planning-grade reasoning on the orchestrator without full Opus
  cost: `claude --model opusplan` (Opus plans, Sonnet executes).
- **Gotcha (only relevant if you later try Haiku coders):** the `model:` field in
  `.claude/agents/*.md` frontmatter is currently ignored at runtime. To pin a non-default
  model to a sub-agent you must pass `model=` on the Task call; otherwise it falls back to
  Sonnet regardless of frontmatter.

---

## Where the product stands

6 of 7 Tier-1 "cannot go live without" blockers are DONE (auth, notifications, search,
attachments, audit-trail UI, intake forms). **Bulk operations (#6) is the only Tier-1
blocker left.** Everything else outstanding is Tier 2+ or hygiene. Closing #6 plus the
dangling comment edit/delete P1 gets the core product to "functioning."

---

## The trap: fix foundation BEFORE feature work

Two flagged items will sabotage sub-agents if not fixed first. Both verified still-true on
2026-06-13.

### Phase 0 — Foundation (serial, do first)

**0a. Add an ESLint config.**
- No `.eslintrc*`, no `eslint.config.*`, no `package.json` eslint key exists — yet CLAUDE.md
  orders every agent to run `npx eslint .` before declaring done. Every prior sub-agent
  flagged this. Without it the gate is a no-op or an error.
- Deliver a flat config (`eslint.config.js`) appropriate for the project: ESM, Node globals,
  module type `module`, ignores for `admin-ui/dist`, `node_modules`, generated parser
  (`runtime/search/jql.parser.js`). React/hooks plugin scoped to `admin-ui/src`. Keep the
  ruleset pragmatic — this codebase is mature; a config that floods 500 errors is useless.
  Start permissive (error on real bugs: no-undef, no-unused-vars with args-after-used,
  no-unreachable), tune to a clean or near-clean `npx eslint .`.
- **Done when:** `npx eslint .` runs and exits cleanly (or with a short, triaged list Chris
  signs off on), and the PARKING_LOT "Missing ESLint config" item is closed.

**0b. Fix the `npm test` hang / test isolation.**
- Full `npm test` now hangs the `node --test` workers (got worse in Session 25, killed
  manually). Root cause shape: `comments-api` and others do
  `SELECT first work_item from /work-items?limit=1` in their `before` hook, which gets
  churned by search-test fixtures running earlier in the same invocation.
- Fix: each test file creates its **own** scratch work-item in its `before` hook instead of
  grabbing an arbitrary existing one. Check `tests/helpers/` for a shared factory; add one if
  missing. Confirm the Neo4j driver in `events-*` tests isn't what's wedging the workers
  (CLAUDE.md says Neo4j is intentionally not seeded; tests should not require a live bolt
  endpoint — if they do, that's the real hang, fix accordingly).
- **Done when:** `npm test` completes without hanging and is green (or has only the
  pre-existing, documented baseline flakes, clearly noted).

> Do 0a and 0b serially. They're load-bearing for everything after.

### Phase 1 — Features (mind the `admin/api.js` collision)

Both features below edit `admin/api.js`. **Do them serially, not in parallel** — concurrent
worktree agents won't see each other's edits and will collide on merge.

**1a. Bulk operations (Tier 1 #6) — the last go-live blocker.**
- Multi-select on the board → apply one action to N items: transition, assign, set class of
  service. "Move these 8 to Done" is the daily need.
- **Respect the engine:** route each item through the existing **two-phase transition engine**
  (`runtime/transitions.js`, prepare → execute). Do NOT batch-mutate around it. Exit criteria
  still gate each item; a bulk transition is N gated transitions, and per Design Constraints
  it must **not** auto-advance items past WIP/downstream capacity silently — partial success
  is correct and must be surfaced (return per-item results, show which succeeded/blocked).
- Emit the normal events per item (no new silent path). Timestamps stay sacred — no
  back-filling.
- API: new endpoint(s) under `admin/api.js` (e.g. `POST /work-items/bulk/transition`,
  `/bulk/assign`). Parameterized SQL only. `requireAuth`.
- UI: multi-select affordance on the board + a bulk action bar; respect the style guide
  (`admin-ui/style/README.md` — right-side drawer, no modals, `text-xs`/`text-sm` only, no
  `font-mono`). Components under 200 lines; functional only.
- **Done when:** select-many → transition/assign works end-to-end in the browser, partial
  failures are reported per item, integration tests cover happy path + a gated/blocked item,
  `npx eslint .` clean, `npm test` green.

**1b. Comment edit/delete endpoints + event wiring (P1, self-contained).**
- The searchIndex subscriber already declares `work_item.comment_edited` /
  `comment_deleted` handlers, and the notifications matrix reserves the types — but no API
  exposes PATCH/DELETE on comments, so they're dangling.
- Add `PATCH` and `DELETE` on comments in `admin/api.js`. On each, `emitEvent` the
  corresponding type inside the transaction. Add both types to the **hardcoded HANDLED set**
  in `runtime/subscribers/notifications.js` (keep in sync with `blueprint.notification_defaults`).
  Confirm searchIndex refreshes the tsvector on edit/delete.
- Permission: comment author OR admin (mirror the attachments delete permission pattern).
- **Done when:** edit + delete work, search index updates, audit trail renders the change,
  notification fan-out includes the new types, tests cover it, eslint clean, tests green.

### Phase 2 — Close out

- `npx eslint .` clean; full `npm test` green; browser smoke of bulk ops + comment edit/delete.
- Rebuild `admin-ui` dist if UI changed (`cd admin-ui && npm run build`).
- Update docs: `STATE.md`, `TODO.md`, `PRODUCT_PLAN.md` (mark Tier 1 #6 DONE), `CLAUDE.md`
  Key Patterns/Files if surface changed, `PARKING_LOT.md` (close ESLint item). Run the
  `session-close` skill.
- Commit in the project's granular style (one logical change per commit), push to
  `origin/main`.

---

## Suggested task DAG

```
0a ESLint config ─┐
0b Test-hang fix ─┴─> 1a Bulk operations ──> 1b Comment edit/delete ──> 2 Verify + session-close
                         (both 1a,1b touch admin/api.js → keep serial)
```

## Guardrails (from CLAUDE.md — non-negotiable)

- ESM everywhere (`import`/`export`); no `require()` except `tailwind.config.js`.
- Parameterize all SQL. Two-schema discipline (blueprint = structure, runtime = instances).
- Gates vs. side effects: exit criteria GATE; transition actions fire as SIDE EFFECTS after commit.
- Don't touch applied migrations — new idempotent migration files only (next number: 016).
- Timestamps are sacred. No modals. No `font-mono`. Only `text-xs`/`text-sm`. Functional
  components, <200 lines.
- On double-errors: STOP, zoom out, re-examine the plan — don't patch a patch.

---

## Paste-ready kickoff prompt for the CLI session

> New FlowOS working session (Session 26). Read `SESSION_26_PLAN.md`, `CLAUDE.md`, `STATE.md`,
> and `TODO.md` first. Goal this session: close the last Tier-1 go-live blocker.
>
> Bring up the stack (`docker-compose up -d`), then work the plan in `SESSION_26_PLAN.md`
> in order: Phase 0 (ESLint config, then the `npm test` hang) serially first, then Phase 1
> (Bulk operations, then Comment edit/delete — both touch `admin/api.js`, so serial), then
> Phase 2 (verify + session-close). Use Sonnet sub-agents for the discrete build tasks; you
> orchestrate and review between each. After every task: `npx eslint .` clean and `npm test`
> green before moving on. Respect every guardrail in the plan. Commit granularly. Stop and
> ask me if anything in the plan conflicts with what you find in the code.
