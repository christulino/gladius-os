# Backlog-Grinder Session — Kickoff

A reusable kickoff for an **interactive, supervised** Gladius backlog-grinding session
(like the one that produced PRs #13–#16). Not headless, not cloud — you start a normal
`claude` CLI session and paste the prompt below. Opus orchestrates; sonnet sub-agents
implement one item at a time in isolated worktrees and open PRs. Nothing merges — you
review the PR stack and merge yourself.

## How to run
1. **Pre-flight — clear the decks.** Run `gh pr list` and `git worktree list`. Merge (or
   consciously note) any **open PRs from prior runs before starting a new one**. A PR left
   open while the board says "Done" is how a branch silently drifts: it accumulates
   duplicate commits and rots into conflicts against the PRs that merged around it. (This
   is exactly how a one-line "chore" PR turned into an hour of conflict surgery — and it
   carried a real unmerged fix nobody noticed.) Resolve the backlog of open PRs first.
2. In the gladius-os repo, start a session: `claude --model opusplan` (or whatever you use).
3. Make sure the PM2 dogfood instance is up on :3000 (`pm2 list` → `gladius-os` online).
4. Paste the **Kickoff Prompt** below. Adjust `count` if you want more/fewer items.
5. Watch via `/workflows`, the board at `localhost:3000/admin/`, and the GitHub PR tab.
6. When it finishes, review the PR stack it hands you and merge the ones you want.
7. **Post-merge sweep.** After merging, run the post-merge sweep to close out board items:
   ```
   node scripts/post-merge-sweep.js           # dry run — shows what will move
   node scripts/post-merge-sweep.js --confirm  # sets pr_status=merged + transitions to Done
   ```
   Or: `npm run post-merge-sweep -- --confirm`

   The script queries for items with `pr_url` set and `pr_status != merged`, checks each
   PR's state via `gh`, then atomically sets `pr_status=merged` and transitions the item
   to Done (respecting all exit criteria — if others are unmet it reports which ones block).

8. **Worktree cleanup.** Each run leaves a worktree + branch behind (one per item).
   Once you've merged, prune them:
   `git worktree remove <path>` for each merged item, then `git branch -D <branch>`
   (squash-merge means `git branch -d` will refuse with "not fully merged" — `-D` is
   expected and correct here). The grinder session can do this sweep for you on request —
   it verifies each branch maps to a merged PR and each worktree is clean before removing.

## Kickoff Prompt (paste this)

```
Interactive, supervised Gladius backlog-grinder session.

First: invoke the gladius-session skill to orient.

Then run the autonomous backlog grinder:
- Run the workflow named "gladius-backlog-grinder" with args { count: 5 }.
  (It lives in .claude/workflows/gladius-backlog-grinder.js. If name resolution fails,
   run it via scriptPath at that path.)
- It curates ready, independent Backlog items live from the Gladius board (org 109),
  applying exclusion + conflict-avoidance rules, then SERIALLY implements each via a
  sonnet sub-agent in its own git worktree off origin/main -> verify (eslint + tests)
  -> open a PR. It NEVER merges.
- While it runs, post a progress update every 15 minutes: schedule a wakeup and
  summarize PRs opened / in-flight / blockers, tracked off `gh pr list` + `git worktree
  list` (NOT get_session_context's active list — that endpoint historically under-reports
  in-progress items).
- On completion, present the full PR stack for my batched merge review, with flags:
  PR size, files touched, any sibling PRs touching the same hot file (merge-order risk),
  and anything an agent did beyond its stated scope. Also list any new items agents
  discovered and wrote back to the board.
- In the results report, include a "Blocked / stopped" section: every item that could
  NOT be completed within its playbook + exit criteria, with the blocking reason (which
  criterion or step, and what's needed to unblock — e.g. a Gladius decision to resolve).
  These are items where the agent left a comment and stopped rather than forcing progress.
- After I confirm I've merged, run the post-merge sweep: `node scripts/post-merge-sweep.js --confirm`
  (sets pr_status=merged + transitions matching items to Done via the exit-criteria engine).
  Then offer to prune the merged worktrees + branches (verify each branch maps to a merged PR
  and each worktree is clean first before removing).

Rules (non-negotiable):
- Do NOT merge anything. Merge is gated for me; settings deny + branch protection on main
  enforce it. Hand me the PRs; I merge.
- Follow the playbook and exit criteria for each work item exactly. The agent+human
  driving Gladius is the Worker: it executes and verifies, Gladius frames and gates.
  NEVER bypass, falsify, ignore, or waive an exit criterion to make progress. Do not
  mark a criterion satisfied unless it genuinely is, and do not skip playbook steps.
- Check exit criteria BEFORE starting implementation: after claiming an item, call
  get_exit_criteria for the current and next stages before writing any code. If any
  criterion is currently failing for a reason only the human can resolve (unresolved
  decision, manual ack, external sign-off), write zero code and stop immediately.
- If a work item cannot be completed within its playbook and exit criteria — the criteria
  can't be honestly satisfied, a playbook step can't be followed, or a Gladius decision
  must be resolved first — then: (1) write a comment on that work item explaining exactly
  what blocked progress (which criterion/step, and what's needed to unblock, e.g. a
  decision to resolve in Gladius), (2) stop working on that item — leave it where it is,
  do not force it forward, and (3) move on to the next item. Surface every such blocked
  item in the final results report with the blocking reason.
- Wait for my explicit "go" before any consequential or outward-facing action. Orient and
  recommend first, then wait. Read-only investigation is fine.
- Keep updates tight and specific (PR numbers, file names, item keys).
```

## What's already wired (so a fresh session inherits it)
- **Workflow:** `.claude/workflows/gladius-backlog-grinder.js` (name: `gladius-backlog-grinder`).
- **Merge gate:** `.claude/settings.json` deny-list (`gh pr merge`, GitHub MCP
  `merge_pull_request`, force-push, push-to-main, outbound MCP) + GitHub **branch
  protection on `main`** (PR-required, admin-enforced, 0 approvals so you self-merge).
- **Permission mode:** `acceptEdits` (global) so file writes don't prompt.
- **Curation rules** (baked into the workflow): skip auto-gen test artifacts, the
  conflict-cluster (cut/removal items), meta/infra items, and anything targeting the
  /v1 surface slated for deletion; pick at most one `admin/api.js`-touching item per run.

## Tuning
- `count`: 5 is the default. Higher = more PRs but more morning conflict-resolution
  (sibling PRs colliding on hot files). 5–6 is the sweet spot for one supervised run.
- The curate step re-queries the live board each run, so newly-discovered and newly-added
  items (e.g. DEBT.26002, DEBT.26003) get picked up automatically.
