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

  // Group by class_name
  const grouped = useMemo(() => {
    const groups = {}
    for (const t of filtered) {
      if (!groups[t.class_name]) groups[t.class_name] = []
      groups[t.class_name].push(t)
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
          <SheetTitle className="font-mono text-sm">New Work Item</SheetTitle>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search types..."
            className="mt-2 w-full bg-background border border-border rounded text-xs font-mono text-foreground px-2.5 py-2 focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
            autoFocus
          />
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {Object.keys(grouped).length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="font-mono text-xs text-muted-foreground">No types found</span>
            </div>
          ) : (
            Object.entries(grouped).map(([className, items]) => (
              <div key={className}>
                <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest px-4 py-2 border-b border-border/50 bg-card/50 sticky top-0">
                  {className}
                </div>
                {items.map(type => (
                  <button
                    key={type.id}
                    onClick={() => handleSelect(type)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.03] border-b border-border/30 transition-colors"
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {type.icon ? (
                        <span className="text-base">{type.icon}</span>
                      ) : (
                        <span
                          className="inline-block w-3 h-3 rounded-full mt-0.5"
                          style={{ background: type.color || '#6b7280' }}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-foreground">{type.name}</span>
                      {type.description && (
                        <span className="font-mono text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {type.description}
                        </span>
                      )}
                    </div>
                    {type.color && !type.icon && (
                      <span
                        className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5"
                        style={{ background: type.color }}
                      />
                    )}
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
            className="w-full font-mono text-xs"
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
