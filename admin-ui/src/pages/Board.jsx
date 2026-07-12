import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { WorkItemCard } from '@/components/WorkItemCard'
import { WorkItemDetail } from '@/components/WorkItemDetail'
import { ServiceLibrary } from '@/components/ServiceLibrary'
import { FormDrawer } from '@/components/FormDrawer'
import { OrgSelector } from '@/components/OrgSelector'
import { BulkActionBar } from '@/components/BulkActionBar'
import { Button } from '@/components/ui/button'
import { Zap } from 'lucide-react'

const COL_WIDTH = 220
const COL_GAP = 1 // px gap — thin visible column dividers

// ─── Semantic Stage Class Colors ────────────────────────────────────────────
const STAGE_CLASS_COLORS = {
  'intake':      { bg: '#DBEAFE', text: '#1E40AF' },  // blue
  'triage':      { bg: '#FEF3C7', text: '#92400E' },  // amber
  'queued':      { bg: '#EDE9FE', text: '#5B21B6' },  // violet
  'in-progress': { bg: '#D1FAE5', text: '#065F46' },  // green
  'blocked':     { bg: '#FEE2E2', text: '#991B1B' },  // red
  'review':      { bg: '#CCFBF1', text: '#115E59' },  // teal
  'approved':    { bg: '#E0E7FF', text: '#3730A3' },  // indigo
  'delivery':    { bg: '#E0E7FF', text: '#3730A3' },  // indigo
  'done':        { bg: '#ECFCCB', text: '#3F6212' },  // lime
  'cancelled':   { bg: '#F1F5F9', text: '#475569' },  // slate
}

// ─── WIP Indicator ────────────────────────────────────────────────────────────

function WipIndicator({ count, limit, onEdit, editable }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (editing) {
    return (
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          const val = parseInt(draft)
          onEdit?.(val > 0 ? val : 0)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.target.blur() }
          if (e.key === 'Escape') setEditing(false)
        }}
        className="w-12 text-xs text-center bg-background border border-primary rounded px-1 py-0.5 focus:outline-none"
        autoFocus
        placeholder="none"
      />
    )
  }

  if (!limit) {
    return (
      <span
        className={`text-xs text-muted-foreground ${editable ? 'cursor-pointer hover:text-primary' : ''}`}
        onClick={() => { if (editable) { setDraft(''); setEditing(true) } }}
        title={editable ? 'Click to set WIP limit' : undefined}
      >
        {count} · <span className="italic">unlimited</span>
      </span>
    )
  }

  const over = count > limit
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded border ${
        over ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-muted/60 text-muted-foreground'
      } ${editable ? 'cursor-pointer' : ''}`}
      onClick={() => { if (editable) { setDraft(String(limit)); setEditing(true) } }}
      title={editable ? 'Click to edit WIP limit (0 or blank to clear)' : undefined}
    >
      {count}/{limit}
    </span>
  )
}

// ─── Board ───────────────────────────────────────────────────────────────────

export default function Board({ setTab }) {
  const [selectedOrgId, setSelectedOrgId] = useState(() => {
    try {
      const oldStored = localStorage.getItem('board_org_ids')
      if (oldStored) {
        localStorage.removeItem('board_org_ids')
        const arr = JSON.parse(oldStored)
        if (Array.isArray(arr) && arr.length > 0) {
          localStorage.setItem('board_org_id', String(arr[0]))
          return arr[0]
        }
      }
      const stored = localStorage.getItem('board_org_id')
      return stored ? parseInt(stored) : null
    } catch { return null }
  })
  const [detailItemId, setDetailItemId]   = useState(null)
  const [detailOpen,   setDetailOpen]     = useState(false)
  const [libraryOpen,  setLibraryOpen]    = useState(false)
  const [selectedType, setSelectedType]   = useState(null)
  const [createOpen,   setCreateOpen]     = useState(false)
  const [classFilter,  setClassFilter]    = useState('')
  const [myItemsOnly,  setMyItemsOnly]   = useState(false)
  const [scrollToItemId, setScrollToItemId] = useState(null)
  const [selectMode,     setSelectMode]    = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState(new Set())

  const { data: orgsData } = useApi(() => api.organizations(), [])

  useEffect(() => {
    if (selectedOrgId || !orgsData?.rows?.length) return
    const nonSystem = orgsData.rows.find(o => o.slug !== 'system')
    if (nonSystem) {
      setSelectedOrgId(nonSystem.id)
      localStorage.setItem('board_org_id', String(nonSystem.id))
    }
  }, [orgsData, selectedOrgId])

  function handleOrgChange(id) {
    setSelectedOrgId(id)
    localStorage.setItem('board_org_id', String(id))
  }

  const { data: boardData, loading: boardLoading, error: boardError, reload: reloadBoard } = useApi(
    () => selectedOrgId ? api.board(selectedOrgId) : Promise.resolve(null),
    [selectedOrgId]
  )

  const { data: libraryData } = useApi(
    () => selectedOrgId ? api.serviceLibrary(selectedOrgId) : Promise.resolve({ rows: [] }),
    [selectedOrgId]
  )
  const { data: usersData } = useApi(() => api.users(), [])

  const columns = boardData?.columns ?? []
  const allItems = boardData?.items ?? []
  const wipLimits = boardData?.wip_limits ?? {}


  // Filter by WIT type name and "My Items"
  const filteredItems = useMemo(() => {
    let items = allItems
    if (classFilter) items = items.filter(item => item.work_item_type_name === classFilter)
    if (myItemsOnly) items = items.filter(item => item.owner_user_id != null)
    return items
  }, [allItems, classFilter, myItemsOnly])

  // When a type filter is active, determine which workflow(s) to show
  const activeWorkflowIds = useMemo(() => {
    if (!classFilter) return null // null = show all
    const ids = new Set(filteredItems.map(i => i.workflow_id).filter(Boolean))
    return ids.size > 0 ? ids : null
  }, [classFilter, filteredItems])

  // Flatten columns for rendering: array of stage objects, each with parent class info
  // When filtering by type, only show columns belonging to that type's workflow
  const flatColumns = useMemo(() => {
    const flat = []
    for (const col of columns) {
      for (const stage of col.stages) {
        // If filtering by workflow, skip columns that don't belong to it
        if (activeWorkflowIds && stage.workflow_ids) {
          const match = stage.workflow_ids.some(wid => activeWorkflowIds.has(wid))
          if (!match) continue
        }
        flat.push({
          ...stage,
          stage_class: col.stage_class,
          class_label: col.class_label,
          showClassHeader: true,
          classStageCount: col.stages.length,
        })
      }
    }
    return flat
  }, [columns, activeWorkflowIds])

  // Flat unique-name stage list for BulkActionBar (use first stage_id per merged column)
  const allStages = useMemo(() => {
    const seen = new Set()
    return flatColumns.flatMap(col => {
      const id = col.stage_ids?.[0]
      if (!id || seen.has(col.name)) return []
      seen.add(col.name)
      return [{ id, name: col.name }]
    })
  }, [flatColumns])

  // Build a lookup: stage_id → column key
  const stageIdToKey = useMemo(() => {
    const map = {}
    for (const col of flatColumns) {
      for (const id of col.stage_ids) {
        map[id] = col.key
      }
    }
    return map
  }, [flatColumns])

  // Item grid: grid[columnKey] = [items] — one flat stack per stage column
  const itemGrid = useMemo(() => {
    const grid = {}
    for (const col of flatColumns) {
      grid[col.key] = []
    }
    for (const item of filteredItems) {
      const colKey = stageIdToKey[item.current_stage_id]
      if (!colKey || !grid[colKey]) continue
      grid[colKey].push(item)
    }
    return grid
  }, [flatColumns, filteredItems, stageIdToKey])

  // Count items per column
  function columnItemCount(colKey) {
    return itemGrid[colKey]?.length ?? 0
  }

  const createFields = [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'What needs to happen?' },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional context...' },
    { key: 'due_date', label: 'Due Date', type: 'date', hint: 'Items with a due date are treated as fixed-date priority.' },
    { key: 'is_expedited', label: 'Expedite', type: 'boolean', hint: 'Drop everything — this needs immediate attention.' },
    {
      key: 'work_nature', label: 'Work Nature', type: 'select',
      options: [{ label: 'Delivery', value: 'delivery' }, { label: 'Improvement', value: 'improvement' }],
      defaultValue: 'delivery',
      hint: 'Improvement work is pulled when there is capacity.',
    },
  ]

  function handleCreateWorkItem(values) {
    return api.createWorkItem({
      title:             values.title,
      description:       values.description || undefined,
      work_item_type_id: selectedType?.id,
      owner_org_id:      selectedType?.owner_org_id || selectedOrgId,
      due_date:          values.due_date || undefined,
      is_expedited:      values.is_expedited || false,
      work_nature:       values.work_nature || 'delivery',
    })
  }

  async function handleWipEdit(stageName, newLimit) {
    if (!selectedOrgId) return
    try {
      await api.setOrgWipLimit({ org_id: selectedOrgId, stage_name: stageName, wip_limit: newLimit })
      reloadBoard()
    } catch (err) {
      console.error('Failed to set WIP limit:', err)
    }
  }

  function toggleSelectMode() {
    setSelectMode(v => !v)
    setSelectedItemIds(new Set())
  }

  function handleCardClick(item) {
    if (selectMode) {
      setSelectedItemIds(prev => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
    } else {
      setDetailItemId(item.id)
      setDetailOpen(true)
    }
  }

  function handleBulkDone() {
    setSelectedItemIds(new Set())
    setSelectMode(false)
    reloadBoard()
  }

  const witTypeNames = useMemo(() => {
    const names = new Set(allItems.map(i => i.work_item_type_name).filter(Boolean))
    return [...names].sort()
  }, [allItems])

  // Compute L1 header spans: which columns start a new class group, and how wide
  const classHeaderSpans = useMemo(() => {
    const spans = []
    let i = 0
    while (i < flatColumns.length) {
      const col = flatColumns[i]
      // Count how many consecutive columns share this stage_class
      let count = 0
      let totalWidth = 0
      while (i + count < flatColumns.length && flatColumns[i + count].stage_class === col.stage_class) {
        totalWidth += COL_WIDTH
        count++
      }
      spans.push({ stage_class: col.stage_class, label: col.class_label, colCount: count, width: totalWidth, startIdx: i })
      i += count
    }
    return spans
  }, [flatColumns])

  const hasColumns = flatColumns.length > 0

  // ─── Drag-to-pan ──────────────────────────────────────────────────────────
  const scrollRef = useRef(null)
  const dragState = useRef({ active: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0 })

  const handleDragStart = useCallback((e) => {
    // Only left mouse button, and only on empty board space (not cards/buttons/inputs)
    if (e.button !== 0) return
    const tag = e.target.tagName.toLowerCase()
    if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'a') return
    if (e.target.closest('[data-item-id], button, input, select, a, [role="button"]')) return

    const el = scrollRef.current
    if (!el) return
    dragState.current = { active: true, startX: e.clientX, startY: e.clientY, scrollX: el.scrollLeft, scrollY: el.scrollTop }
    el.style.cursor = 'grabbing'
    el.style.userSelect = 'none'
    e.preventDefault()
  }, [])

  const handleDragMove = useCallback((e) => {
    if (!dragState.current.active) return
    const el = scrollRef.current
    if (!el) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    el.scrollLeft = dragState.current.scrollX - dx
    el.scrollTop = dragState.current.scrollY - dy
  }, [])

  const handleDragEnd = useCallback(() => {
    if (!dragState.current.active) return
    dragState.current.active = false
    const el = scrollRef.current
    if (el) {
      el.style.cursor = ''
      el.style.userSelect = ''
    }
  }, [])

  useEffect(() => {
    document.addEventListener('mousemove', handleDragMove)
    document.addEventListener('mouseup', handleDragEnd)
    return () => {
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('mouseup', handleDragEnd)
    }
  }, [handleDragMove, handleDragEnd])

  // ─── Scroll indicators + auto-scroll-right ──────────────────────────────
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollIndicators = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 8)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8)
  }, [])

  // Auto-scroll to the right on board load (walk right-to-left)
  useEffect(() => {
    if (!hasColumns) return
    const el = scrollRef.current
    if (!el) return
    // Wait a frame for layout to settle
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth - el.clientWidth
      updateScrollIndicators()
    })
  }, [hasColumns, flatColumns.length, updateScrollIndicators])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollIndicators, { passive: true })
    window.addEventListener('resize', updateScrollIndicators)
    updateScrollIndicators()
    return () => {
      el.removeEventListener('scroll', updateScrollIndicators)
      window.removeEventListener('resize', updateScrollIndicators)
    }
  }, [updateScrollIndicators, hasColumns])

  // After transition: scroll to the card that just moved
  useEffect(() => {
    if (!scrollToItemId || !scrollRef.current) return
    requestAnimationFrame(() => {
      const card = scrollRef.current?.querySelector(`[data-item-id="${scrollToItemId}"]`)
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      }
      setScrollToItemId(null)
    })
  }, [scrollToItemId, boardData])

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-shrink-0 bg-card">
        {orgsData?.rows?.length > 0 && (
          <OrgSelector
            orgs={orgsData.rows}
            selectedId={selectedOrgId}
            onChange={handleOrgChange}
          />
        )}

        {witTypeNames.length > 1 && (
          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="bg-card border border-border rounded px-2 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors"
          >
            <option value="">All types</option>
            {witTypeNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}

        <button
          onClick={() => setMyItemsOnly(v => !v)}
          className={`px-2 py-1.5 text-xs rounded border transition-colors ${
            myItemsOnly
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-card border-border text-muted-foreground hover:border-primary/50'
          }`}
        >
          My Items
        </button>

        <button
          onClick={toggleSelectMode}
          className={`px-2 py-1.5 text-xs rounded border transition-colors ${
            selectMode
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-card border-border text-muted-foreground hover:border-primary/50'
          }`}
        >
          {selectMode ? `Select (${selectedItemIds.size})` : 'Select'}
        </button>

        {!boardLoading && boardData && (
          <span className="text-xs text-muted-foreground">
            {filteredItems.length} active
          </span>
        )}

        <div className="ml-auto">
          <Button
            size="sm"
            onClick={() => setLibraryOpen(true)}
            disabled={!selectedOrgId}
          >
            + New Work Item
          </Button>
        </div>
      </div>

      {/* Board area */}
      <div className="flex-1 min-h-0 relative">
      <div className="absolute inset-0 overflow-auto bg-background" ref={scrollRef} onMouseDown={handleDragStart} style={{ cursor: 'grab' }}>
        {boardLoading && (
          <div className="p-4">
            {/* Skeleton column headers */}
            <div className="flex gap-px mb-3">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex-shrink-0" style={{ width: 220 }}>
                  <div className="h-5 bg-muted/40 rounded animate-pulse mb-2" />
                  <div className="h-8 bg-card border border-border rounded animate-pulse" />
                </div>
              ))}
            </div>
            {/* Skeleton card rows */}
            {[1,2,3].map(row => (
              <div key={row} className="flex gap-px mb-2">
                <div className="flex-shrink-0 w-16" />
                {[1,2,3,4,5].map(col => (
                  <div key={col} className="flex-shrink-0 p-1" style={{ width: 220 }}>
                    {Array.from({ length: Math.max(1, 3 - row) }).map((_, ci) => (
                      <div key={ci} className="h-12 bg-card border border-border/40 rounded-sm animate-pulse mb-1.5" />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {boardError && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-destructive">{boardError}</span>
          </div>
        )}
        {!boardLoading && !boardError && !selectedOrgId && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-muted-foreground">Select an org to view the board.</span>
          </div>
        )}
        {!boardLoading && !boardError && !hasColumns && selectedOrgId && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-muted-foreground">No work items in this org yet.</span>
          </div>
        )}

        {!boardLoading && !boardError && hasColumns && (
          <div className="min-w-max">
            {/* ─── Column Headers (sticky) ─── */}
            <div className="sticky top-0 z-10 px-4 pt-3 bg-background">
              {/* Row 1: L1 stage_class headers — semantic colors */}
              <div className="flex flex-row">
                {classHeaderSpans.map(span => {
                  const classColor = STAGE_CLASS_COLORS[span.stage_class] || { bg: '#F1F5F9', text: '#475569' }
                  return (
                    <div
                      key={span.stage_class}
                      className="flex-shrink-0"
                      style={{ width: span.width + (span.colCount - 1) * COL_GAP }}
                    >
                      <div
                        className="text-xs font-medium uppercase tracking-wide text-center py-1.5 rounded-t"
                        style={{ backgroundColor: classColor.bg, color: classColor.text }}
                      >
                        {span.label}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Row 2: L2 stage headers */}
              <div className="flex flex-row">
                {flatColumns.map((col, colIdx) => {
                  const count = columnItemCount(col.key)
                  const orgWip = wipLimits[col.name]
                  const wipLimit = orgWip?.wip_limit ?? null
                  const wipOver = wipLimit && count > wipLimit

                  return (
                    <div key={col.key} className="flex-shrink-0" style={{ width: COL_WIDTH, borderLeft: colIdx > 0 ? '1px solid #D4D4D4' : undefined }}>
                      <div className={`flex items-center gap-2 px-3 py-2 border-b-2 ${
                        wipOver ? 'bg-destructive/10 border-destructive' : 'bg-card border-border'
                      }`}>
                        <span className="text-sm font-semibold text-foreground truncate flex-1">
                          {col.name}
                        </span>
                        {col.has_active_playbook && (
                          <Zap
                            className="h-3 w-3 flex-shrink-0 text-amber-500"
                            title="Stage has an active AI playbook"
                          />
                        )}
                        <WipIndicator
                          count={count}
                          limit={wipLimit}
                          editable={true}
                          onEdit={(val) => handleWipEdit(col.name, val)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ─── Item Row ─── */}
            <div className="flex flex-row px-4">
              {flatColumns.map((col, colIdx) => {
                const cellItems = itemGrid[col.key] ?? []
                const colBorder = colIdx > 0 ? { borderLeft: '1px solid #D4D4D4' } : {}
                return (
                  <div key={col.key} className="flex-shrink-0 py-2 px-1 min-h-[24px]" style={{ width: COL_WIDTH, ...colBorder }}>
                    <div className="flex flex-col gap-1.5">
                      {cellItems.map(item => (
                        <WorkItemCard
                          key={item.id}
                          item={item}
                          isSelected={!selectMode && detailOpen && detailItemId === item.id}
                          isChecked={selectMode && selectedItemIds.has(item.id)}
                          selectMode={selectMode}
                          onClick={handleCardClick}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
      {/* Scroll indicators — positioned over the scroll area */}
      {canScrollLeft && (
        <div
          className="absolute z-20 flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity"
          style={{
            left: 0, top: '50%', transform: 'translateY(-50%)',
            width: 24, height: 48, borderRadius: '0 6px 6px 0',
            backgroundColor: 'rgba(0,0,0,0.4)', color: '#fff', fontSize: 14,
          }}
          onClick={() => { scrollRef.current?.scrollBy({ left: -400, behavior: 'smooth' }) }}
        >
          ◂
        </div>
      )}
      {canScrollRight && (
        <div
          className="absolute z-20 flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity"
          style={{
            right: 0, top: '50%', transform: 'translateY(-50%)',
            width: 24, height: 48, borderRadius: '6px 0 0 6px',
            backgroundColor: 'rgba(0,0,0,0.4)', color: '#fff', fontSize: 14,
          }}
          onClick={() => { scrollRef.current?.scrollBy({ left: 400, behavior: 'smooth' }) }}
        >
          ▸
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

      {/* Work Item Detail */}
      <WorkItemDetail
        workItemId={detailItemId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={() => { setScrollToItemId(detailItemId); reloadBoard() }}
      />

      {/* Bulk Action Bar — shown when items are selected */}
      {selectedItemIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedItemIds}
          stages={allStages}
          users={usersData?.rows ?? []}
          onDone={handleBulkDone}
          onClear={() => { setSelectedItemIds(new Set()); setSelectMode(false) }}
        />
      )}
    </div>
  )
}
