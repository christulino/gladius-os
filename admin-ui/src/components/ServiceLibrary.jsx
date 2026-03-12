import { useState, useMemo } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

export function ServiceLibrary({ open, onOpenChange, types = [], onSelect, onManageTypes }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return types
    return types.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.class_name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    )
  }, [types, search])

  // Group by owning org
  const grouped = useMemo(() => {
    const groups = {}
    for (const t of filtered) {
      const key = t.owner_org_name || 'System'
      if (!groups[key]) groups[key] = []
      groups[key].push(t)
    }
    return groups
  }, [filtered])

  function handleSelect(type) {
    onSelect(type)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
          <SheetTitle className="text-sm font-semibold">Service Catalog</SheetTitle>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or description..."
            className="mt-2 w-full bg-background border border-border rounded text-xs text-foreground px-2 py-1.5 focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
            autoFocus
          />
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {Object.keys(grouped).length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-xs text-muted-foreground">No types found</span>
            </div>
          ) : (
            Object.entries(grouped).map(([orgName, items]) => (
              <div key={orgName}>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-1.5 border-b border-border/50 bg-card/50 sticky top-0">
                  {orgName}
                </div>
                {items.map(type => (
                  <button
                    key={type.id}
                    onClick={() => handleSelect(type)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-black/[0.03] border-b border-border/30 transition-colors"
                    title={type.description || type.class_name}
                  >
                    <span className="flex-shrink-0">
                      {type.icon ? (
                        <span className="text-base">{type.icon}</span>
                      ) : (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: type.color || '#6b7280' }}
                        />
                      )}
                    </span>
                    <span className="text-xs font-medium text-foreground truncate">{type.name}</span>
                    <span className="text-xs text-muted-foreground/50 ml-auto flex-shrink-0">{type.class_name}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              onOpenChange(false)
              onManageTypes()
            }}
          >
            + Add new work item type
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
