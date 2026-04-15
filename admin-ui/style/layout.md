# Layout & Spacing

## 3. Layout

### Shell

No top bar. The logo/app name lives at the top of the sidebar. All vertical space goes to content.

```
h-screen flex overflow-hidden
├── Sidebar: w-44 bg-card border-r border-border flex flex-col
│   ├── Logo/app name area (top of sidebar)
│   └── Nav items
└── Main area: flex-1 flex
    ├── Main content: flex-1 (layout depends on page type)
    └── Drawer: w-[420px] bg-card border-l border-border (when open, pushes main)
```

### Page types

**Table page** (Organizations, WitTypes, Users, Roles):
```
Main: flex-1 overflow-auto p-5
└── Panel (rounded, bordered)
    ├── PanelHeader (title + actions)
    └── DataTable (sticky header, scrollable body)
```

**Canvas page** (Board, Workflow Editor):
```
Main: flex-1 overflow-hidden flex flex-col
├── Toolbar zone (see Board Layout for full structure)
└── Canvas: flex-1 overflow-auto (page manages its own scroll)
```

### Drawer integration
- The drawer is a **sibling of main content**, not an overlay
- When open: main content area shrinks, drawer takes `w-[420px]` on the right
- Transition: `transition-all duration-200`
- Navigating to a different sidebar page closes any open drawer
- The drawer has its own vertical scroll, independent of main content

---

## 12. Spacing

### Standard values

| Context | Value |
|---------|-------|
| Page padding | `p-4` |
| Panel/drawer header & footer | `px-4 py-2.5` |
| Drawer body | `p-4` |
| Form field gap | `gap-3` |
| Label to input | `gap-1` |
| Form section divider | `border-t border-border pt-3 mt-1` |
| Card internal padding | `p-2` |
| Card internal gap | `gap-0.5` |
| Table cell padding | `px-3 py-1.5` |
| Badge padding | `px-2 py-0.5` |
| Input padding | `px-2 py-1.5` |
| Toolbar padding | `px-4 py-2` |
| Button gap (row of buttons) | `gap-2` |

### Rules
- Use Tailwind spacing scale only — no arbitrary values for spacing
- `gap-3` is the standard vertical rhythm for form content (tight enough to reduce scrolling)
- `gap-2` is the standard horizontal gap for inline elements (buttons, badges, meta)
- `p-2` for compact cards, `p-4` for drawers and page-level
- **Minimize vertical space** — prefer tighter padding over generous whitespace. Scrolling is the enemy of scanning.
