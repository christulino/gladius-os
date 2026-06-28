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

// ─── Service Class Swimlane Config ──────────────────────────────────────────

const SWIMLANE_ORDER = ['expedite', 'fixed_date', 'standard', 'deferred', 'personal']
const SWIMLANE_CONFIG = {
  expedite:   { label: 'Expedite',   color: '#A33A25', bg: '#F5D4CD' },
  fixed_date: { label: 'Fixed Date', color: '#9A7318', bg: '#F2E2B8' },
  standard:   { label: 'Standard',   color: '#1E5C3A', bg: '#D4E8DA' },
  deferred:   { label: 'Deferred',   color: '#6A6460', bg: '#E4E1DE' },
  personal:   { label: 'Personal',   color: '#8B7355', bg: '#E8E1D7' },
}

const COL_WIDTH = 220
const LABEL_WIDTH = 80
const COL_GAP = 1 // px gap — thin visible column dividers


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
  // Board display preferences — default: flat (no swimlanes), hide empty columns
  const [showSwimlanes, setShowSwimlanes] = useState(() => {
    try { return localStorage.getItem('board_show_swimlanes') === 'true' } catch { return false }
  })
  const [showEmptyColumns, setShowEmptyColumns] = useState(() => {
    try { return localStorage.getItem('board_show_empty_cols') === 'true' } catch { return false }
  })

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

  // Item grid: grid[columnKey][swimlane] = { waiting: [], active: [] }
  const itemGrid = useMemo(() => {
    const grid = {}
    for (const col of flatColumns) {
      grid[col.key] = {}
      for (const cls of SWIMLANE_ORDER) {
        grid[col.key][cls] = { waiting: [], active: [] }
      }
    }
    for (const item of filteredItems) {
      const colKey = stageIdToKey[item.current_stage_id]
      if (!colKey || !grid[colKey]) continue
      const cls = item.derived_service_class || 'standard'
      if (!grid[colKey][cls]) continue
      if (item.current_substate === 'waiting') {
        grid[colKey][cls].waiting.push(item)
      } else {
        grid[colKey][cls].active.push(item)
      }
    }
    return grid
  }, [flatColumns, filteredItems, stageIdToKey])

  // Count items per column (all substates combined)
  function columnItemCount(colKey) {
    const colData = itemGrid[colKey]
    if (!colData) return 0
    let count = 0
    for (const cls of SWIMLANE_ORDER) {
      count += (colData[cls]?.waiting?.length ?? 0) + (colData[cls]?.active?.length ?? 0)
    }
    return count
  }

  // Visible columns: skip empty ones unless the user has turned on "show empty"
  const visibleColumns = useMemo(() => {
    if (showEmptyColumns) return flatColumns
    return flatColumns.filter(col => columnItemCount(col.key) > 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatColumns, showEmptyColumns, itemGrid])

  // Check if a column has any waiting items (for queue-split decision)
  function columnHasWaiting(colKey) {
    const colData = itemGrid[colKey]
    if (!colData) return false
    return SWIMLANE_ORDER.some(cls => (colData[cls]?.waiting?.length ?? 0) > 0)
  }

  // Determine which swimlanes have items among visible columns (hide empty lanes)
  const activeSwimlanes = useMemo(() => {
    return SWIMLANE_ORDER.filter(cls =>
      visibleColumns.some(col => {
        const cell = itemGrid[col.key]?.[cls]
        return cell && (cell.waiting.length > 0 || cell.active.length > 0)
      })
    )
  }, [visibleColumns, itemGrid])

  const displaySwimlanes = activeSwimlanes.length > 0 ? activeSwimlanes : ['standard']

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

  async function handlePull(itemId) {
    try {
      await api.setSubstate(itemId, 'active')
      reloadBoard()
    } catch (err) {
      console.error('Failed to pull item:', err)
    }
  }

  function toggleSelectMode() {
    setSelectMode(v => !v)
    setSelectedItemIds(new Set())
  }

  function toggleSwimlanes() {
    const next = !showSwimlanes
    setShowSwimlanes(next)
    try { localStorage.setItem('board_show_swimlanes', String(next)) } catch { /* ignore */ }
  }

  function toggleEmptyColumns() {
    const next = !showEmptyColumns
    setShowEmptyColumns(next)
    try { localStorage.setItem('board_show_empty_cols', String(next)) } catch { /* ignore */ }
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

        <button
          onClick={toggleSwimlanes}
          className={`px-2 py-1.5 text-xs rounded border transition-colors ${
            showSwimlanes
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-card border-border text-muted-foreground hover:border-primary/50'
          }`}
          title={showSwimlanes ? 'Hide service class swimlanes' : 'Show service class swimlanes'}
        >
          Swimlanes
        </button>

        <button
          onClick={toggleEmptyColumns}
          className={`px-2 py-1.5 text-xs rounded border transition-colors ${
            showEmptyColumns
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-card border-border text-muted-foreground hover:border-primary/50'
          }`}
          title={showEmptyColumns ? 'Hide empty columns' : 'Show all columns including empty ones'}
        >
          {showEmptyColumns ? 'All cols' : 'Active cols'}
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

        {!boardLoading && !boardError && hasColumns && visibleColumns.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-muted-foreground">
              No active items.{' '}
              <button
                onClick={toggleEmptyColumns}
                className="underline hover:text-primary transition-colors"
              >
                Show all columns
              </button>
              {' '}to see empty stages.
            </span>
          </div>
        )}

        {!boardLoading && !boardError && hasColumns && visibleColumns.length > 0 && (
          <div className="min-w-max">
            {/* Stage headers (sticky) */}
            <div className="sticky top-0 z-10 px-4 pt-3 bg-background">
              {/* Stage header row — no L1 class-spanning headers (noise) */}
              <div className="flex flex-row">
                {/* Swimlane label spacer — only when swimlanes are visible */}
                {showSwimlanes && <div className="flex-shrink-0" style={{ width: LABEL_WIDTH }} />}
                {visibleColumns.map((col, colIdx) => {
                  const count = columnItemCount(col.key)
                  const orgWip = wipLimits[col.name]
                  const wipLimit = orgWip?.wip_limit ?? null
                  const wipOver = wipLimit && count > wipLimit
                  // Only widen for waiting queue when there are actual waiting items and swimlanes are on
                  const showQueueSplit = showSwimlanes && col.has_waiting_queue && columnHasWaiting(col.key)
                  const colWidth = showQueueSplit ? COL_WIDTH * 2 + COL_GAP : COL_WIDTH

                  return (
                    <div key={col.key} className="flex-shrink-0" style={{ width: colWidth, borderLeft: colIdx > 0 ? '1px solid #D4D4D4' : undefined }}>
                      <div className={`flex items-center gap-2 px-3 py-2 border-b-2 ${
                        wipOver ? 'bg-destructive/10 border-destructive' : 'bg-card border-border'
                      }`}>
                        <span className="text-sm font-semibold text-foreground truncate flex-1">
                          {col.name}
                        </span>
                        <WipIndicator
                          count={count}
                          limit={wipLimit}
                          editable={true}
                          onEdit={(val) => handleWipEdit(col.name, val)}
                        />
                      </div>
                      {/* L3: waiting queue sub-header — only in swimlane mode when items are waiting */}
                      {showQueueSplit && (
                        <div className="flex flex-row bg-card">
                          <div className="text-xs text-muted-foreground/60 px-2 py-0.5" style={{ width: COL_WIDTH }}>
                            Ready for...
                          </div>
                          <div style={{ width: COL_WIDTH }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Flat view (default): single row, all items, no swimlane labels */}
            {!showSwimlanes && (
              <div className="flex flex-row px-4">
                {visibleColumns.map((col, colIdx) => {
                  const allColItems = SWIMLANE_ORDER.flatMap(cls => {
                    const cell = itemGrid[col.key]?.[cls]
                    return [...(cell?.waiting ?? []), ...(cell?.active ?? [])]
                  })
                  const colBorder = colIdx > 0 ? { borderLeft: '1px solid #D4D4D4' } : {}
                  return (
                    <div key={col.key} className="flex-shrink-0 py-2 px-1 min-h-[24px]" style={{ width: COL_WIDTH, ...colBorder }}>
                      <div className="flex flex-col gap-1.5">
                        {allColItems.map(item => (
                          <WorkItemCard
                            key={item.id}
                            item={item}
                            isSelected={!selectMode && detailOpen && detailItemId === item.id}
                            isChecked={selectMode && selectedItemIds.has(item.id)}
                            selectMode={selectMode}
                            onClick={handleCardClick}
                            onPull={() => handlePull(item.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Swimlane view: one row per service class */}
            {showSwimlanes && displaySwimlanes.map((cls, laneIdx) => {
              const config = SWIMLANE_CONFIG[cls]
              return (
                <div key={cls} className="flex flex-row px-4" style={{ borderTop: laneIdx > 0 ? '1px solid #D4D4D4' : undefined }}>
                  {/* Swimlane label with left accent bar */}
                  <div className="flex-shrink-0 py-2 flex items-start justify-end pr-3" style={{ width: LABEL_WIDTH }}>
                    <div
                      className="flex items-start"
                      style={{ borderLeft: `4px solid ${config.color}`, paddingLeft: 8 }}
                    >
                      <span
                        className="text-xs font-medium uppercase tracking-wide"
                        style={{ color: config.color, writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                      >
                        {config.label}
                      </span>
                    </div>
                  </div>
                  {/* Cells */}
                  {visibleColumns.map((col, colIdx) => {
                    const cell = itemGrid[col.key]?.[cls]
                    const waitingItems = cell?.waiting ?? []
                    const activeItems = cell?.active ?? []
                    const colBorder = colIdx > 0 ? { borderLeft: '1px solid #D4D4D4' } : {}
                    const showQueueSplit = col.has_waiting_queue && columnHasWaiting(col.key)

                    if (showQueueSplit) {
                      // Split cell: waiting | active with dashed divider
                      return (
                        <div key={col.key} className="flex-shrink-0 py-2 px-1 flex flex-row relative" style={{ width: COL_WIDTH * 2 + COL_GAP, ...colBorder }}>
                          {/* Dashed center divider */}
                          <div className="absolute top-0 bottom-0" style={{ left: COL_WIDTH + COL_GAP / 2, borderLeft: '1px dashed #B0B0B0' }} />
                          {/* Waiting (left) */}
                          <div className="min-h-[24px] pr-1.5" style={{ width: COL_WIDTH }}>
                            <div className="flex flex-col gap-1.5">
                              {waitingItems.map(item => (
                                <WorkItemCard
                                  key={item.id}
                                  item={item}
                                  isSelected={!selectMode && detailOpen && detailItemId === item.id}
                                  isChecked={selectMode && selectedItemIds.has(item.id)}
                                  selectMode={selectMode}
                                  onClick={handleCardClick}
                                  onPull={() => handlePull(item.id)}
                                />
                              ))}
                            </div>
                          </div>
                          {/* Active (right) */}
                          <div className="min-h-[24px] pl-1.5" style={{ width: COL_WIDTH, marginLeft: COL_GAP }}>
                            <div className="flex flex-col gap-1.5">
                              {activeItems.map(item => (
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
                        </div>
                      )
                    }

                    // Single cell (no waiting queue or no waiting items)
                    const allCellItems = [...waitingItems, ...activeItems]
                    return (
                      <div key={col.key} className="flex-shrink-0 py-2 px-1 min-h-[24px]" style={{ width: COL_WIDTH, ...colBorder }}>
                        <div className="flex flex-col gap-1.5">
                          {allCellItems.map(item => (
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
              )
            })}
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
