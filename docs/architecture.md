# Architecture — Gladius

> Core model decisions and system architecture: the actor/terminology model and how
> playbooks reach the people (and agents) doing the work. For database schema and REST
> endpoint detail, see the code and [`docs/rest-api-reference.md`](rest-api-reference.md).

---

## Actors & Terminology

These are the canonical roles. "Agent" alone is ambiguous — **always qualify it**
(Executor / Worker / Headless Worker). The most common confusion is treating the
**Worker** and the **Headless Worker** as different actors: they are the *same role*,
one with a human in the loop and one without.

| Term | Who/what | Layer | Code-aware? |
|------|----------|-------|-------------|
| **Gladius** | The system: workflow engine, system of record, context + playbook provider, gate evaluator. Frames and gates; never does domain work. | — | n/a |
| **Executor** | The single-shot LLM **Gladius itself invokes** server-side — runs `on_enter` playbooks (`runtime/playbookExecutor.js`) and internal tasks like NL→search translation. Code-blind, no tools, writes context back. Generates *framing knowledge*, never a gating verdict. | workflow | no |
| **Worker** | The **intended user**: agent **+ human**, doing the actual domain work via MCP + UI. Code-aware. Produces the evidence that satisfies gates. ("The worker executes and verifies.") | domain | yes |
| **Headless Worker** | A **Worker with no human** in the loop — an autonomous `claude -p` session. *Same role as Worker, different instance.* Used to dogfood the autonomous path; the Feature Factory's labor later. | domain | yes |
| **Orchestrator** | The wrapper/loop that polls Gladius, claims an item, spawns Headless Workers (in worktrees), meters spend. A **consumer** that runs *on top of* Gladius, not part of it. Shell scripts today, cron later. | above Gladius | n/a |
| **Maintainer** | Configures Gladius: authors playbooks, defines stages + exit criteria, curates org context. **Decides what the gates are.** "Gladius frames and gates" means *the Maintainer frames, via Gladius.* | config | n/a |
| **Architect** | Builds/improves Gladius itself, working through a build session. In solo dogfooding also wears the Maintainer hat. | meta | yes |

**Non-actor — the agent identity.** A configured agent user id (`GLADIUS_AGENT_USER_ID`)
is the user record that AI-authored writes are attributed to (`is_agent=true`). It is an
*identity*, not an actor — both the Executor and a Headless Worker can write *as* it.

**The Feature Factory** = the whole autonomous assembly: Orchestrator + Headless Workers
+ worktrees + cron. It runs *on top of* Gladius (per the "Gladius serves; consumers
orchestrate" decision), and is not part of the Gladius product.

### Two ways a playbook reaches a Worker

| Path | Mechanism | Who runs the playbook | Used by |
|------|-----------|----------------------|---------|
| **A — Executor path** | On stage entry the **Executor** runs the playbook server-side, writes framing to the journal; the Worker reads it via `get_assembled_context`. The Worker never sees the playbook itself. | Executor | Interactive human+agent Workers (today's real path; no `get_stage_playbook` MCP tool yet) |
| **B — Injection path** | The **Orchestrator** injects the playbook as the Headless Worker's system prompt; the Worker executes the instructions directly. Executor is disabled for that stage. | Headless Worker | The Feature Factory |

Path A (Executor framing) + an interactive Worker is **not** a two-writers conflict: the
Executor generates non-gating *framing*; the Worker *executes and verifies* on top of it —
different altitudes. The "one execution owner per stage" rule only forbids two actors
trying to *execute* the same stage (e.g. Executor + Headless Worker both fully working it).
