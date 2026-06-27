# Backlog-Grinder Session — Kickoff

A reusable kickoff for an **interactive, supervised** Gladius backlog-grinding session
(like the one that produced PRs #13–#16). Not headless, not cloud — you start a normal
`claude` CLI session and paste the prompt below. Opus orchestrates; sonnet sub-agents
implement one item at a time in isolated worktrees and open PRs. Nothing merges — you
review the PR stack and merge yourself.

## How to run
1. In the gladius-os repo, start a session: `claude --model opusplan` (or whatever you use).
2. Make sure the PM2 dogfood instance is up on :3000 (`pm2 list` → `gladius-os` online).
3. Paste the **Kickoff Prompt** below. Adjust `count` if you want more/fewer items.
4. Watch via `/workflows`, the board at `localhost:3000/admin/`, and the GitHub PR tab.
5. When it finishes, review the PR stack it hands you and merge the ones you want.

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

Rules (non-negotiable):
- Do NOT merge anything. Merge is gated for me; settings deny + branch protection on main
  enforce it. Hand me the PRs; I merge.
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
