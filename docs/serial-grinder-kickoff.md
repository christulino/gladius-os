# Serial Grinder Session — Kickoff (merge-as-you-go)

A reusable kickoff for a **supervised, serial, merge-as-you-go** Gladius backlog-grinding
session. One item at a time, full cycle per item: implement → independent review →
tiered auto-merge → board sweep → next item off fresh main. The orchestrator (Fable/Opus)
holds the judgment: it reviews diffs, makes the merge call against a rubric, and answers
grounded design/discovery questions to keep the loop moving. You supervise; you get pinged
only for parked exceptions.

This complements — does not replace — the batch grinder
(`docs/backlog-grinder-kickoff.md`). Batch = N independent items, PRs pile up, you
merge-review the stack. Serial = sequential merges, no sibling conflicts, handles the
dependency-ordered work the batch grinder must exclude (e.g. the June conflict-cluster
DEBT.25488–25494).

## One-time prerequisite (you, not the agent)

The merge gate is enforced in `.claude/settings.json`. To let the orchestrator merge,
**you** edit it (the agent is barred from self-modifying settings):

- In `permissions.deny`, remove `"Bash(gh pr merge:*)"`.
- In `permissions.allow`, add `"Bash(gh pr merge:*)"` (so merges don't prompt per-use).
- Leave `"mcp__plugin_github_github__merge_pull_request"` in deny — exactly one merge
  path (`gh` CLI) keeps merges auditable in shell history.
- Leave all force-push / push-to-main denies and GitHub branch protection untouched.

Revert the two lines to re-arm the gate for batch-grinder sessions.

## How to run

1. **Pre-flight — clear the decks.** `gh pr list` and `git worktree list`. Merge or
   consciously close any open PRs from prior runs first; a stale open PR is how branches
   rot into conflict surgery.
2. Make sure the PM2 dogfood instance is up on :3000 (`pm2 list` → `gladius-os` online).
3. Start a session in the gladius-os repo with your strongest orchestrator model
   (Fable or Opus — the merge and decision judgment lives here, don't economize on it).
4. Paste the **Kickoff Prompt** below.
5. Approve (or reorder) the proposed item sequence when the orchestrator presents it.
   Then watch: every merge is announced with a one-line rubric verdict; parked items
   surface immediately, caveats first. Answer parked questions inline — the item re-enters
   the queue in the same session.
6. At end of session, confirm (or decline) the dogfood refresh (pull main, rebuild
   admin-ui if it changed, `pm2 restart gladius-os`).

## Kickoff Prompt (paste this)

```
Supervised SERIAL merge-as-you-go Gladius grinder session. You are the orchestrator:
you curate, dispatch implementers, review, MERGE (tiered rubric below), sweep, and
continue — one item at a time, each item branching off post-merge main.

First: invoke the gladius-session skill to orient. Then verify the merge gate is open
(`.claude/settings.json` must NOT deny `gh pr merge`) — if it's still denied, stop and
tell me; do not attempt to edit settings yourself.

CURATE & SEQUENCE (once, up front)
- Org 109. Read the live board. Target set for this run: the June conflict-cluster
  (DEBT.25488, DEBT.25489, DEBT.25490, FEAT.25491, DEBT.25492, FEAT.25493, DEBT.25494)
  plus, if the cluster finishes, next-ready Backlog items in priority order under the
  batch grinder's standing exclusions (auto-gen test artifacts, meta/infra, /v1-targeting).
- Read each cluster item's journal + linked design-review context and derive a dependency
  order. Present me the proposed sequence with one-line rationale per item and WAIT for
  my go before item 1. This is the only pre-approval in the run.

PER-ITEM CYCLE (track as explicit tasks so skipped steps are visible)
For each item, in order, complete ALL steps before starting the next item:
1. GATE CHECK: get_exit_criteria + get_available_transitions for the item's path.
   If a criterion is failing for a reason requiring a human (manual ack, external
   sign-off), park (see PARKING) — unless it's an unresolved decision, then try
   DECISION RESOLUTION first.
2. DECISION RESOLUTION (tiered — bias HARD toward deciding, not parking):
   - ORCHESTRATOR DECIDES (the default for engineering calls) — you hold architect
     authority; exercise it. Any REVERSIBLE call is yours to make and log, never to park:
     scope boundaries, item sequencing, test strategy / which files CI runs, interim-vs-
     complete tradeoffs, refactor shape, migration mechanics (including editing an applied
     migration when the runner is version-tracked so existing installs won't re-run it),
     library-internal design. Bending a stated rule is fine when the rule's own rationale
     doesn't apply to the case — that's a decision, not an escalation. Write a one-line
     `decision` journal entry (what + why) and proceed. Do NOT ask the human to pick
     between two engineering options you could choose yourself. Before parking, ask: "Do I
     actually not know, or do I know and I'm deferring out of caution?" If you know,
     decide. (Over-parking reversible calls burns the human's attention — the whole point
     of the loop is that it does NOT need them for these.)
   - GROUNDED — an existing source DIRECTLY states the answer (org context, the item's
     journal + ancestors, DECISIONS.md, CLAUDE.md/ARCHITECTURE.md, the design-constraints
     table): write a `decision` entry WITH the citation and proceed. Stitching a
     conclusion across several sources is you reasoning to a call — that's the
     ORCHESTRATOR-DECIDES tier, not a citation.
   - PARK FOR THE HUMAN — ONLY the genuinely irreversible or direction-setting, and only
     these: (a) spending money / paid services; (b) publishing outward under the
     maintainer's name (releases, public README voice, announcements, new public repos);
     (c) deleting or breaking a SHIPPED user-facing surface or API contract; (d) product
     direction / positioning / strategy / the design-constraint non-negotiables;
     (e) anything the harness itself hard-blocks (surface it — don't route around it).
     Park with a drafted recommendation + the sources you considered. Everything else you
     decide. Never guess product direction.
3. DISPATCH: write a fresh implementer prompt for this item and pick the model —
   sonnet by default; opus when the item is multi-subsystem, migration-bearing,
   judgment-heavy, or a sonnet attempt already failed on it. The prompt must carry the
   full Worker discipline from the batch grinder's implPrompt
   (.claude/workflows/gladius-backlog-grinder.js): claim the item first; pre-build gate
   check; follow playbook + exit criteria exactly, never bypass/falsify/waive; isolated
   worktree off origin/main (NEVER work in the main checkout — it's the live PM2
   dogfood); minimal scoped change; write discovered follow-ups back to the journal;
   run eslint + only the relevant test files (alt port if a server is needed); open a
   PR with the repo's commit trailers; set pr_url + pr_status=open in ONE
   set_work_item_fields call; transition to Review only. The implementer NEVER merges.
   One retry per item max.
   IMPLEMENTER DIED MID-FLIGHT (session/API limit, crash — distinct from a rejected
   attempt): inspect what it left. Claimed the item + made a worktree but committed no
   code → discard the empty worktree + branch and re-dispatch fresh, telling the new
   implementer the item is ALREADY CLAIMED and to continue from its current stage (do NOT
   re-claim from Backlog). Left uncommitted partial work → inspect it before choosing
   resume vs. restart. A death is infrastructure, NOT one of the "two consecutive
   failures" stop-condition.
4. INDEPENDENT REVIEW (never trust implementer claims — this step is load-bearing; it is
   what catches defects the implementer reports as clean):
   - Read the full PR diff yourself (gh pr diff).
   - Re-run `npx eslint .` and the relevant test file(s) in the implementer's worktree
     yourself. Green means you saw it green.
   - TEST SIGNAL IS AMBIGUOUS ON THE SHARED DOGFOOD — do NOT read a red test as a
     regression until you've ruled out contention. Two known-environmental failure modes,
     both caused by the live :3000 dogfood rather than the diff:
       (a) events-integration audit-log CURSOR tests fail in any worktree because the
           live dogfood holds the single PG advisory lock, so the worktree's event
           processor can't drain.
       (b) Running several test files in ONE `node --test` invocation collides on
           `testOrg.js`'s millisecond-resolution slug → spurious 409 "cancelled".
     So: RUN TEST FILES INDIVIDUALLY (one `node --test --test-force-exit tests/<file>`
     per file), never batched. Before treating any red as real, confirm the diff actually
     touches the failing test's code path (compare changed files against the event-drain /
     subscriber path). A failure in code your diff never touched, that reproduces
     identically against clean main under the live dogfood, is environmental — say so
     explicitly in your merge verdict; do NOT silently merge past it, and do NOT park a
     good PR over it. (Root cause: DEBT.26600 / DEBT.26643 test isolation — until those
     land, this ambiguity is permanent and you must disambiguate by hand every time.)
   - SERVER HYGIENE — your own review re-runs spawn alt-port servers (3011+). Track their
     PIDs and `kill -9` them when done: SIGTERM is a no-op (DEBT.26639 — the server's
     SIGTERM handler never calls process.exit()). NEVER touch the :3000 dogfood. Leftover
     review servers hold the advisory lock and make (a) worse for every later item.
   - Check diff scope against the item's discovery/acceptance criteria.
5. MERGE DECISION — merge ONLY if ALL hold:
   - lint + relevant tests green under your own re-run
   - diff scope matches the item's acceptance criteria; no out-of-scope files, no creep
   - no new dependencies; no edits to applied migrations; new migration files only if
     the item's spec calls for them (and they're idempotent)
   - no auth/session/security-surface changes unless the item explicitly specifies them
   - deletions may be large when they match named cut targets (that is the cluster's
     job); large ADDITIONS get line-by-line review, not auto-park
   - Review-stage exit criteria honestly satisfiable
   AMENDMENT CAP: if review finds a fixable issue you MAY send the implementer back to
   amend the OPEN PR (same worktree/branch) with the specific fix — but at most TWICE per
   item. A third amendment round → PARK for me: an item needing three review passes is
   telling you the rubric or the spec is missing something a human should look at.
   ANY uncertainty → PARK. A bad merge poisons every later item's baseline; parking
   is cheap. Announce every merge as one line:
   "MERGE <key> — <verdict: what you checked, why it's green>".
   Merge with `gh pr merge <n> --squash`.
6. SWEEP & RESET: `node scripts/post-merge-sweep.js --confirm` (sets pr_status=merged,
   transitions Review→Done through the gate engine — never hand-set Done). Then remove
   the item's worktree, `git branch -D` its branch, and `git fetch origin` so the next
   item branches off updated origin/main.

PARKING (merge or decision)
- Leave the PR open (if one exists). Comment on the board item — and the PR — naming the
  specific blocking concern, criterion, or question, plus your drafted recommendation.
- Tell me immediately, caveats first. If I answer inline, feed the answer back (write the
  decision to the journal) and re-queue the item this session.
- If a parked item is a dependency of the remaining cluster sequence, STOP the cluster
  line and ask me: pivot to independent Backlog items, or halt.

STOP CONDITIONS (hard)
- Two consecutive item failures → STOP entirely. Zoom out, report, re-examine the plan —
  do not patch a patch.
- Never bypass, soften, or reinterpret the merge rubric or an exit criterion to keep the
  loop moving. The gates are the point.
- I can interrupt anytime.

END OF SESSION
- Ask before touching the dogfood: pull main in the live checkout, rebuild admin-ui if
  frontend changed, `pm2 restart gladius-os` — only on my explicit confirm.
- Report: items merged (with PR links), items parked (with the specific blocker +
  drafted recommendation), decisions resolved (with citations), follow-ups written to
  the board, worktrees pruned.
```

## What's wired / assumed

- **Merge path:** `gh pr merge --squash` only. GitHub MCP merge stays denied. Branch
  protection on `main` unchanged (PR-required, 0 approvals, admin-enforced).
- **Board authority:** the Gladius board is authoritative for item status; the sweep
  script moves items Review→Done through the exit-criteria engine, never manually.
- **Implementer discipline:** inherited verbatim from the batch grinder's implPrompt —
  this doc intentionally does not fork it.
- **Worktree gotchas:** fresh worktrees need `.env` copied + `npm install` before
  lint/tests (SASL error and wrong-global-eslint otherwise).

## Tuning

- **Field data (Session 51, 2026-07-12 — first full run):** shipped 7/7 of the June
  conflict-cluster (DEBT.25488–25494, PRs #55–#61), zero parked, zero bad merges. But the
  independent re-run (step 4) caught **3 real defects two implementers reported as clean**
  — a UI 500-path (email/webhook toggles vs. a tightened constraint), a migration
  `(user_id,channel)` PK-collision in a defensive re-label, and a false-red environmental
  test that a careless orchestrator would have mistaken for a regression. One PR needed
  two amendment rounds. Takeaway: the exception rate was NOT near zero, which per the
  rubric note below means the rubric is pulling its weight — and step 4 is the single
  load-bearing rule; nothing else would have caught those three.
- **Target set:** swap the cluster list for `{ count: N }`-style ordinary curation once
  the cluster is done — the prompt's curate step already falls through to priority order.
- **Rubric:** calibrate from the announced merge verdicts. If the exception (park) rate
  is near zero for 2+ runs with no bad merges, the rubric is probably too loose to be
  informative or the work is genuinely low-risk — either way, that's the signal to
  consider Phase 2.
- **Phase 2 (scheduled, not built):** same prompt launched by a cron'd local Claude Code
  session (no cloud cost); digest + parked list instead of live supervision. Gate:
  ≥2 supervised runs, zero bad merges, low exception rate — **AND the test-isolation debt
  closed first** (DEBT.26600 slug collision, DEBT.26643 pool, DEBT.26639 SIGTERM). That is
  a HARD prerequisite, not a nice-to-have: unsupervised, the test-signal ambiguity in
  step 4 means the orchestrator will eventually either merge a false-green or park a
  false-red with no human to catch it. Until an orchestrator gets a clean, unambiguous
  test signal without hand-disambiguation, Phase 2 is unsafe. Durable fix: give the
  verification step its own throwaway Postgres so review never contends with the live
  dogfood for the advisory lock.
