# BACKLOG — Gladius OS

## Active / Up Next

[done 2026-06-23] feat(search): FEAT.25454 — sort/date NL support. `sort_by/sort_dir/created_after/created_before` wired translator→endpoint; code-fence stripping in extractText(); type_name frontend gap fixed. Commit: 9a4a772.

[P3] Data cleanup (DEBT.25359, Backlog on dogfood board) — Data side **DONE** (Session 34): deleted 25,048 orphaned `requested_by` relationship rows pointing at non-existent `user_id=1` (all enterprise seed orgs; dogfood org 109 was clean). Remaining: fold any residual `runtime.notifications` / `blueprint.notification_defaults` orphan check into the DEBT.25476 hardening; close otherwise.


[P1] PM2 launchd registration — run the sudo env PATH=... command from `pm2 startup` output to register with launchd. Command: `sudo env PATH=$PATH:/usr/local/bin /Users/chris/.npm-global/lib/node_modules/pm2/bin/pm2 startup launchd -u chris --hp /Users/chris`

[P3] DEBT.25476 — notification subscriber hardening (defense-in-depth). Live poison source **resolved** (Session 34): deleted 25,048 orphaned `work_item_user_relationships` rows pointing at non-existent `user_id=1` (1 ghost user, not 7; all enterprise seed orgs; dogfood clean). Remaining work is resilience for *future* dangling FKs: skip-after-N + dead-letter so one bad relationship can't stall the event processor. No longer urgent — nothing currently re-poisons.

[P1] Raise playbook `max_tokens` (Dev/Test/Review/Deployment, currently 1024–1536) — truncation of the JSON array was the DEBT.25477 root cause. PR#6 recovery handles it, but stop truncating. **Planning fixed Session 34** (2048→8192, file + DB) after it truncated on a rich journal. **Key insight: the default is backwards** — downstream stages need MORE output budget, not less, because each upstream stage enriches the journal that the next must synthesize. Consider scaling `max_tokens` with assembled-context size, or a global floor ≥8192 for synthesis stages.

[P2] Agent-authored context entries have `author_id = NULL` — both the Executor and MCP `write_context_entry` write entries with no `author_id` (not attributed to the agent identity, user 309). Two consequences surfaced in the FEAT.25360 lap: (1) audit attribution is lost; (2) the context-entry edit/delete endpoints are **author-or-admin gated** (`admin/api.js:4701`), so agent entries are effectively **admin-only to edit** — a non-admin Worker gets 403. Fix the write path to record the agent identity as `author_id`. Related to the title=NULL gap (same lossy agent write path).

[P2] FEAT.25360's resolve action needs org-member authz, not author-only — decisions are often agent-authored (`author_id` null), so an author-only gate (like today's entry-edit endpoint) would let only admins resolve them. The resolve/reopen endpoints must allow any permitted org member. (Design input captured during the FEAT.25360 Planning lap.)

[P2] Two-writers guard for agent-owned stages — when a headless agent owns a stage, the in-server `on_enter` executor must NOT also fire (both write to the same journal). Surfaced in feature-factory step 1 (FEAT.25352): had to manually `UPDATE blueprint.stage_playbooks SET is_active=false` before the run and restore after. Make it a wrapper responsibility or a per-stage "execution owner" flag so a cron can do it safely. Implements the 2026-06-23 [STRATEGY] "Gladius serves; consumers orchestrate" — one execution owner per stage.

[P2] Agent-written context entries have `title = NULL` — MCP `write_context_entry` has no `title` param, so agents put the title as a markdown `# H1` inside `content`. The journal renders titleless / mis-derives. Add an optional `title` to the tool + map to `runtime.context_entries.title`. Surfaced in feature-factory step 1.

[P2] `getPlaybookForStage` ignores `wit_type_id` for stage-specific playbooks — a Feature-bound playbook fires for any type; type-specific playbooks aren't actually type-scoped. (Sidestepped Session 33 by setting Feature Dev playbooks to `wit_type_id=NULL`.)

[P2] MCP tools to set fields / ack exit criteria — Review/Deployment gates (`pr_url`, `pr_status`, `deployed_version`) need curl+bearer from the worker today; the MCP agent can't satisfy them natively.

[done 2026-06-23] feat(exit-criteria): FEAT.25361 — Discovery readiness gate. `no_unresolved_decisions` codified condition type added to exitCriteria.js; applied to dogfood Discovery stage as 3rd gate. Session-start skill Step 1.4.5 added to read live Gladius board. Commit: 58e21dd.

[P2] Planning stage playbook (FEAT.25362, Todo) — Worker briefing document: assembles acceptance criteria, decisions, constraints into a structured brief. Sonnet-class. No code search. Writes one `note` entry titled "Planning Brief."

[P2] Playbooks: external quality check actions (FEAT.25363, Todo) — Allow playbooks to trigger external verify-only actions (PR linkage check, naming convention check). No fix/execution in FlowOS scope; results write back as context entries.

[P2] Bulk ops integration tests (DEBT.25342, Backlog) — `tests/bulk-ops.test.js`; happy path + partial-success. Deferred since Session 26.

[P2] Stage-evidence requirements (FEAT.25343, Backlog) — named attachment slots per stage that gate transitions. Brainstorm before planning.

[P2] Exit-criteria rationale/expectation field — each criterion carries human/agent-readable intent alongside the machine condition ("test coverage ≥ 80% because X; record in field `test_coverage`"), assembled into the worker's context via `get_assembled_context`. This "exit-criteria context" is what makes tier-2/3 (worker-evidence and manual-ack) gates legible enough to satisfy honestly. Falls out of the 2026-06-23 [STRATEGY] "frames and gates" decision. Dissolves the "who computes the % score" question — Gladius states the expectation; the agent+human produces and records the evidence.

[P2] Playbook read/author over API/MCP — `get_stage_playbook` (read, so an external agentic session can fetch its own instructions) + playbook CRUD over API/MCP (author, so users aren't forced through the UI). Product capability, decoupled from the feature-factory loop. Per 2026-06-23 [STRATEGY] "Gladius serves; consumers orchestrate." The immediate loop uses wrapper-injection (`--append-system-prompt-file`), no server change needed — these are the follow-on product surface.

[P2] Open-source release prep (FEAT.25344, Backlog) — README, LICENSE, seed-and-go experience.

## Done (Session 37 — 2026-06-24 — FEAT.25338 MCP→REST refactor)

[done 2026-06-24] refactor(mcp): FEAT.25338 — MCP server calls REST API via Bearer auth; http-client.js added; zero direct DB/runtime imports. get_session_context endpoint + MCP tool for single-round-trip board snapshot. STATE.md scope narrowed; gladius-session skill created. Commits: d242515..8a176d8.

## Done (Session 36 — 2026-06-23 — FEAT.25454 + FEAT.25361 + session-start board)

[done 2026-06-23] feat(search): FEAT.25454 — sort/date NL support. `sort_by/sort_dir/created_after/created_before` wired translator→endpoint; code-fence stripping in `extractText()` (Haiku wraps JSON in fences); `type_name` frontend gap fixed as bonus. All 59 integration tests green; browser-verified. Commit: 9a4a772.
[done 2026-06-23] feat(exit-criteria): FEAT.25361 — Discovery readiness gate. `no_unresolved_decisions` condition type; applied to dogfood Discovery stage; session-start Step 1.4.5 reads live board. Commit: 58e21dd.

## Done (Session 35 — 2026-06-23 — FEAT.25487 playbook-run observability)

[done 2026-06-23] feat(observability): FEAT.25487 — playbook-run records + inline UI indicator. Migration 020 (`runtime.playbook_runs`), executor INSERT `running` before LLM call + UPDATE on all exit paths, `GET /work-items/:id/playbook-runs` (org-membership gated, fixed IDOR), `PlaybookRunIndicator` component (amber-pulse/green/red, 8s poll while running). Merged to main + pushed.

## Done (Session 34 — 2026-06-23 — Interactive-Worker dogfood + FEAT.25360)

[done 2026-06-23] feat(context): FEAT.25360 open/resolved lifecycle for decision entries — migration 019 (resolved/resolved_by/resolved_at/resolution_text + partial index), resolve/reopen endpoints (org-member authz, append-only events), journal UI (badges, inline resolve/reopen, open-decisions filter), 6 integration tests. Built from Gladius's own Planning Brief; merged to main + pushed.
[done 2026-06-23] feat(dogfood): interactive-Worker path — this session as Worker via MCP; Path A (in-server Executor) exercised for the first time; `scripts/dogfood/run-stage.sh` chains all stages (headless path). Both paths proven.
[done 2026-06-23] docs(decisions): two [STRATEGY] principles — "Gladius frames and gates; the worker executes and verifies" + "Gladius serves; consumers orchestrate"; Actors & Terminology taxonomy → ARCHITECTURE.md (created).
[done 2026-06-23] fix(playbooks): Planning max_tokens 2048→8192 (truncated on rich journal).
[done 2026-06-23] fix(ops): trimmed 25,048 orphaned `requested_by` rows (ghost user_id=1, enterprise seed); DEBT.25476/25359 demoted to P3 (live poison source gone).
[done 2026-06-23] chore(repo): `_internal/` + `*_HANDOFF.md` + ARCHITECTURE.md gitignored; design-review doc/screenshots pulled out of public history before push.

## Done (Session 33 — 2026-06-23 — Dogfood lap 1)

[done 2026-06-23] feat(exit-criteria): context_entry_exists codified condition + Discovery/Planning context-sufficiency gates (PR#3)
[done 2026-06-23] feat(playbooks): redesign all 5 Feature Dev playbooks to the workflow/domain boundary; version-controlled in scripts/dogfood/playbooks/ + loader; Discovery/Planning → Sonnet (PR#5)
[done 2026-06-23] fix(playbooks): DEBT.25477 — tolerant agent-output parser + executor hardening; repaired 6 "AI Analysis" JSON blobs in place (PR#6)
[done 2026-06-23] chore(repo): ignore .mcp.json; untrack leaked design spec (PR#4); .mcp.json configured so the Gladius MCP loads in Claude Code
[done 2026-06-23] fix(ops): cleared the live notification poison-loop (deleted item 106 ghost relationships, reset subscriber, drained backlog); renamed playbooks FlowOS→Gladius

## Done (Session 32 — 2026-06-22)

[done 2026-06-22] fix(mcp): argument key mismatches in transition_work_item and write_context_entry; wire parent_id in add_comment
[done 2026-06-22] feat(ui): widen work-item drawer to 65vw / 960px max
[done 2026-06-22] chore(search): delete dead SavedFilterFormDrawer (stale jql payload, unreachable after JQL removal)
[done 2026-06-22] fix(mcp-tools): table-fixed columns, muted header row, enum values inline in description column
[done 2026-06-22] chore(dogfood): create FEAT.25454 (search enhancement) with full discovery/design/acceptance/NFR journal

## Done (Session 31 — 2026-06-22 — Simplification Sprint + Branding)

[done 2026-06-21] chore: rename project to Gladius — FLOWOS_* → GLADIUS_* env vars, cookie gladius.sid, mcp/gladius-context-server.js, package names, display strings, X-Gladius-* webhook headers, LICENSE (MIT), README stub. URI scheme `flowos://` deferred.

## Done (Session 29 — 2026-06-17)

[done 2026-06-17] feat(auth): Bearer token middleware — async `requireAuth`, `findUserByApiToken`, full Bearer→session fallback chain in `core/auth.js`
[done 2026-06-17] fix(playbookExecutor): code fence stripping (global regex) + `max_tokens` from playbook frontmatter (default 4096)
[done 2026-06-17] feat(dogfood): Feature Discovery playbook written and activated (stage 638, WIT type 138)
[done 2026-06-17] feat(dogfood): FEAT.25338 moved to Discovery; all 5 decisions answered and recorded as journal entries
[done 2026-06-17] chore(dogfood): org context entry documenting 8 MCP tools added to context library
[done 2026-06-17] docs(decisions): FlowOS boundary principle — workflow ownership vs. domain execution [STRATEGY]

## Done (Session 28 — 2026-06-16)

[done 2026-06-16] chore(env): PM2 installed at ~/.npm-global, flowos-api process registered, admin-ui built for static serving
[done 2026-06-16] docs(dogfood): dogfood environment design spec (docs/superpowers/specs/2026-06-15-dogfood-environment-design.md)
[done 2026-06-16] docs(dogfood): dogfood implementation plan (docs/superpowers/plans/2026-06-15-dogfood-environment.md)
[done 2026-06-16] feat(dogfood): scripts/setup-dogfood.js — org, workflow, WIT types, agent user (id:309), 13 org context entries, MCP registration in .claude/settings.json
[done 2026-06-16] feat(dogfood): scripts/load-dogfood-items.js — 15 work items (FEAT.25338–25352, DEBT.25342); MCP refactor in Todo, rest in Backlog

## Done (Session 27 — Context v1)

[done 2026-06-15] feat(context-v1): item journal (runtime.context_entries), org context library (blueprint.org_context), stage playbooks (blueprint.stage_playbooks), AI execution engine (playbookExecutor.js), MCP stdio server (8 tools)

## Done (Sessions 1–26)

See git log for full history. All 7 Tier-1 go-live blockers shipped (auth, notifications, search, attachments, audit trail, bulk ops, form-based intake).
