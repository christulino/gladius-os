# Surfaces

## 4. Surfaces

| Surface | Classes | Where |
|---------|---------|-------|
| Page background | `bg-background` | Behind everything |
| Panel | `bg-card border border-border rounded-md` | Table pages, config sections |
| Card (org) | `bg-card border border-border rounded-sm` | Board cards belonging to an org (sharp corners) |
| Card (personal) | `bg-card border border-border rounded-lg` | Board cards with no org (personal items — rounded corners) |
| Drawer | `bg-card border-l border-border` | Right-side detail/edit |
| Toolbar | `bg-card border-b border-border` | Board toolbar, panel headers |
| Dropdown | `bg-card border border-border rounded shadow-md` | Menus, pickers |
| Inset section | `bg-background rounded border border-border` | Nested sections inside drawer |

**Rules:**
- Cards and panels always use `bg-card`
- Inset/nested content inside a `bg-card` surface uses `bg-background` to create depth
- Only one level of nesting — never `bg-card` inside `bg-card` without visual separation
- `shadow-md` only on floating elements (dropdowns). No shadows on panels, cards, or drawers.
