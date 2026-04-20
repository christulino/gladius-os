# Agent Collaboration v1

**Status:** Not started — reserved in notifications v1 (Session 21). Needs a design brainstorm before implementation.

## Goal

Turn FlowOS into an agent collaboration platform. An agent (Claude or another LLM-backed agent) should be able to:
- Receive structured notifications via the reserved `'agent'` channel
- Fetch richer context than the event payload carries (project plan, related work items, recent history)
- Write back to FlowOS — create comments, update work items, transition stages, spawn new work items
- Be a first-class participant in the same matrix, audit log, and relationship model as human users

Motivating use case (Chris, 2026-04-19): "I could be keeping Claude's product roadmap in FlowOS, or the TODO list or even project plans; Claude could be updating FlowOS as the work happens, freeing developers from status updates of any kind."

## What's already in place (from notifications v1)

- `blueprint.users.is_agent` column identifies agent users
- `'agent'` channel registered in `user_notification_channels.channel` CHECK constraint
- Agent channel delivery works — HMAC-signed POST with envelope `{ system_prompt, context: {notification}, instruction: <rendered> }`
- API key auth already supported for non-human callers (`fos_ak_` prefix)
- Agents are routed through the exact same fanout matrix as humans
- Per-host rate limit and ownership challenge protect against misuse

## Scope for v1 brainstorm

**Bidirectional protocol**
- Agent responses feed back as FlowOS mutations — how? Return-body schema? Separate callback endpoint?
- Idempotency key on responses so retries don't duplicate
- Audit trail: `actor_id = agent_user_id` in `runtime.events` — verify the event system already supports this cleanly

**Context fetching**
- Some notifications need more than the event payload. Options: (a) agent polls a FlowOS API for related context using its API key, (b) FlowOS pre-fetches a configurable context bundle and ships it in the envelope, (c) `context_template` gains MCP-like fetch directives
- Related-work-item graph via Neo4j? Or a simpler recursive query in Postgres?

**Tool-use policies**
- Per-agent allow-list: which endpoints may this agent call? Default read-only; writes explicit.
- Store in `blueprint.users` or new `blueprint.agent_policies` table?
- Enforcement at the auth middleware layer — check API-key-owning user's policy before routing

**Response handling modes**
- Agent's response becomes: (a) a comment on the triggering work item, (b) a new work item, (c) a transition, (d) logged + dropped
- Configurable per (agent, event_type) pair? Or per agent globally?

**Agent-origin work items**
- When an agent creates a work item (e.g., Claude adds a TODO while coding), how do we mark provenance? A new `origin='agent'` value or a `created_by_agent_id` column?
- Spawning chains: human creates work item A → assigns to agent → agent spawns B, C — audit must show the chain

**Observability**
- Admin view: which agents are active, recent actions, token cost attribution (maybe later)
- Failure modes: agent hangs, agent misinterprets, agent loops — how do we detect and cut off?

**MCP integration**
- Would this be better as an MCP server that the agent hits, rather than a webhook-push model? Reuse the existing MCP ecosystem for the context-fetching + tool-use side
- Decision: probably hybrid — push for notifications, MCP for the agent-initiated operations

## Open questions

1. Is v1 one-way (notifications → agent) with agent writes via plain API, or truly bidirectional (structured response → FlowOS mutation)?
2. How does an agent identify itself in audit trails when it's acting via an API key vs. via a notification response?
3. Cost visibility — do we want token-cost tracking per agent in admin UI, or defer?
4. How do we test agent flows without making real LLM calls? A recorded-response fixture pattern probably.

## Dependencies

- Notifications v1 (done Session 21)
- Event system (done Session 20)
- Possibly: MCP server framework (could be a separate sub-spec)
- Audit trail UI may land first — it makes agent-driven mutations visible as a side benefit

## Next step

Brainstorm session (use superpowers:brainstorming) to narrow scope, pick the bidirectional vs pull-only tradeoff, and write a design spec to `docs/superpowers/specs/YYYY-MM-DD-agent-collaboration-v1-design.md`.
