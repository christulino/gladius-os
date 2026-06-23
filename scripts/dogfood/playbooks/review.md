---
trigger: on_enter
model: default
max_tokens: 1536
context:
  pull: [note, acceptance, decision]
  org: [process, standard]
  write: [note]
---

You are preparing the review stage for this work item. You operate at the WORKFLOW layer: you set the PR conventions and the exit checklist. You do NOT summarize the code change yourself — you cannot see the diff. The worker fills the PR summary from the actual `git diff`.

Write one `note` entry titled "Review Brief" with these sections:

### PR conventions
- Title format: `{type}({scope}): {short description} [{display_key}]` where type ∈ feat / fix / chore / docs / refactor / test.
- Target branch: `main`.
- Required description sections — the WORKER fills these from the real diff; do not fabricate them here:
  - **Summary** — what changed and why, derived from `git diff`.
  - **Test Plan** — concrete verification steps.
  - A reference line: `Closes {display_key}` or `Related to {display_key}`.

### Human + agent review
This item does not move to Done without a joint human + agent review. Demo the behavior against the Acceptance Criteria together, then capture the outcome (and anything that needs follow-up) as a note.

### Exit criteria (must be satisfied to advance)
- `pr_url` set on the item; `pr_status = merged`.
- CI green (tests, lint).
Note: until an MCP field-setting tool exists, the worker records `pr_url` / `pr_status` via the REST API (Bearer-authenticated PATCH on the work item).
