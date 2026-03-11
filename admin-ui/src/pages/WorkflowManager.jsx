import { useState, useEffect } from 'react'
import { useApi } from '@/hooks/useApi'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_W   = 200
const NODE_H   = 72
const H_GAP    = 36
const V_GAP    = 80
const PER_ROW  = 5
const PAD      = 40 // canvas padding

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
  { label: 'Queue — waiting, not yet started', value: 'queue'      },
  { label: 'Planning — active analysis/triage', value: 'planning'  },
  { label: 'Action — active work in progress',  value: 'action'    },
  { label: 'Validation — checking/testing',     value: 'validation'},
  { label: 'Review — approval/sign-off',        value: 'review'    },
  { label: 'Deliver — deployment/completion',   value: 'deliver'   },
]

const CLASS_COLOR = {
  intake: '#2B6B91', triage: '#9A7318', queued: '#6A6460',
  'in-progress': '#2D7A4F', blocked: '#A33A25', review: '#5C3D7A',
  approved: '#1E5C3A', delivery: '#2B6B91', done: '#1E5C3A', cancelled: '#A33A25',
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function layoutStages(stages) {
  const ordered = [...stages].sort((a, b) => a.display_order - b.display_order)
  const nonTerminal = ordered.filter(s => !s.is_terminal)
  const terminal    = ordered.filter(s => s.is_terminal)

  const positions = {}
  nonTerminal.forEach((s, i) => {
    const row = Math.floor(i / PER_ROW)
    const col = i % PER_ROW
    positions[s.id] = { x: PAD + col * (NODE_W + H_GAP), y: PAD + row * (NODE_H + V_GAP) }
  })

  const terminalRow = Math.ceil(nonTerminal.length / PER_ROW)
  terminal.forEach((s, i) => {
    positions[s.id] = { x: PAD + i * (NODE_W + H_GAP), y: PAD + terminalRow * (NODE_H + V_GAP) }
  })

  const allPositions = Object.values(positions)
  const maxX = allPositions.length ? Math.max(...allPositions.map(p => p.x)) + NODE_W + PAD : NODE_W + PAD * 2
  const maxY = allPositions.length ? Math.max(...allPositions.map(p => p.y)) + NODE_H + PAD : NODE_H + PAD * 2

  return { positions, width: Math.max(maxX, 600), height: Math.max(maxY, 300) }
}

// ─── Edge drawing ─────────────────────────────────────────────────────────────

function edgePath(fromPos, toPos) {
  const sx = fromPos.x + NODE_W
  const sy = fromPos.y + NODE_H / 2
  const tx = toPos.x
  const ty = toPos.y + NODE_H / 2
  const cx = (sx + tx) / 2
  return `M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ty}, ${tx} ${ty}`
}

function EdgeArrow({ from: fromPos, to: toPos, color = '#9A9490' }) {
  if (!fromPos || !toPos) return null
  const d = edgePath(fromPos, toPos)
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.6" markerEnd="url(#arrowhead)" />
    </g>
  )
}

// ─── Stage Node ───────────────────────────────────────────────────────────────

function StageNode({ stage, position, selected, onClick }) {
  const color = CLASS_COLOR[stage.stage_class] || '#6A6460'
  return (
    <div
      onClick={() => onClick(stage)}
      className="absolute cursor-pointer select-none transition-shadow"
      style={{ left: position.x, top: position.y, width: NODE_W, height: NODE_H }}
    >
      <div
        className={`w-full h-full rounded-lg border-2 bg-card flex flex-col justify-center px-3 py-2 gap-1 transition-all ${
          selected ? 'shadow-lg' : 'shadow-sm hover:shadow-md'
        }`}
        style={{ borderColor: selected ? 'hsl(var(--primary))' : color + '66' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {stage.is_entry_stage && (
            <span className="text-[9px] text-primary font-semibold flex-shrink-0">▶</span>
          )}
          <span className="font-semibold text-sm text-foreground truncate">{stage.name}</span>
          {stage.is_terminal && !stage.counts_toward_throughput && (
            <span className="text-[9px] text-destructive ml-auto flex-shrink-0">✕</span>
          )}
          {stage.is_terminal && stage.counts_toward_throughput && (
            <span className="text-[9px] text-primary ml-auto flex-shrink-0">✓</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: color + '18', color }}
          >
            {stage.stage_class}
          </span>
          {stage.wip_limit && (
            <span className="text-[10px] text-muted-foreground">WIP {stage.wip_limit}</span>
          )}
          {stage.sla_hours && (
            <span className="text-[10px] text-muted-foreground">{stage.sla_hours}h SLA</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Stage Editor ─────────────────────────────────────────────────────────────

const PROTECTED = new Set(['intake', 'done', 'cancelled'])

function StageEditor({ stage, allStages, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  useEffect(() => {
    if (!stage) return
    setForm({
      name:                     stage.name,
      stage_class:              stage.stage_class,
      stage_function:           stage.stage_function || '',
      wip_limit:                stage.wip_limit || '',
      sla_hours:                stage.sla_hours || '',
      is_entry_stage:           stage.is_entry_stage,
      is_terminal:              stage.is_terminal,
      counts_toward_throughput: stage.counts_toward_throughput ?? true,
      from_stage_ids:           stage.from_stage_ids || [],
    })
    setError(null)
  }, [stage?.id])

  if (!stage) return (
    <div className="w-[380px] flex-shrink-0 border-l border-border flex items-center justify-center">
      <span className="text-sm text-muted-foreground text-center px-6">
        Click a stage on the canvas to view and edit its details.
      </span>
    </div>
  )

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setError(null)
  }

  function toggleFromStage(id) {
    const current = form.from_stage_ids || []
    set('from_stage_ids', current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id]
    )
  }

  function setFromAny(checked) {
    if (checked) {
      set('from_stage_ids', allStages.filter(s => s.id !== stage.id).map(s => s.id))
    } else {
      set('from_stage_ids', [])
    }
  }

  const otherStages = allStages.filter(s => s.id !== stage.id)
  const fromAny = otherStages.length > 0 && otherStages.every(s => (form.from_stage_ids || []).includes(s.id))
  const isProtected = PROTECTED.has(stage.stage_class)

  async function handleSave() {
    if (!form.name?.trim()) { setError('Name is required'); return }
    setSaving(true)
    try {
      await onSave(stage.id, {
        name:                     form.name.trim(),
        stage_class:              form.stage_class,
        stage_function:           form.stage_function || null,
        wip_limit:                form.wip_limit ? parseInt(form.wip_limit) : null,
        sla_hours:                form.sla_hours ? parseFloat(form.sla_hours) : null,
        is_entry_stage:           form.is_entry_stage,
        is_terminal:              form.is_terminal,
        counts_toward_throughput: form.counts_toward_throughput,
        from_stage_ids:           form.from_stage_ids || [],
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove stage "${stage.name}"? This cannot be undone.`)) return
    try {
      await onDelete(stage.id)
    } catch (err) {
      setError(err.message)
    }
  }

  const Field = ({ label, children, hint }) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-foreground">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )

  const inputCls = "w-full bg-background border border-border rounded text-sm text-foreground px-3 py-2 focus:outline-none focus:border-primary"
  const selectCls = "w-full bg-background border border-border rounded text-sm text-foreground px-3 py-2 focus:outline-none focus:border-primary"

  return (
    <div className="w-[380px] flex-shrink-0 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <span className="font-semibold text-sm text-foreground">Stage Details</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
        {/* Name */}
        <Field label="Stage Name">
          <input type="text" className={inputCls} value={form.name || ''} onChange={e => set('name', e.target.value)} />
        </Field>

        {/* Stage Class */}
        <Field label="Stage Class" hint="Semantic category used for cross-workflow board normalization.">
          <select className={selectCls} value={form.stage_class || ''} onChange={e => set('stage_class', e.target.value)}>
            {STAGE_CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        {/* Stage Function */}
        <Field label="Stage Function" hint="Ordered type used to group stages from different workflows on shared boards.">
          <select className={selectCls} value={form.stage_function || ''} onChange={e => set('stage_function', e.target.value)}>
            <option value="">— none —</option>
            {STAGE_FUNCTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        {/* WIP Limit + SLA in 2-col */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="WIP Limit" hint="0 = unlimited">
            <input type="number" min="0" className={inputCls} value={form.wip_limit || ''} onChange={e => set('wip_limit', e.target.value)} placeholder="unlimited" />
          </Field>
          <Field label="SLA Hours">
            <input type="number" min="0" step="0.5" className={inputCls} value={form.sla_hours || ''} onChange={e => set('sla_hours', e.target.value)} placeholder="none" />
          </Field>
        </div>

        {/* Flags */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">Entry Stage</span>
              <p className="text-xs text-muted-foreground">Work items enter the workflow here.</p>
            </div>
            <Switch checked={!!form.is_entry_stage} onCheckedChange={v => set('is_entry_stage', v)} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">Terminal Stage</span>
              <p className="text-xs text-muted-foreground">Work items cannot move forward from here.</p>
            </div>
            <Switch checked={!!form.is_terminal} onCheckedChange={v => set('is_terminal', v)} />
          </div>
          {form.is_terminal && (
            <div className="flex items-center justify-between pl-4 border-l-2 border-primary/30">
              <div>
                <span className="text-sm font-medium">Counts Toward Throughput</span>
                <p className="text-xs text-muted-foreground">Done counts. Cancelled does not.</p>
              </div>
              <Switch checked={!!form.counts_toward_throughput} onCheckedChange={v => set('counts_toward_throughput', v)} />
            </div>
          )}
        </div>

        {/* Incoming Connections */}
        <Field label="Incoming Connections" hint="Which stages can transition TO this stage.">
          <div className="flex flex-col gap-1 border border-border rounded-md overflow-hidden">
            {/* From any */}
            <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/40 cursor-pointer border-b border-border bg-muted/20">
              <input
                type="checkbox"
                checked={fromAny}
                onChange={e => setFromAny(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-sm font-medium">From any stage</span>
              <span className="text-xs text-muted-foreground ml-auto">(select all)</span>
            </label>
            {otherStages.map(s => (
              <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/40 cursor-pointer border-b border-border/50 last:border-b-0">
                <input
                  type="checkbox"
                  checked={(form.from_stage_ids || []).includes(s.id)}
                  onChange={() => toggleFromStage(s.id)}
                  className="accent-primary"
                />
                <span className="text-sm">{s.name}</span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded ml-auto font-medium"
                  style={{ background: (CLASS_COLOR[s.stage_class] || '#6A6460') + '18', color: CLASS_COLOR[s.stage_class] || '#6A6460' }}
                >
                  {s.stage_class}
                </span>
              </label>
            ))}
          </div>
        </Field>

        {error && (
          <div className="text-sm px-3 py-2 rounded bg-destructive/10 text-destructive border border-destructive/20">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-2 p-4 border-t border-border flex-shrink-0">
        {!isProtected ? (
          <Button variant="danger" size="sm" onClick={handleDelete}>
            Remove Stage
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground italic self-center">Protected stage</span>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── New Workflow Modal ───────────────────────────────────────────────────────

function NewWorkflowModal({ open, onClose, onCreated }) {
  const [name,    setName]    = useState('')
  const [orgId,   setOrgId]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const { data: orgsData } = useApi(() => api.organizations(), [])

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!orgId) { setError('Owner org is required'); return }
    setSaving(true)
    try {
      const wf = await api.createWorkflow({ name: name.trim(), owner_org_id: parseInt(orgId) })
      onCreated(wf)
      setName('')
      setOrgId('')
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card border border-border rounded-lg shadow-xl w-[360px] p-6 flex flex-col gap-4">
        <h2 className="font-semibold text-base">New Workflow</h2>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold">Workflow Name</label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              placeholder="e.g. Engineering Delivery"
              className="w-full bg-background border border-border rounded text-sm text-foreground px-3 py-2 focus:outline-none focus:border-primary"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold">Owner Org</label>
            <select
              value={orgId}
              onChange={e => { setOrgId(e.target.value); setError(null) }}
              className="w-full bg-background border border-border rounded text-sm text-foreground px-3 py-2 focus:outline-none focus:border-primary"
            >
              <option value="">— select org —</option>
              {(orgsData?.rows ?? []).map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Starts with default stages: Intake → In Progress → Done (+ Cancelled).
          </p>
          {error && (
            <div className="text-sm px-3 py-2 rounded bg-destructive/10 text-destructive border border-destructive/20">{error}</div>
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="default" size="sm" onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create Workflow'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Stage Panel ──────────────────────────────────────────────────────────

function AddStagePanel({ workflowId, stages, onAdded }) {
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  async function handleAdd() {
    if (!name.trim()) { setError('Name required'); return }
    setAdding(true)
    try {
      await api.createStage({
        workflow_id: workflowId,
        name: name.trim(),
        stage_class: 'queued',
        stage_type: 'waiting',
        display_order: Math.max(...stages.map(s => s.display_order), 0) + 1,
      })
      setName('')
      onAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={e => { setName(e.target.value); setError(null) }}
        placeholder="New stage name..."
        className="bg-background border border-border rounded text-sm text-foreground px-3 py-1.5 focus:outline-none focus:border-primary w-48"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <Button size="sm" variant="outline" onClick={handleAdd} disabled={adding}>
        {adding ? '…' : '+ Add Stage'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

// ─── Main WorkflowManager ─────────────────────────────────────────────────────

export default function WorkflowManager() {
  const { data: workflowsData, reload: reloadList } = useApi(() => api.workflows(), [])
  const [selectedWfId, setSelectedWfId]  = useState(null)
  const [wfData,       setWfData]        = useState(null)
  const [loadingWf,    setLoadingWf]     = useState(false)
  const [selectedStage, setSelectedStage] = useState(null)
  const [newWfOpen,    setNewWfOpen]     = useState(false)

  const workflows = workflowsData?.rows ?? []

  // Auto-select first workflow
  useEffect(() => {
    if (!selectedWfId && workflows.length) {
      setSelectedWfId(workflows[0].id)
    }
  }, [workflows, selectedWfId])

  // Load selected workflow detail
  useEffect(() => {
    if (!selectedWfId) return
    setLoadingWf(true)
    setSelectedStage(null)
    api.workflow(selectedWfId).then(data => {
      setWfData(data)
      setLoadingWf(false)
    }).catch(() => setLoadingWf(false))
  }, [selectedWfId])

  function reloadWorkflow() {
    if (!selectedWfId) return
    api.workflow(selectedWfId).then(data => {
      setWfData(data)
      // Re-select stage if still exists
      if (selectedStage) {
        const updated = data.stages.find(s => s.id === selectedStage.id)
        setSelectedStage(updated || null)
      }
    }).catch(() => {})
  }

  async function handleSaveStage(stageId, updates) {
    await api.updateStage(stageId, updates)
    reloadWorkflow()
  }

  async function handleDeleteStage(stageId) {
    await api.deleteStage(stageId)
    setSelectedStage(null)
    reloadWorkflow()
  }

  const stages = wfData?.stages ?? []
  const { positions, width, height } = stages.length
    ? layoutStages(stages)
    : { positions: {}, width: 600, height: 300 }

  const transitions = wfData?.transitions ?? []

  return (
    <div className="flex h-full min-h-0">
      {/* Left: Workflow list */}
      <div className="w-[200px] flex-shrink-0 border-r border-border flex flex-col bg-card">
        <div className="px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workflows</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {workflows.map(wf => (
            <button
              key={wf.id}
              onClick={() => setSelectedWfId(wf.id)}
              className={`w-full px-4 py-2.5 text-left text-sm transition-colors border-b border-border/40 flex flex-col gap-0.5 ${
                selectedWfId === wf.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-black/[0.04]'
              }`}
            >
              <span className="font-medium truncate">{wf.name}</span>
              {wf.is_system_default && (
                <span className="text-[10px] text-muted-foreground">system default</span>
              )}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-border flex-shrink-0">
          <Button
            variant="outline" size="sm"
            className="w-full text-xs"
            onClick={() => setNewWfOpen(true)}
          >
            + New Workflow
          </Button>
        </div>
      </div>

      {/* Center: Canvas */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Canvas toolbar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card flex-shrink-0">
          {wfData && (
            <>
              <span className="font-semibold text-sm">{wfData.workflow?.name}</span>
              {wfData.workflow?.is_system_default && (
                <Badge variant="brown">system default</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {stages.length} stages · {transitions.length} transitions
              </span>
            </>
          )}
          {wfData && !loadingWf && (
            <div className="ml-auto">
              <AddStagePanel
                workflowId={selectedWfId}
                stages={stages}
                onAdded={reloadWorkflow}
              />
            </div>
          )}
        </div>

        {/* Canvas body */}
        <div className="flex-1 overflow-auto bg-background/60 relative">
          {loadingWf && (
            <div className="flex items-center justify-center h-full">
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          )}

          {!loadingWf && !wfData && (
            <div className="flex items-center justify-center h-full">
              <span className="text-sm text-muted-foreground">Select a workflow to edit.</span>
            </div>
          )}

          {!loadingWf && wfData && stages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <span className="text-sm text-muted-foreground">No stages yet. Add one above.</span>
            </div>
          )}

          {!loadingWf && stages.length > 0 && (
            <div className="relative" style={{ width, height }}>
              {/* SVG edges */}
              <svg
                className="absolute inset-0 pointer-events-none"
                width={width}
                height={height}
              >
                <defs>
                  <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#9A9490" fillOpacity="0.7" />
                  </marker>
                </defs>
                {transitions.map(t => {
                  const from = positions[t.from_stage_id]
                  const to   = positions[t.to_stage_id]
                  return <EdgeArrow key={t.id} from={from} to={to} />
                })}
              </svg>

              {/* Stage nodes */}
              {stages.map(stage => (
                <StageNode
                  key={stage.id}
                  stage={stage}
                  position={positions[stage.id]}
                  selected={selectedStage?.id === stage.id}
                  onClick={setSelectedStage}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Stage Editor */}
      <StageEditor
        stage={selectedStage}
        allStages={stages}
        onSave={handleSaveStage}
        onDelete={handleDeleteStage}
        onClose={() => setSelectedStage(null)}
      />

      {/* New Workflow Modal */}
      <NewWorkflowModal
        open={newWfOpen}
        onClose={() => setNewWfOpen(false)}
        onCreated={(wf) => {
          reloadList()
          setSelectedWfId(wf.id)
        }}
      />
    </div>
  )
}
