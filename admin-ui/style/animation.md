# Animation & Loading States

## 14. Loading & Empty States

- **Loading:** `text-xs text-muted-foreground` centered in container, text "Loading..."
- **Error:** `text-xs text-destructive` centered in container
- **Empty table/list:** `text-xs text-muted-foreground` centered, contextual message ("No work items found")
- **Empty board column:** dashed border placeholder `border border-dashed border-border/50 rounded p-4 text-center`

No spinners. No skeletons. Just text. (Revisit if loading times become noticeable.)

---

## 17. Transitions & Animation

- Drawer open/close: `transition-all duration-200 ease-out`
- Hover color changes: `transition-colors duration-150`
- Button press: `active:scale-[0.98] transition-transform duration-75`
- Insights bar expand/collapse: `transition-all duration-200`
- No other animations. No bouncing, sliding cards, or entrance effects.
- Board card reordering: no animation (instant DOM update)
