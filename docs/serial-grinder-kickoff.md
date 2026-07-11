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
2. DECISION RESOLUTION (tiered):
   - GROUNDED: if an open design/discovery question is answerable from existing
     sources — org context library, the item's journal + ancestors, DECISIONS.md,
     CLAUDE.md/ARCHITECTURE.md, the non-negotiable design-constraints table — write a
     `decision` journal entry on the item WITH the citation, and proceed.
   - NOVEL: new scope, product direction, anything touching the design-constraint
     non-negotiables, or conflicting grounded sources → park with a drafted
     recommendation + the sources you considered. Never guess product direction.
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
4. INDEPENDENT REVIEW (never trust implementer claims):
   - Read the full PR diff yourself (gh pr diff).
   - Re-run `npx eslint .` and the relevant test file(s) in the implementer's worktree
     yourself. Green means you saw it green.
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

- **Target set:** swap the cluster list for `{ count: N }`-style ordinary curation once
  the cluster is done — the prompt's curate step already falls through to priority order.
- **Rubric:** calibrate from the announced merge verdicts. If the exception (park) rate
  is near zero for 2+ runs with no bad merges, the rubric is probably too loose to be
  informative or the work is genuinely low-risk — either way, that's the signal to
  consider Phase 2.
- **Phase 2 (scheduled, not built):** same prompt launched by a cron'd local Claude Code
  session (no cloud cost); digest + parked list instead of live supervision. Gate:
  ≥2 supervised runs, zero bad merges, low exception rate.
