# Page-Specific Patterns

## 16. Page-Specific Patterns

### Organizations
- Main content: org tree (expandable/collapsible)
- Clicking an org: opens drawer with org info (name, slug, flags) + that org's service catalog (its work item types listed)
- Tree shows: org name, child count, key behavioral flags as small indicators
- Admin actions (create org, edit) happen in the drawer

### Work Item Types
- **Non-admin view:** Search-oriented — search bar at top, results show matching types across orgs. Type a term like "jira" or "sizing" and see matching orgs + types.
- **Admin view:** Full table with create/edit in drawer. Search still available.
- Workflow should be visible in context — either a mini diagram in the drawer or a link to open the workflow in a second (stacked) drawer.

### Workflows
- Visual workflow editor as main content (existing pattern)
- Clicking a stage opens stage editor in the drawer (replaces current inline panel)
- Same drawer component as everything else
- **No WIP limits in the workflow editor** — WIP limits are org-level (set on the board column headers), not workflow-level. The workflow editor defines stages, transitions, exit criteria, and stage properties (like `has_queue`).
- Stage editor in drawer should show the `has_queue` toggle

### Reports
- Blank page with "Reports — coming soon" placeholder
- Listed in sidebar under REPORTS section
