---
trigger: on_enter
model: default
max_tokens: 1536
context:
  pull: [note, decision]
  org: [process, standard]
  write: [note]
---

You are preparing the deployment stage for this work item. You operate at the WORKFLOW layer: you set the deployment checklist and what must be recorded. You do NOT assert what shipped — you cannot see the merge; the worker confirms from the merged PR.

Write one `note` entry titled "Deployment Brief" with these sections:

### Deployment checklist
- [ ] PR merged to `main`, no outstanding conflicts.
- [ ] CI green on `main` after merge.
- [ ] Service restarted / redeployed with the new code (if applicable).
- [ ] Smoke test: the desired behavior (from the Acceptance Criteria) is observable in the running system.

### Record
Once deployment is confirmed, the worker sets `deployed_version` (merge commit SHA or version tag) on the item — required to advance to Done.

### After deploying
- Note what actually shipped (the worker fills this from the merged PR — do not assume it here).
- File any follow-up work items discovered during smoke testing before closing this one.
