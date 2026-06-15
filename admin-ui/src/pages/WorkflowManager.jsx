import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { FormDrawer } from '@/components/FormDrawer'
import PlaybookEditor from '@/components/PlaybookEditor'
import { ChevronLeft, ChevronRight, Plus, Loader2, Trash2, TriangleAlert, BookOpen } from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_CLASS_OPTIONS = [
  { label: 'Intake',      value: 'intake'      },
  { label: 'Triage',      value: 'triage'      },
  { label: 'Queued',      value: 'queued'      },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Blocked',     value: 'blocked'     },
  { label: 'Review',      value: 'review'      },
  { label: 'Approved',    value: 'approved'    },
  { label: 'Delivery',    value: 'delivery'    },
  { label: 'Done',        value: 'done'        },
  { label: 'Cancelled',   value: 'cancelled'   },
]

const STAGE_FUNCTION_OPTIONS = [
  { label: 'Queue',       value: 'queue'      },
  { label: 'Planning',    value: 'planning'   },
  { label: 'Action',      value: 'action'     },
  { label: 'Validation',  value: 'validation' },
  { label: 'Review',      value: 'review'     },
  { label: 'Deliver',     value: 'deliver'    },
]

const CLASS_COLOR = {
  intake: '#2B6B91', triage: '#9A7318', queued: '#6A6460',
  'in-progress': '#2D7A4F', blocked: '#A33A25', review: '#5C3D7A',
  approved: '#1E5C3A', delivery: '#2B6B91', done: '#1E5C3A', cancelled: '#A33A25',
}

const PROTECTED = new Set(['intake', 'done', 'cancelled'])

const selectCls = 'w-full bg-background border border-border rounded text-xs text-foreground px-1.5 py-1 focus:outline-none focus:border-primary'

// ─── Topology Validation ─────────────────────────────────────────────────────

function validateTopology(stages, transitions) {
  const warnings = []
  if (!stages.length) return warnings

  const entryStages = stages.filter(s => s.is_entry_stage)
  if (entryStages.length === 0) warnings.push('No entry stage defined')
  if (entryStages.length > 1) warnings.push(`${entryStages.length} entry stages — exactly 1 expected`)

  const doneStages = stages.filter(s => s.is_terminal && s.counts_toward_throughput)
  if (doneStages.length === 0) warnings.push('No terminal stage that counts toward throughput (Done)')

  for (const s of stages) {
    const outbound = transitions.filter(t => t.from_stage_id === s.id)
    const inbound  = transitions.filter(t => t.to_stage_id === s.id)
    if (!s.is_terminal && outbound.length === 0) warnings.push(`"${s.name}" has no outbound transitions`)
    if (!s.is_entry_stage && inbound.length === 0) warnings.push(`"${s.name}" has no inbound transitions`)
  }
  return warnings
}

// ─── Read-Only Flowchart ─────────────────────────────────────────────────────

const GN_W = 160, GN_H = 48, GH_GAP = 28, GV_GAP = 56, G_PER = 5, G_PAD = 24

function layoutGraph(stages) {
  const ordered = [...stages].sort((a, b) => a.display_order - b.display_order)
  const nonT = ordered.filter(s => !s.is_terminal)
  const term = ordered.filter(s => s.is_terminal)
  const pos = {}
  nonT.forEach((s, i) => {
    pos[s.id] = { x: G_PAD + (i % G_PER) * (GN_W + GH_GAP), y: G_PAD + Math.floor(i / G_PER) * (GN_H + GV_GAP) }
  })
  const tRow = Math.ceil(nonT.length / G_PER)
  term.forEach((s, i) => {
    pos[s.id] = { x: G_PAD + i * (GN_W + GH_GAP), y: G_PAD + tRow * (GN_H + GV_GAP) }
  })
  const allP = Object.values(pos)
  return {
    positions: pos,
    width:  Math.max(allP.length ? Math.max(...allP.map(p => p.x)) + GN_W + G_PAD : 400, 400),
    height: Math.max(allP.length ? Math.max(...allP.map(p => p.y)) + GN_H + G_PAD : 150, 150),
  }
}

function Flowchart({ stages, transitions }) {
  const { positions, width, height } = layoutGraph(stages)
  return (
    <div className="overflow-auto border-t border-border bg-background/40" style={{ maxHeight: 240 }}>
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
          <defs>
            <marker id="wf-arrow" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
              <polygon points="0 0, 7 2.5, 0 5" fill="#9A9490" fillOpacity="0.6" />
            </marker>
          </defs>
          {transitions.map(t => {
            const f = positions[t.from_stage_id], to = positions[t.to_stage_id]
            if (!f || !to) return null
            const sx = f.x + GN_W, sy = f.y + GN_H / 2, tx = to.x, ty = to.y + GN_H / 2
            return <path key={t.id} d={`M ${sx} ${sy} C ${(sx+tx)/2} ${sy}, ${(sx+tx)/2} ${ty}, ${tx} ${ty}`}
              fill="none" stroke="#9A9490" strokeWidth="1.2" strokeOpacity="0.5" markerEnd="url(#wf-arrow)" />
          })}
        </svg>
        {stages.map(s => {
          const p = positions[s.id]
          if (!p) return null
          const color = CLASS_COLOR[s.stage_class] || '#6A6460'
          return (
            <div key={s.id} className="absolute" style={{ left: p.x, top: p.y, width: GN_W, height: GN_H }}>
              <div className="w-full h-full rounded border bg-card flex items-center px-2 gap-1.5"
                style={{ borderColor: color + '55' }}>
                {s.is_entry_stage && <span className="text-xs text-primary flex-shrink-0">▶</span>}
                <span className="text-xs font-medium text-foreground truncate">{s.name}</span>
                {s.is_terminal && (
                  <span className={`text-xs ml-auto flex-shrink-0 ${s.counts_toward_throughput ? 'text-primary' : 'text-destructive'}`}>
                    {s.counts_toward_throughput ? '✓' : '✕'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Inline Editable Stage Column ────────────────────────────────────────────

function StageColumn({ stage, allStages, isFirst, isLast, selected, onClick, onSave, onDelete, onMoveLeft, onMoveRight, orgId }) {
  const color = CLASS_COLOR[stage.stage_class] || '#6A6460'
  const isProtected = PROTECTED.has(stage.stage_class)
  const debounceRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [playbookOpen, setPlaybookOpen] = useState(false)

  // Auto-save: debounce field changes
  const autoSave = useCallback((updates) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSaving(true)
      try { await onSave(stage.id, updates) } catch (e) { console.error(e) }
      finally { setSaving(false) }
    }, 400)
  }, [stage.id, onSave])

  // Connection toggle saves immediately (no debounce needed for checkboxes)
  async function saveConnections(updates) {
    setSaving(true)
    try { await onSave(stage.id, updates) } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const otherStages = allStages.filter(s => s.id !== stage.id)
  const fromIds = stage.from_stage_ids || []
  const toIds   = stage.to_stage_ids || []
  const fromAll = otherStages.length > 0 && otherStages.every(s => fromIds.includes(s.id))
  const toAll   = otherStages.length > 0 && otherStages.every(s => toIds.includes(s.id))

  // Connection summaries for collapsed view
  const fromNames = fromIds.map(id => allStages.find(s => s.id === id)?.name).filter(Boolean)
  const toNames   = toIds.map(id => allStages.find(s => s.id === id)?.name).filter(Boolean)

  function toggleConnection(direction, targetId) {
    const current = direction === 'from' ? [...fromIds] : [...toIds]
    const next = current.includes(targetId) ? current.filter(x => x !== targetId) : [...current, targetId]
    const key = direction === 'from' ? 'from_stage_ids' : 'to_stage_ids'
    saveConnections({ [key]: next })
  }

  function setAllConnections(direction, checked) {
    const ids = checked ? otherStages.map(s => s.id) : []
    const key = direction === 'from' ? 'from_stage_ids' : 'to_stage_ids'
    saveConnections({ [key]: ids })
  }

  if (!selected) {
    // ─── Collapsed view ──────────────────────────────────────────────
    return (
      <div
        className="w-48 min-w-[192px] flex-shrink-0 border-r border-border/40 flex flex-col cursor-pointer group hover:bg-black/[0.03] transition-colors"
        onClick={() => onClick(stage)}
      >
        <div className="px-3 py-3 flex flex-col gap-1.5 relative">
          {/* Reorder arrows */}
          <div className="absolute top-1 right-1 flex opacity-0 group-hover:opacity-100 transition-opacity">
            {!isFirst && (
              <button onClick={e => { e.stopPropagation(); onMoveLeft() }}
                className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3 w-3" /></button>
            )}
            {!isLast && (
              <button onClick={e => { e.stopPropagation(); onMoveRight() }}
                className="p-0.5 text-muted-foreground hover:text-foreground"><ChevronRight className="h-3 w-3" /></button>
            )}
          </div>

          <div className="flex items-center gap-1.5 min-w-0">
            {stage.is_entry_stage && <span className="text-xs text-primary font-semibold flex-shrink-0">▶</span>}
            <span className="text-sm font-semibold text-foreground truncate">{stage.name}</span>
            {stage.is_terminal && (
              <span className={`text-xs ml-auto flex-shrink-0 ${stage.counts_toward_throughput ? 'text-primary' : 'text-destructive'}`}>
                {stage.counts_toward_throughput ? '✓' : '✕'}
              </span>
            )}
          </div>

          <span className="text-xs px-1.5 py-0.5 rounded font-medium self-start"
            style={{ background: color + '18', color }}>{stage.stage_class}</span>

          {stage.has_waiting_queue && <span className="text-xs text-muted-foreground">has queue</span>}

          {fromNames.length > 0 && (
            <div className="text-xs text-muted-foreground/70 truncate" title={`From: ${fromNames.join(', ')}`}>
              ← {fromNames.length === otherStages.length ? 'any' : fromNames.join(', ')}
            </div>
          )}
          {toNames.length > 0 && (
            <div className="text-xs text-muted-foreground/70 truncate" title={`To: ${toNames.join(', ')}`}>
              → {toNames.length === otherStages.length ? 'any' : toNames.join(', ')}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Expanded / editing view ─────────────────────────────────────
  return (
    <div className="w-64 min-w-[256px] flex-shrink-0 border-r border-border/40 flex flex-col bg-primary/[0.04] overflow-y-auto">
      <div className="px-3 py-3 flex flex-col gap-2 relative">
        {/* Reorder arrows + close */}
        <div className="absolute top-1 right-1 flex gap-0.5">
          {!isFirst && (
            <button onClick={onMoveLeft} className="p-0.5 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-3 w-3" />
            </button>
          )}
          {!isLast && (
            <button onClick={onMoveRight} className="p-0.5 text-muted-foreground hover:text-foreground">
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Saving indicator */}
        {saving && <span className="text-xs text-muted-foreground absolute top-1 left-3">saving...</span>}

        {/* Name */}
        <input
          type="text"
          defaultValue={stage.name}
          onBlur={e => { if (e.target.value !== stage.name) autoSave({ name: e.target.value.trim() }) }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          className="text-sm font-semibold text-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0 py-0.5 mt-2"
        />

        {/* Stage Class */}
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Class</span>
          <select className={selectCls} value={stage.stage_class}
            onChange={e => autoSave({ stage_class: e.target.value })}>
            {STAGE_CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Stage Function */}
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Function</span>
          <select className={selectCls} value={stage.stage_function || ''}
            onChange={e => autoSave({ stage_function: e.target.value || null })}>
            <option value="">— none —</option>
            {STAGE_FUNCTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Flags */}
        <div className="flex flex-col gap-2 pt-2 mt-1 border-t border-border/60">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs">Entry stage</span>
            <Switch checked={!!stage.is_entry_stage} onCheckedChange={v => autoSave({ is_entry_stage: v })} />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs">Terminal</span>
            <Switch checked={!!stage.is_terminal} onCheckedChange={v => autoSave({ is_terminal: v })} />
          </label>
          {stage.is_terminal && (
            <label className="flex items-center justify-between cursor-pointer pl-3 border-l-2 border-primary/30">
              <span className="text-xs">Throughput</span>
              <Switch checked={!!stage.counts_toward_throughput} onCheckedChange={v => autoSave({ counts_toward_throughput: v })} />
            </label>
          )}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs">Waiting queue</span>
            <Switch checked={!!stage.has_waiting_queue} onCheckedChange={v => autoSave({ has_waiting_queue: v })} />
          </label>
        </div>

        {/* Inbound connections */}
        <div className="flex flex-col gap-1 pt-2 mt-1 border-t border-border/60">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">← Inbound</span>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs py-0.5 text-muted-foreground">
            <input type="checkbox" checked={fromAll} onChange={e => setAllConnections('from', e.target.checked)} className="accent-primary" />
            any
          </label>
          <div className="max-h-28 overflow-y-auto flex flex-col">
            {otherStages.map(s => (
              <label key={s.id} className="flex items-center gap-1.5 cursor-pointer text-xs py-0.5 hover:bg-black/[0.03] rounded px-0.5">
                <input type="checkbox" checked={fromIds.includes(s.id)}
                  onChange={() => toggleConnection('from', s.id)} className="accent-primary" />
                <span className="truncate">{s.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Outbound connections */}
        <div className="flex flex-col gap-1 pt-2 mt-1 border-t border-border/60">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">→ Outbound</span>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs py-0.5 text-muted-foreground">
            <input type="checkbox" checked={toAll} onChange={e => setAllConnections('to', e.target.checked)} className="accent-primary" />
            any
          </label>
          <div className="max-h-28 overflow-y-auto flex flex-col">
            {otherStages.map(s => (
              <label key={s.id} className="flex items-center gap-1.5 cursor-pointer text-xs py-0.5 hover:bg-black/[0.03] rounded px-0.5">
                <input type="checkbox" checked={toIds.includes(s.id)}
                  onChange={() => toggleConnection('to', s.id)} className="accent-primary" />
                <span className="truncate">{s.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Playbook */}
        <div className="pt-2 mt-1 border-t border-border/60">
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            onClick={() => setPlaybookOpen(v => !v)}
          >
            <BookOpen className="h-3 w-3 flex-shrink-0" />
            <span>Playbook</span>
            <span className="ml-auto text-xs">{playbookOpen ? '▲' : '▼'}</span>
          </button>
          {playbookOpen && (
            <PlaybookEditor stageId={stage.id} orgId={orgId} stageName={stage.name} />
          )}
        </div>

        {/* Delete */}
        {!isProtected && (
          <div className="pt-2 mt-1 border-t border-border/60">
            <button onClick={onDelete} className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors">
              <Trash2 className="h-3 w-3" /> Remove stage
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Validation Banner ───────────────────────────────────────────────────────

function ValidationBanner({ stages, transitions }) {
  const warnings = useMemo(() => validateTopology(stages, transitions), [stages, transitions])
  if (warnings.length === 0) return null
  return (
    <div className="mx-4 mt-2 px-3 py-2 rounded border text-xs flex flex-col gap-1"
      style={{ background: '#C4960F18', borderColor: '#C4960F40' }}>
      {warnings.map((w, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <TriangleAlert className="h-3 w-3 flex-shrink-0" style={{ color: '#C4960F' }} />
          {w}
        </span>
      ))}
    </div>
  )
}

// ─── Main WorkflowManager ─────────────────────────────────────────────────────

export default function WorkflowManager() {
  const { data: workflowsData, reload: reloadList } = useApi(() => api.workflows(), [])
  const [selectedWfId,  setSelectedWfId]  = useState(null)
  const [wfData,        setWfData]        = useState(null)
  const [loadingWf,     setLoadingWf]     = useState(false)
  const [selectedStageId, setSelectedStageId] = useState(null)
  const [cloneOpen,     setCloneOpen]     = useState(false)
  const [showGraph,     setShowGraph]     = useState(false)
  const [addingStage,   setAddingStage]   = useState(false)
  const [newStageName,  setNewStageName]  = useState('')
  const [editingName,   setEditingName]   = useState(false)
  const [nameDraft,     setNameDraft]     = useState('')
  const [creating,      setCreating]      = useState(false)

  const workflows = workflowsData?.rows ?? []

  useEffect(() => {
    if (!selectedWfId && workflows.length) setSelectedWfId(workflows[0].id)
  }, [workflows, selectedWfId])

  useEffect(() => {
    if (!selectedWfId) return
    setLoadingWf(true)
    setSelectedStageId(null)
    api.workflow(selectedWfId).then(data => {
      setWfData(data)
      setLoadingWf(false)
    }).catch(() => setLoadingWf(false))
  }, [selectedWfId])

  function reloadWorkflow() {
    if (!selectedWfId) return
    api.workflow(selectedWfId).then(data => {
      setWfData(data)
    }).catch(() => {})
  }

  const handleSaveStage = useCallback(async (stageId, updates) => {
    await api.updateStage(stageId, updates)
    reloadWorkflow()
  }, [selectedWfId])

  async function handleDeleteStage(stageId) {
    if (!confirm('Remove this stage? This cannot be undone.')) return
    await api.deleteStage(stageId)
    setSelectedStageId(null)
    reloadWorkflow()
  }

  async function handleMoveStage(stageId, direction) {
    const sorted = [...stages].sort((a, b) => a.display_order - b.display_order)
    const idx = sorted.findIndex(s => s.id === stageId)
    const swapIdx = idx + direction
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    const order = sorted.map((s, i) => {
      if (i === idx) return { id: sorted[swapIdx].id, display_order: sorted[idx].display_order }
      if (i === swapIdx) return { id: sorted[idx].id, display_order: sorted[swapIdx].display_order }
      return { id: s.id, display_order: s.display_order }
    })
    await api.reorderStages(selectedWfId, order)
    reloadWorkflow()
  }

  async function handleAddStage() {
    if (!newStageName.trim()) return
    setAddingStage(true)
    try {
      await api.createStage({
        workflow_id: selectedWfId,
        name: newStageName.trim(),
        stage_class: 'queued',
        stage_type: 'waiting',
        display_order: Math.max(...stages.map(s => s.display_order), 0) + 1,
      })
      setNewStageName('')
      reloadWorkflow()
    } finally { setAddingStage(false) }
  }

  async function handleRenameWorkflow() {
    if (!nameDraft.trim() || nameDraft === wfData?.workflow?.name) { setEditingName(false); return }
    await api.updateWorkflow(selectedWfId, { name: nameDraft.trim() })
    reloadWorkflow()
    reloadList()
    setEditingName(false)
  }

  async function handleDeactivateWorkflow() {
    if (!wfData?.workflow) return
    const active = wfData.workflow.is_active
    if (active && !confirm(`Deactivate "${wfData.workflow.name}"?`)) return
    await api.updateWorkflow(selectedWfId, { is_active: !active })
    reloadWorkflow()
    reloadList()
  }

  async function handleCreateWorkflow() {
    setCreating(true)
    try {
      const wf = await api.createWorkflow({ name: 'New Workflow' })
      await reloadList()
      if (wf?.id) {
        setSelectedWfId(wf.id)
        // Trigger inline rename after load
        setTimeout(() => {
          setNameDraft('New Workflow')
          setEditingName(true)
        }, 300)
      }
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  const stages = wfData?.stages ?? []
  const transitions = wfData?.transitions ?? []
  const sortedStages = [...stages].sort((a, b) => a.display_order - b.display_order)

  const CLONE_FIELDS = [
    { key: 'name', label: 'New Name', type: 'text', required: true },
  ]

  return (
    <div className="flex h-full min-h-0">
      {/* Left: Workflow list */}
      <div className="w-[200px] flex-shrink-0 border-r border-border flex flex-col bg-card">
        <div className="px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workflows</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {workflows.map(wf => (
            <button
              key={wf.id}
              onClick={() => setSelectedWfId(wf.id)}
              className={`w-full px-4 py-2.5 text-left transition-colors border-b border-border/40 flex flex-col gap-0.5 ${
                selectedWfId === wf.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-black/[0.04]'
              }`}
            >
              <span className={`text-xs font-medium truncate ${!wf.is_active ? 'text-muted-foreground' : ''}`}>{wf.name}</span>
              {wf.is_system_default && <span className="text-xs text-muted-foreground">system default</span>}
              {!wf.is_active && <span className="text-xs text-muted-foreground italic">inactive</span>}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-border flex-shrink-0">
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleCreateWorkflow} disabled={creating}>
            {creating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            + New Workflow
          </Button>
        </div>
      </div>

      {/* Center: Stage Columns */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
          {wfData && (
            <>
              {editingName ? (
                <input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onBlur={handleRenameWorkflow}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameWorkflow(); if (e.key === 'Escape') setEditingName(false) }}
                  className="font-semibold text-sm bg-background border border-border rounded px-2 py-0.5 focus:outline-none focus:border-primary"
                  autoFocus
                />
              ) : (
                <span
                  className="font-semibold text-sm cursor-pointer hover:text-primary transition-colors"
                  onClick={() => { setNameDraft(wfData.workflow?.name || ''); setEditingName(true) }}
                  title="Click to rename"
                >
                  {wfData.workflow?.name}
                </span>
              )}
              {wfData.workflow?.is_system_default && <Badge variant="brown">system default</Badge>}
              {!wfData.workflow?.is_active && <Badge variant="muted">inactive</Badge>}
              <span className="text-xs text-muted-foreground">
                {stages.length} stages · {transitions.length} transitions
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setShowGraph(!showGraph)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    showGraph ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {showGraph ? 'Hide Graph' : 'Show Graph'}
                </button>
                <Button variant="outline" size="sm" onClick={() => setCloneOpen(true)}>Clone</Button>
                <Button variant={wfData.workflow?.is_active ? 'outline' : 'default'} size="sm" onClick={handleDeactivateWorkflow}>
                  {wfData.workflow?.is_active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Validation warnings */}
        {!loadingWf && stages.length > 0 && (
          <ValidationBanner stages={stages} transitions={transitions} />
        )}

        {/* Read-only flowchart */}
        {showGraph && !loadingWf && stages.length > 0 && (
          <Flowchart stages={stages} transitions={transitions} />
        )}

        {/* Stage columns */}
        <div className="flex-1 overflow-x-auto overflow-y-auto flex">
          {loadingWf && (
            <div className="flex items-center justify-center flex-1">
              <span className="text-xs text-muted-foreground">Loading...</span>
            </div>
          )}

          {!loadingWf && !wfData && (
            <div className="flex items-center justify-center flex-1">
              <span className="text-xs text-muted-foreground">Select a workflow to edit.</span>
            </div>
          )}

          {!loadingWf && wfData && stages.length === 0 && (
            <div className="flex items-center justify-center flex-1">
              <span className="text-xs text-muted-foreground">No stages yet. Add one to get started.</span>
            </div>
          )}

          {!loadingWf && sortedStages.length > 0 && sortedStages.map((stage, idx) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              allStages={stages}
              isFirst={idx === 0}
              isLast={idx === sortedStages.length - 1}
              selected={selectedStageId === stage.id}
              onClick={s => setSelectedStageId(selectedStageId === s.id ? null : s.id)}
              onSave={handleSaveStage}
              onDelete={() => handleDeleteStage(stage.id)}
              onMoveLeft={() => handleMoveStage(stage.id, -1)}
              onMoveRight={() => handleMoveStage(stage.id, 1)}
              orgId={wfData?.workflow?.owner_org_id}
            />
          ))}

          {/* Add stage column */}
          {!loadingWf && wfData && (
            <div className="w-48 min-w-[192px] flex-shrink-0 flex flex-col items-center justify-start pt-6 px-3 gap-2">
              <input
                type="text"
                value={newStageName}
                onChange={e => setNewStageName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddStage()}
                placeholder="New stage name..."
                className="w-full bg-background border border-dashed border-border rounded text-xs text-foreground px-2 py-1.5 focus:outline-none focus:border-primary"
              />
              <Button variant="ghost" size="sm" onClick={handleAddStage} disabled={addingStage || !newStageName.trim()} className="text-xs w-full">
                <Plus className="h-3 w-3 mr-1" /> Add Stage
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Clone Workflow Drawer */}
      <FormDrawer
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        title={`Clone "${wfData?.workflow?.name || ''}"`}
        fields={CLONE_FIELDS}
        initialValues={{ name: wfData?.workflow?.name ? `${wfData.workflow.name} (copy)` : '' }}
        onSubmit={v => api.cloneWorkflow(selectedWfId, { name: v.name })}
        onSaved={wf => { reloadList(); if (wf?.id) setSelectedWfId(wf.id); setCloneOpen(false) }}
      />
    </div>
  )
}
