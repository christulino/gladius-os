# Flow OS — Feature Roadmap

> Evaluated against: 100-person IT company replacing Jira + ServiceNow.
> Last updated: 2026-03-30 (Session 17)
> Priority tiers reflect deployment readiness, not build order.
> See "Architecture-First Sequencing" at bottom for recommended build order.

---

## Tier 1: Blockers (Cannot Go Live Without)

| # | Feature | Jira/SNOW Equivalent | Flow OS Status | Notes |
|---|---------|---------------------|----------------|-------|
| 1 | **Authentication & authorization** | Login, SSO, RBAC | ~~DONE~~ (Session 17). Server-side sessions, bcrypt, setup wizard, requireAuth. | RBAC/SSO still needed for enterprise. |
| 2 | **Notifications** | Email, in-app, Slack | ~~DONE~~ (Session 21). Four channels (in_app/email/webhook/agent), role×event matrix with user overrides, HMAC webhook signing, ownership challenge, rate limits, retention. Agent-as-first-class-subscriber reserved. | Follow-up: agent collaboration v1 (bidirectional protocol, tool-use policies). |
| 3 | **Search** | JQL, full-text, filters | Title substring only | Need saved filters, field-based search, full-text. This is how people find work outside the board. |
| 4 | **Attachments / evidence** | File upload on tickets | ~~DONE~~ (Session 25, attachments v1). `runtime.attachments` table; pluggable storage adapter (local fs default; 25 MB cap); 5 REST endpoints; search-index + audit-trail integration; UI in WorkItemDetail with file/camera/link upload. | Stage-evidence requirements (named slots, exit-criteria gating) and S3/MinIO adapter deferred to follow-up plans. |
| 5 | **Audit trail UI** | Activity log on each ticket | ~~DONE~~ (Session 22). Activity tab on WorkItemDetail showing all events from runtime.events with per-field edit expansion, cursor pagination. | v2 candidates: event-type filter, search-within-history, diff viewer, click-through to spawned children. |
| 6 | **Bulk operations** | Multi-select + transition/assign | ~~DONE~~ (Session 26). Multi-select on board → bulk transition/assign with per-item results (partial success reported). BulkActionBar component. | Follow-up: bulk label/CoS change, keyboard shortcuts for selection. |
| 7 | **Form-based intake** | ServiceNow catalog forms, Jira create screens | ~~DONE~~ (Session 17). Public intake forms at /intake/:slug, dynamic field rendering, tracking numbers. | Admin toggle per type in Org Center. |

---

## Tier 2: Expected (Users Will Ask For Quickly)

| # | Feature | Jira/SNOW Equivalent | Notes |
|---|---------|---------------------|-------|
| 8 | **Custom fields per type** | Jira custom fields, SNOW variables | ~~DONE~~ (Session 14-17). Full field engine: 10 types, lookup lists, constraints, JSONB storage, rendered on intake forms. |
| 9 | **SLA tracking & alerts** | ServiceNow SLA engine | `sla_hours` exists on service_classes. Need countdown display, breach alerts, escalation. |
| 10 | **Email-to-ticket** | Both platforms support this | External intake channel — creates work items from inbound email. |
| 11 | **Recurring / scheduled work** | SNOW scheduled tasks, Jira automation | Design mentions it. Ops teams need this (weekly deploys, monthly reviews). |
| 12 | **Dashboard / landing page** | Jira dashboard, SNOW homepage | Summary page exists but isn't a real dashboard. Need configurable widgets. |
| 13 | **Export / reporting** | CSV export, Jira gadgets | Reports page is good but no CSV/PDF export. No scheduled reports. |
| 14 | **Markdown in descriptions/comments** | Both support rich text | Currently plain text. At minimum need markdown rendering. |
| 15 | **Keyboard shortcuts** | Jira: j/k navigation, quick actions | Board power-user efficiency. |
| 16 | **Mobile / responsive** | Both have mobile apps | Current UI is desktop-only. At minimum needs responsive layout. |

---

## Tier 3: Differentiators (What Makes Flow OS Worth Switching To)

These are partly built or designed and represent the *reason* someone would leave Jira/SNOW.

| # | Feature | Status | Why It Matters |
|---|---------|--------|----------------|
| 17 | **Cross-org flow visibility** (Network Board) | Designed, not built | Killer feature. Neither Jira nor SNOW shows work flowing between teams well. |
| 18 | **Blocking chain analysis** | Neo4j designed for it | "What's blocking what?" across the whole system. ServiceNow has nothing like this. |
| 19 | **Flow metrics always-on** | Partially built (reports page) | CFDs, throughput, cycle time, aging — visible on every board without configuration. Jira requires plugins. |
| 20 | **WIP limit enforcement with visual signals** | Built (soft enforcement) | Jira doesn't do this natively. This is core Kanban. |
| 21 | **Waiting queue visibility** | Built (L3 columns) | Neither platform shows the ready-vs-active split. This is real flow insight. |
| 22 | **Derived class of service** | Built | Users don't have to learn Kanban vocabulary. Elegant. |
| 23 | **Stage-class normalization** | Built | Cross-workflow comparability without forcing identical workflows. Neither platform has this. |
| 24 | **AI-native context system** | ~~DONE~~ (Session 27). Item journal (typed context entries per work item), org context library, stage playbooks (YAML frontmatter + markdown body), playbook executor fires on stage entry via post-transition hook, MCP stdio server with 8 tools. Neither Jira nor SNOW has anything like this. | Every work item carries its own structured knowledge. AI agents read and write context as first-class operations. |

---

## Tier 4: Nice to Have (Competitive Parity / Polish)

| # | Feature | Notes |
|---|---------|-------|
| 24 | **Integrations** (Slack, GitHub, PagerDuty, CI/CD) | Webhooks + api_call actions are the foundation. Need concrete connectors. |
| 25 | **Approval workflows** | SNOW's strength. Exit criteria could support this but needs UI for approval chains. |
| 26 | **Knowledge base / wiki** | SNOW has KB articles. Could link to external or build lightweight. |
| 27 | **Change management** (CAB, change windows) | SNOW ITSM. Could model as workflow template with approval exit criteria. |
| 28 | **Asset / CMDB integration** | SNOW's other pillar. Out of scope unless targeting ITSM replacement specifically. |
| 29 | **Time tracking** | Jira has it. Flow OS philosophy says "measure the work, not the worker" — but clients expect it. |
| 30 | **Sprints / iterations** | Jira's bread and butter. Flow OS intentionally avoids this (Kanban over Scrum), but some teams will want time-boxed views. |
| 31 | **Permissions per field** | SNOW field-level ACLs. Probably overkill but enterprise customers ask. |
| 32 | **Multi-language / i18n** | Enterprise requirement for global companies. |
| 33 | **API tokens / webhook management UI** | Self-service integration config. |
| 34 | **Dark mode** | Users will ask. Design system currently forbids it. |

---

## UI/UX Review — Remaining Action Items

Expert review conducted Session 17. Six immediate fixes were implemented (sidebar icons,
theme tokens, blocked borders, sidebar layout, Lucide SVG type icons, skeleton loading).
These items remain actionable:

### Architectural UX Changes

| Item | Effort | Description |
|------|--------|-------------|
| **Simplify nav groups** | Medium | Current 5-group sidebar (Board, Catalog, Configure, Admin, Dev Tools) → 3 groups: "Work" (Board), "Design" (Orgs, Types, Classes, Workflows, Lists), "Admin" (Users, Roles). Type Classes and Work Item Types are conceptually linked but currently in separate sections. |
| **Dev Tools behind env flag** | Small | Raw Tables, DB Console, Log Viewer, Simulation confuse non-developer users. Add `FLOWOS_DEV_TOOLS=true` env var. Default hidden in production, visible in development. |
| **Promote Org Center to full layout** | Large | The 5-pill Org Center (Settings, Catalog, Policies, Members, Workflows) is cramped in a drawer. Consider full page with left tree + right content (like VS Code explorer). Drawer pattern works for quick edits but deep config deserves more space. |

### Workflow & Interaction Improvements

| Item | Effort | Description |
|------|--------|-------------|
| **Streamline "New Work Item" flow** | Medium | Currently: button → Service Library drawer → pick type → Create drawer (2 clicks, 2 transitions). For power users: default to most recently used type (localStorage), open create form directly. Keep Service Library for deliberate type selection. |
| **First-use board experience** | Small | Board auto-scrolls right on load (correct Kanban, confusing for first-timers who think board is empty). Default left-aligned for boards with <8 columns, or show first-use hint. |
| **Keyboard shortcuts** | Medium | No keyboard navigation yet. Priority: `n` new work item, `/` search, `←`/`→` board scroll, `Esc` close drawers, `?` show shortcut help. |
| **Empty state improvements** | Small | When board/org/section has no data, show guidance + action buttons instead of just "No items." e.g. "No work items yet — create one or run the simulation." |

---

## Architecture-First Sequencing

> Priority is not "what users want first" but "what has the deepest architectural
> tentacles and will be most expensive to retrofit."

### Phase 1: Foundations (architectural load-bearing)
1. ~~**Event system**~~ — DONE (Session 20). `runtime.events` bus, per-subscriber cursors with PG advisory lock, `work_item_edits` field-level audit, 13 event types across all mutation paths. Neo4j sync + audit log subscribers live.
2. ~~**Auth & authorization wiring**~~ — DONE (Session 17). Sessions, requireAuth, setup wizard.
3. ~~**Custom field rendering pipeline**~~ — DONE (Sessions 14-17). Field engine + intake form rendering.

### Phase 2: Core Experience
4. Search & saved filters
5. ~~Notifications (built on event system)~~ — DONE (Session 21). Four channels, rate-limited delivery worker, ownership challenge, agent-channel reserved.
6. ~~Form-based intake (built on custom fields)~~ — DONE (Session 17). Public intake forms.
7. ~~Attachments / evidence storage~~ — DONE (Session 25). Generic file/link attachments shipped; stage-evidence + S3 adapter deferred.
8. Audit trail UI per work item

### Phase 3: Differentiation
9. Neo4j sync pipeline (draining the queue)
10. Blocking chain analysis
11. Network Board / cross-org visibility
12. SLA countdown & breach alerting (built on event system)
13. Flow metrics on every board (CFD, aging, throughput)

### Phase 4: Scale & Polish
14. Bulk operations
15. Integrations framework (Slack, GitHub, webhooks)
16. Export / scheduled reports
17. Recurring work
18. Dashboard widgets
19. Keyboard shortcuts
20. Mobile / responsive
