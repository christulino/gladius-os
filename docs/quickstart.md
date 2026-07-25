# Quickstart: the 10-minute proof loop

Gladius gates work: an item can't leave a stage until that stage's exit criteria are met. This walkthrough takes you from a fresh install to the moment you *see that happen* — a transition the board refuses until you've done the work — in about ten minutes.

## Before you start

You need a running Gladius. If you haven't installed it yet, follow the two-step Docker install in the [README](../README.md#install-docker), then come back here. You'll need the admin password Gladius printed in the app logs on first boot:

```bash
docker compose logs app | grep -A1 "Admin password"
```

## 1. Log in

Open **http://localhost:3000/admin/** and sign in with `admin@example.com` and that password.

## 2. Create a work item

On the **Board**, click **+ New Work Item**. Pick **Feature** from the Service Catalog, give it the title **Add dark mode**, and click **Save**. It appears in the **Backlog** column.

## 3. Move it toward Review

Click the card to open it, go to the **Details** tab, and use **Actions → Transition to…** to advance it one stage at a time:

| From | Click |
|------|-------|
| Backlog | **Add to Todo** |
| Todo | **Skip to Planning** |
| Planning | **Start Dev** |

The item is now in **Dev/Test**.

## 4. Hit the gate

Still in **Actions → Transition to…**, click **Submit for Review**. Instead of moving, the board stops you:

> **Exit criteria for transition to "Submit for Review"**
> **Test plan documented** *(auto)* — Requires at least 1 "test-plan" context entry (found 0)
>
> **Blocked — criteria not met**

This is the point. You didn't configure anything — this Feature workflow ships with a rule that **Dev/Test → Review requires evidence of testing**, and the board enforces it. There's a *Waive this criterion* escape hatch for admins, but let's satisfy it honestly instead. Click **Cancel**.

## 5. Satisfy the criterion

Open the **Journal** tab and click **+ Add Entry**. Change the entry type from `note` to **test-plan**, write what you tested, e.g.:

> Verified dark mode toggles from the header and the preference persists across a page reload.

Click **Add Entry**.

## 6. Advance — this time it works

Back on **Details → Actions → Transition to… → Submit for Review**. The criterion now shows as met:

> **Test plan documented** *(auto)* — A test-plan journal entry documenting what was tested and how to verify must exist before moving to Review.
>
> **Confirm Transition**

Click **Confirm Transition**. The item moves to **Review**. The gate held until the work was real, then got out of your way.

## What just happened

You watched Gladius do the one thing that makes it different from a task tracker: **the workflow gated the work.** Exit criteria are policies attached to a transition, not suggestions — the board is a health monitor that won't let an item advance past a stage until that stage's contract is satisfied. You define the policy once; the system enforces it every time, for every item, without anyone having to remember to check.

## Next steps

- **Define your own gates.** In the sidebar, open **Workflows**, pick a stage, and add an exit criterion of your own — a manual checklist item, or a codified rule like the one you just met. That policy now gates every item that passes through the stage.
- **Let AI do the framing.** Add an Anthropic API key under **AI Models**, and a stage playbook can draft discovery notes and acceptance criteria for an item automatically as it enters a stage. See [the playbook format reference](playbook-format.md) to write one.
