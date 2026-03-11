import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { formatElapsed } from '@/lib/utils'
import { WorkItemCard } from '@/components/WorkItemCard'
import { ServiceLibrary } from '@/components/ServiceLibrary'
import { FormDrawer } from '@/components/FormDrawer'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

// ─── Multiselect Org Picker ───────────────────────────────────────────────────

function OrgMultiSelect({ orgs, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(id) {
    if (selected.includes(id)) {
      onChange(selected.filter(x => x !== id))
    } else {
      onChange([...selected, id])
    }
  }

  const label = selected.length === 0
    ? 'Select orgs...'
    : selected.length === orgs.length
      ? 'All orgs'
      : orgs.filter(o => selected.includes(o.id)).map(o => o.name).join(', ')

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 bg-card border border-border rounded px-2.5 py-1.5 text-xs font-mono text-foreground hover:border-primary/50 transition-colors min-w-[160px] max-w-[280px]"
      >
        <span className="truncate flex-1 text-left">{label}</span>
        <span className="text-muted-foreground flex-shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded shadow-lg min-w-[200px] py-1">
          {orgs.map(org => (
            <label
              key={org.id}
              className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.includes(org.id)}
                onChange={() => toggle(org.id)}
                className="accent-primary"
              />
              <span className="text-xs text-foreground">{org.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground ml-auto">{org.slug}</span>
            </label>
          ))}
          <div className="border-t border-border mt-1 pt-1 px-3 pb-1 flex gap-2">
            <button
              onClick={() => onChange(orgs.map(o => o.id))}
              className="font-mono text-[10px] text-primary hover:underline"
            >all</button>
            <button
              onClick={() => onChange([])}
              className="font-mono text-[10px] text-muted-foreground hover:underline"
            >none</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Work Item Detail Sheet ───────────────────────────────────────────────────

function ItemDetail({ item, open, onOpenChange }) {
  const [elapsed, setElapsed] = useState(() =>
    item ? formatElapsed(item.entered_current_stage_at) : ''
  )

  useEffect(() => {
    if (!item) return
    setElapsed(formatElapsed(item.entered_current_stage_at))
    const id = setInterval(() => {
      setElapsed(formatElapsed(item.entered_current_stage_at))
    }, 60_000)
    return () => clearInterval(id)
  }, [item])

  if (!item) return null
  const accentColor = item.service_class_color || 'hsl(var(--border))'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle className="font-mono text-sm leading-snug">{item.title}</SheetTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <span
              className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border"
              style={{ borderColor: item.work_item_type_color || 'hsl(var(--border))', color: item.work_item_type_color || 'hsl(var(--muted-foreground))' }}
            >
              {item.work_item_type_icon && `${item.work_item_type_icon} `}{item.work_item_type_name}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-border text-muted-foreground">
              {item.current_stage_name}
            </span>
            {item.service_class_name && (
              <span
                className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm"
                style={{ background: `${accentColor}22`, color: accentColor }}
              >
                {item.service_class_name}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Time in stage</span>
            <span className="font-mono text-2xl tabular-nums">{elapsed}</span>
            <span className="font-mono text-[10px] text-muted-foreground/50">DDD:HH:MM</span>
          </div>
          {item.description && (
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Description</span>
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{item.description}</p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">URI</span>
            <span className="font-mono text-[10px] text-muted-foreground/60 break-all">{item.uri}</span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── WIP Indicator ────────────────────────────────────────────────────────────

function WipIndicator({ count, limit }) {
  if (!limit) return <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
  const over = count > limit
  return (
    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
      over ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-muted/60 text-muted-foreground'
    }`}>
      {count}/{limit}
    </span>
  )
}

// ─── Board ───────────────────────────────────────────────────────────────────

export default function Board({ setTab }) {
  const [selectedOrgIds, setSelectedOrgIds] = useState(() => {
    try {
      const stored = localStorage.getItem('board_org_ids')
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })
  const [selectedItem, setSelectedItem] = useState(null)
  const [detailOpen,   setDetailOpen]   = useState(false)
  const [libraryOpen,  setLibraryOpen]  = useState(false)
  const [selectedType, setSelectedType] = useState(null)
  const [createOpen,   setCreateOpen]   = useState(false)

  const { data: orgsData } = useApi(() => api.organizations(), [])

  // Auto-select first org if none stored
  useEffect(() => {
    if (selectedOrgIds.length || !orgsData?.rows?.length) return
    const ids = [orgsData.rows[0].id]
    setSelectedOrgIds(ids)
    localStorage.setItem('board_org_ids', JSON.stringify(ids))
  }, [orgsData, selectedOrgIds.length])

  function handleOrgChange(ids) {
    setSelectedOrgIds(ids)
    localStorage.setItem('board_org_ids', JSON.stringify(ids))
  }

  // Use first selected org as primary (for workflow resolution)
  const primaryOrgId = selectedOrgIds[0] ?? null

  // Board data keyed by org
  const { data: boardData, loading: boardLoading, error: boardError, reload: reloadBoard } = useApi(
    () => primaryOrgId ? api.board(primaryOrgId) : Promise.resolve(null),
    [primaryOrgId]
  )

  // Fetch items for additional orgs (all except primary)
  const [extraItems, setExtraItems] = useState([])
  useEffect(() => {
    if (!boardData?.workflow_id || selectedOrgIds.length <= 1) {
      setExtraItems([])
      return
    }
    const additionalOrgs = selectedOrgIds.slice(1)
    Promise.all(additionalOrgs.map(id => api.board(id))).then(results => {
      const all = results.flatMap(r => r?.items ?? [])
      setExtraItems(all)
    }).catch(() => {})
  }, [boardData?.workflow_id, selectedOrgIds])

  // Service library uses primary org
  const { data: libraryData } = useApi(
    () => primaryOrgId ? api.serviceLibrary(primaryOrgId) : Promise.resolve({ rows: [] }),
    [primaryOrgId]
  )

  // Service classes for create form
  const { data: scData } = useApi(
    () => primaryOrgId ? api.serviceClasses(primaryOrgId) : Promise.resolve({ rows: [] }),
    [primaryOrgId]
  )

  const stages = boardData?.stages ?? []
  const allItems = [...(boardData?.items ?? []), ...extraItems]

  // Group items by stage
  const itemsByStage = {}
  for (const item of allItems) {
    if (!itemsByStage[item.current_stage_id]) itemsByStage[item.current_stage_id] = []
    itemsByStage[item.current_stage_id].push(item)
  }

  const serviceClassOptions = (scData?.rows ?? []).map(sc => ({ label: sc.name, value: String(sc.id) }))

  const createFields = [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'What needs to happen?' },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional context...' },
    ...(serviceClassOptions.length > 0 ? [{ key: 'service_class_id', label: 'Service Class', type: 'select', options: serviceClassOptions }] : []),
  ]

  // Create work item in the org where the type lives (or primary org)
  function handleCreateWorkItem(values) {
    return api.createWorkItem({
      title:             values.title,
      description:       values.description || undefined,
      work_item_type_id: selectedType?.id,
      owner_org_id:      primaryOrgId,
      service_class_id:  values.service_class_id || undefined,
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0 bg-card">
        {orgsData?.rows?.length > 0 && (
          <OrgMultiSelect
            orgs={orgsData.rows}
            selected={selectedOrgIds}
            onChange={handleOrgChange}
          />
        )}

        {boardData?.workflow_name && (
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            {boardData.workflow_name}
          </span>
        )}

        {!boardLoading && boardData && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {allItems.length} active
          </span>
        )}

        <div className="ml-auto">
          <Button
            size="sm"
            className="font-mono text-xs"
            onClick={() => setLibraryOpen(true)}
            disabled={!primaryOrgId}
          >
            + New Work Item
          </Button>
        </div>
      </div>

      {/* Board columns */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        {boardLoading && (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-xs text-muted-foreground">Loading...</span>
          </div>
        )}
        {boardError && (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-xs text-destructive">{boardError}</span>
          </div>
        )}
        {!boardLoading && !boardError && selectedOrgIds.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-xs text-muted-foreground">Select an org to view the board.</span>
          </div>
        )}
        {!boardLoading && !boardError && stages.length === 0 && selectedOrgIds.length > 0 && (
          <div className="flex items-center justify-center h-full">
            <span className="font-mono text-xs text-muted-foreground">No workflow configured for this org.</span>
          </div>
        )}

        {!boardLoading && !boardError && stages.length > 0 && (
          <div className="flex flex-row gap-3 h-full px-5 py-4 w-max">
            {stages.map(stage => {
              const stageItems = itemsByStage[stage.id] ?? []
              const wipOver    = stage.wip_limit && stageItems.length > stage.wip_limit

              return (
                <div key={stage.id} className="flex flex-col w-[240px] flex-shrink-0 h-full">
                  {/* Column header */}
                  <div className={`flex items-center gap-2 px-2 pb-2 mb-2 border-b flex-shrink-0 ${
                    wipOver ? 'border-destructive/40' : 'border-border'
                  }`}>
                    <span className="font-mono text-[11px] font-medium text-foreground truncate flex-1">
                      {stage.name}
                    </span>
                    <WipIndicator count={stageItems.length} limit={stage.wip_limit} />
                  </div>

                  {/* Cards */}
                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
                    {stageItems.length === 0 ? (
                      <div className="flex items-center justify-center h-14 border border-dashed border-border/50 rounded">
                        <span className="font-mono text-[10px] text-muted-foreground/40">—</span>
                      </div>
                    ) : (
                      stageItems.map(item => (
                        <WorkItemCard key={item.id} item={item} onClick={i => { setSelectedItem(i); setDetailOpen(true) }} />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Service Library */}
      <ServiceLibrary
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        types={libraryData?.rows ?? []}
        onSelect={type => { setSelectedType(type); setCreateOpen(true) }}
        onManageTypes={() => setTab?.('wittypes')}
      />

      {/* Create Work Item */}
      <FormDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={selectedType ? `New ${selectedType.name}` : 'New Work Item'}
        fields={createFields}
        onSubmit={handleCreateWorkItem}
        onSaved={() => reloadBoard()}
      />

      {/* Item Detail */}
      <ItemDetail item={selectedItem} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  )
}
