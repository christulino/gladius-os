# Flow OS — Feature Roadmap

> Evaluated against: 100-person IT company replacing Jira + ServiceNow.
> Last updated: 2026-03-12 (Session 10)
> Priority tiers reflect deployment readiness, not build order.
> See "Architecture-First Sequencing" at bottom for recommended build order.

---

## Tier 1: Blockers (Cannot Go Live Without)

| # | Feature | Jira/SNOW Equivalent | Flow OS Status | Notes |
|---|---------|---------------------|----------------|-------|
| 1 | **Authentication & authorization** | Login, SSO, RBAC | Hardcoded userId=1. access.js engine built but not wired. | Need at minimum email/password + JWT. SAML/OIDC for enterprise. |
| 2 | **Notifications** | Email, in-app, Slack | Nothing | People need to know when work arrives, is blocked, transitions. Without this the board is a passive display. |
| 3 | **Search** | JQL, full-text, filters | Title substring only | Need saved filters, field-based search, full-text. This is how people find work outside the board. |
| 4 | **Attachments / evidence** | File upload on tickets | Schema exists, no implementation | S3/MinIO storage designed but not built. Common need: screenshots, docs, logs. |
| 5 | **Audit trail UI** | Activity log on each ticket | History endpoint exists, no per-item UI | WorkItemDetail needs a visible history tab showing all state changes. |
| 6 | **Bulk operations** | Multi-select + transition/assign | Nothing | "Move these 8 items to Done" — daily need for any team. |
| 7 | **Form-based intake** | ServiceNow catalog forms, Jira create screens | Catalog request returns 501 | Service catalog concept is designed but request flow isn't wired. |

---

## Tier 2: Expected (Users Will Ask For Quickly)

| # | Feature | Jira/SNOW Equivalent | Notes |
|---|---------|---------------------|-------|
| 8 | **Custom fields per type** | Jira custom fields, SNOW variables | Field definitions exist in schema but aren't rendered on forms or cards. |
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

## Architecture-First Sequencing

> Priority is not "what users want first" but "what has the deepest architectural
> tentacles and will be most expensive to retrofit."

### Phase 1: Foundations (architectural load-bearing)
1. **Event system** — backbone for notifications, SLA alerts, webhooks, integrations, audit
2. **Auth & authorization wiring** — touches every endpoint, every query, every UI component
3. **Custom field rendering pipeline** — field schema → form → validation → storage → display → search

### Phase 2: Core Experience
4. Search & saved filters
5. Notifications (built on event system)
6. Form-based intake (built on custom fields)
7. Attachments / evidence storage
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
