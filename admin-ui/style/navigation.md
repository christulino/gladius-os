# Navigation

## 6. Navigation

### Sidebar structure

The sidebar is the only navigation. No top bar. Logo/app identity at the top.

```
┌──────────────────────┐
│  ◈ Gladius           │  Logo + app name, compact
│                      │
│  Board               │  ← primary, always first
│                      │
│  CATALOG             │  section header
│    Organizations     │  tree view (main content)
│    Work Item Types   │  search-oriented
│                      │
│  CONFIGURE           │  section header
│    Workflows         │  visual editor
│    Service Classes   │
│                      │
│  ADMIN               │  section header (admin-only)
│    Users             │
│    Roles             │
│                      │
│  REPORTS             │  section header
│    (blank for now)   │
│                      │
│  ─────────────────── │  separator (dev only, hidden in prod)
│  DEV TOOLS           │
│    Raw Tables        │
│    DB Console        │
│    Log Viewer        │
└──────────────────────┘
```

### Sidebar styling
- App name: `text-sm font-semibold text-foreground px-3 py-3`
- Section headers: `text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 pt-4 pb-1`
- Nav items: `text-xs px-3 py-1.5 rounded-sm cursor-pointer`
- Active: `text-primary bg-primary/10 font-medium`
- Inactive: `text-muted-foreground`
- Hover: `hover:bg-black/[0.04]`
- Dot indicator for active: `w-1.5 h-1.5 rounded-full bg-primary`
- Section headers are visible, not just implied by spacing

### Navigation behavior
- Clicking a sidebar item navigates to that page and closes any open drawer
- Clicking an entity within a page (table row, tree node, search result) opens its detail in the drawer
- Cross-entity links inside a drawer (e.g., a type's workflow) may open a second drawer (max depth 2)

### Page-specific navigation patterns

**Organizations page:** Main content shows an org tree. Clicking an org opens a drawer with org info + that org's service catalog (its work item types). Expandable/collapsible tree nodes.

**Work Item Types page:** For non-admin users, this is a search screen — type a term like "jira" or "sizing" and see matching orgs and work item types. For admins, also shows the full table with create/edit in drawer.

**Workflows page:** Visual workflow editor in main content. Clicking a stage opens the stage editor in the drawer. Work item type edit drawers should show a mini workflow diagram or a link to open the workflow in a second drawer.
