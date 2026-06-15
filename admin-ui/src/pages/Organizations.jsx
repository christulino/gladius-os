import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { Switch }     from '@/components/ui/switch'
import { FormDrawer } from '@/components/FormDrawer'
import { WorkflowPicker } from '@/components/WorkflowPicker'
import { LoadingState, ErrorState } from '@/components/Panel'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import OrgContextLibrary from './OrgContextLibrary'
import OrgAiModels from './OrgAiModels'

// Org type → dot color (hex)
const ORG_TYPE_DOT = {
  enterprise: '#2B6645',
  program:    '#356D91',
  department: '#356D91',
  portfolio:  '#356D91',
  division:   '#2B6645',
  'feature-team':  '#6A6460',
  'platform-team': '#6A6460',
  team:       '#6A6460',
  horizontal: '#AD7B1A',
  'service-center': '#AD7B1A',
  support:    '#AD7B1A',
  system:     '#8B7355',
}

const ORG_TYPE_COLORS = {
  enterprise: 'default',
  program: 'blue',
  department: 'blue',
  'feature-team': 'muted',
  'platform-team': 'muted',
  horizontal: 'amber',
  'service-center': 'amber',
  support: 'amber',
  team: 'muted',
  portfolio: 'blue',
  division: 'default',
  system: 'brown',
}

function buildOrgTree(orgs) {
  const sorted = [...orgs].sort((a, b) => a.name.localeCompare(b.name))
  const byId = {}
  const roots = []
  for (const o of sorted) byId[o.id] = { ...o, children: [] }
  for (const o of sorted) {
    if (o.parent_id && byId[o.parent_id]) byId[o.parent_id].children.push(byId[o.id])
    else roots.push(byId[o.id])
  }
  return roots
}

// ─── Compact Tree Node ───────────────────────────────────────────────────────

function CompactTreeNode({ node, depth = 0, selectedId, onSelect }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const isSelected = node.id === selectedId
  const dotColor = ORG_TYPE_DOT[node.org_type] || '#6A6460'

  return (
    <>
      <button
        className={[
          'w-full text-left flex items-center gap-1.5 py-1.5 transition-colors',
          isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-black/[0.03]',
        ].join(' ')}
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: 8 }}
        onClick={() => onSelect(node.id)}
        title={node.org_type}
      >
        {hasChildren ? (
          <span
            className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0 cursor-pointer"
            onClick={e => { e.stopPropagation(); setExpanded(!expanded) }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: dotColor }}
          title={node.org_type}
        />
        <span className="text-xs truncate flex-1">{node.name}</span>
        {!node.is_active && <span className="text-[10px] text-muted-foreground italic flex-shrink-0">off</span>}
      </button>
      {hasChildren && expanded && node.children.map(child => (
        <CompactTreeNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  )
}

// ─── Section Pills ───────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'settings',  label: 'Settings' },
  { id: 'catalog',   label: 'Catalog' },
  { id: 'policies',  label: 'Policies' },
  { id: 'members',   label: 'Members' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'context',   label: 'Context' },
  { id: 'aimodels',  label: 'AI Models' },
]

function SectionPills({ active, onChange }) {
  return (
    <div className="w-[90px] flex-shrink-0 border-r border-border py-2">
      {SECTIONS.map(s => (
        <button
          key={s.id}
          onClick={() => onChange(s.id)}
          className={[
            'w-full text-left px-3 py-1.5 text-xs transition-colors',
            active === s.id
              ? 'text-primary font-medium bg-primary/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/[0.03]',
          ].join(' ')}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

// ─── Settings Section ────────────────────────────────────────────────────────

function SettingsSection({ org, onSaved }) {
  const [values, setValues] = useState({})
  const [status, setStatus] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    setValues({
      name: org.name || '',
      description: org.description || '',
      org_type: org.org_type || '',
      parent_id: org.parent_id || '',
      is_active: org.is_active ?? true,
    })
  }, [org.id])

  const { data: orgTypes } = useApi(() => api.orgTypes())
  const { data: orgs } = useApi(() => api.organizations())

  const save = useCallback(async (patch) => {
    setStatus('Saving...')
    try {
      await api.updateOrganization(org.id, {
        ...patch,
        parent_id: patch.parent_id ? parseInt(patch.parent_id) : null,
      })
      setStatus('Saved')
      onSaved?.()
      setTimeout(() => setStatus(null), 1500)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }, [org.id, onSaved])

  const debounceSave = useCallback((patch) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(patch), 400)
  }, [save])

  function update(key, value) {
    setValues(v => ({ ...v, [key]: value }))
    if (key === 'description') {
      debounceSave({ [key]: value })
    } else {
      save({ [key]: value })
    }
  }

  const typeOptions = orgTypes?.rows?.filter(t => t.slug !== 'system' && t.is_active).map(t => ({ label: t.name, value: t.slug })) || []
  const orgOptions = orgs?.rows?.filter(o => o.id !== org.id).map(o => ({ label: o.name, value: o.id })) || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Settings</span>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</span>
        <input
          className="mt-1 w-full bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          value={values.name}
          onChange={e => setValues(v => ({ ...v, name: e.target.value }))}
          onBlur={() => values.name !== org.name && save({ name: values.name })}
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</span>
        <textarea
          className="mt-1 w-full bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
          value={values.description}
          onChange={e => update('description', e.target.value)}
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</span>
        <select
          className="mt-1 w-full bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          value={values.org_type}
          onChange={e => update('org_type', e.target.value)}
        >
          <option value="">—</option>
          {typeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parent Org</span>
        <select
          className="mt-1 w-full bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          value={values.parent_id}
          onChange={e => update('parent_id', e.target.value)}
        >
          <option value="">None (top-level)</option>
          {orgOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</span>
        <Switch checked={values.is_active} onCheckedChange={v => update('is_active', v)} />
      </div>

      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Slug</span>
        <div className="mt-1 text-xs text-muted-foreground">{org.slug}</div>
      </div>
    </div>
  )
}

// ─── Catalog Section ─────────────────────────────────────────────────────────

function CatalogSection({ orgId, setTab }) {
  const { data, loading, error, reload } = useApi(() => api.serviceLibrary(orgId), [orgId])
  const { data: workflowsData } = useApi(() => api.workflows())
  const { data: classesData } = useApi(() => api.witClasses())
  const { data: catalogData, reload: reloadCatalog } = useApi(() => api.catalogItems(orgId), [orgId])
  const [adding, setAdding] = useState(false)
  const [addClassId, setAddClassId] = useState('')
  const [addName, setAddName] = useState('')
  const [addPrefix, setAddPrefix] = useState('')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const rows = data?.rows || []
  const workflows = workflowsData?.rows || []
  const classes = classesData?.rows || []
  const catalogItems = catalogData?.rows || []

  // Map type_id → catalog item for quick lookup
  const catalogByTypeId = {}
  for (const ci of catalogItems) catalogByTypeId[ci.work_item_type_id] = ci

  const grouped = {}
  for (const r of rows) {
    if (!grouped[r.class_name]) grouped[r.class_name] = []
    grouped[r.class_name].push(r)
  }

  async function addType() {
    if (!addClassId || !addName.trim()) return
    try {
      await api.createWitType({
        name: addName.trim(),
        class_id: parseInt(addClassId),
        owner_org_id: orgId,
        key_prefix: addPrefix.trim().toUpperCase() || null,
        is_published: true,
      })
      setAdding(false)
      setAddClassId('')
      setAddName('')
      setAddPrefix('')
      reload()
    } catch (err) { console.error(err) }
  }

  async function suspendType(id) {
    try {
      await api.updateWitType(id, { is_active: false })
      reload()
    } catch (err) { console.error(err) }
  }

  async function changeWorkflow(typeId, workflowId) {
    try {
      await api.updateWitType(typeId, { workflow_id: workflowId ? parseInt(workflowId) : null })
      reload()
    } catch (err) { console.error(err) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Service Catalog</span>
        <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ Add Type'}
        </Button>
      </div>

      {/* Add type form */}
      {adding && (
        <div className="border border-border rounded p-3 space-y-2 bg-muted/20">
          <div className="flex items-center gap-2">
            <select
              className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-xs"
              value={addClassId}
              onChange={e => setAddClassId(e.target.value)}
            >
              <option value="">Select class...</option>
              {classes.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-xs"
              placeholder="Type name"
              value={addName}
              onChange={e => setAddName(e.target.value)}
            />
            <input
              className="w-16 bg-background border border-border rounded px-2 py-1.5 text-xs"
              placeholder="KEY"
              value={addPrefix}
              onChange={e => setAddPrefix(e.target.value)}
              maxLength={6}
            />
            <Button size="sm" className="text-xs h-7" onClick={addType} disabled={!addClassId || !addName.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Type list */}
      {!rows.length && !adding && (
        <div className="text-xs text-muted-foreground py-8 text-center">No types in this org's catalog</div>
      )}

      {Object.entries(grouped).map(([cls, types]) => (
        <div key={cls}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">{cls}</div>
          <div className="space-y-0.5">
            {types.map(t => (
              <CatalogTypeRow
                key={t.id}
                type={t}
                workflows={workflows}
                onSuspend={suspendType}
                onChangeWorkflow={changeWorkflow}
                setTab={setTab}
                catalogItem={catalogByTypeId[t.id]}
                onCatalogUpdate={() => { reload(); reloadCatalog() }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CatalogTypeRow({ type: t, workflows, onSuspend, onChangeWorkflow, setTab, catalogItem, onCatalogUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [slugDraft, setSlugDraft] = useState(catalogItem?.external_slug || '')
  const [publishing, setPublishing] = useState(false)

  const formUrl = catalogItem?.external_slug
    ? `${window.location.origin}/intake/${catalogItem.external_slug}`
    : null

  async function togglePublicForm() {
    setPublishing(true)
    try {
      if (catalogItem) {
        // Toggle is_external
        await api.updateCatalogItem(catalogItem.id, { is_external: !catalogItem.is_external })
      } else {
        // Create new catalog item with external access
        const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        await api.createCatalogItem({
          name: t.name,
          description: t.description || '',
          owner_org_id: t.owner_org_id,
          work_item_type_id: t.id,
          is_internal: true,
          is_external: true,
          external_slug: slug,
        })
        setSlugDraft(slug)
      }
      onCatalogUpdate?.()
    } catch (err) { console.error(err) }
    finally { setPublishing(false) }
  }

  async function updateSlug() {
    if (!catalogItem || !slugDraft.trim()) return
    try {
      await api.updateCatalogItem(catalogItem.id, { external_slug: slugDraft.trim() })
      onCatalogUpdate?.()
    } catch (err) { console.error(err) }
  }

  return (
    <div className="border border-border/50 rounded">
      <button
        className="w-full text-left flex items-center gap-2 py-2 px-2.5 hover:bg-black/[0.03] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Icon or color dot */}
        {t.icon ? (
          <span className="text-sm flex-shrink-0">{t.icon}</span>
        ) : t.color ? (
          <span className="w-3 h-3 rounded flex-shrink-0" style={{ backgroundColor: t.color }} />
        ) : (
          <span className="w-3 h-3 rounded flex-shrink-0 bg-muted" />
        )}

        <span className="text-xs font-medium flex-1 truncate">{t.name}</span>

        {catalogItem?.is_external && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">Form</span>
        )}

        {t.key_prefix && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{t.key_prefix}.*</span>
        )}

        {t.current_workflow_name && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0 truncate max-w-[120px]">
            {t.current_workflow_name}
          </span>
        )}

        <span className="text-[10px] text-muted-foreground flex-shrink-0">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/30 pt-2">
          {t.description && (
            <div className="text-xs text-muted-foreground">{t.description}</div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Workflow</span>
            <span className="text-xs flex-1 truncate">{t.current_workflow_name || <span className="italic text-muted-foreground">None</span>}</span>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-6"
              onClick={() => setPickerOpen(true)}
            >
              Change
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Prefix</span>
            <span className="text-xs">{t.key_prefix || '—'}</span>
          </div>

          {/* Public Intake Form */}
          <div className="border-t border-border/30 pt-2 mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Intake</span>
              <Switch
                checked={catalogItem?.is_external || false}
                onCheckedChange={togglePublicForm}
                disabled={publishing}
              />
              <span className="text-xs text-muted-foreground flex-1">
                {catalogItem?.is_external ? 'Public form enabled' : 'No public form'}
              </span>
            </div>

            {catalogItem?.is_external && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Slug</span>
                  <input
                    className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs"
                    value={slugDraft}
                    onChange={e => setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    onBlur={updateSlug}
                    onKeyDown={e => e.key === 'Enter' && updateSlug()}
                    placeholder="url-slug"
                  />
                </div>
                {formUrl && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16 flex-shrink-0">URL</span>
                    <a
                      href={formUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline truncate"
                    >
                      {formUrl}
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-6 flex-shrink-0"
                      onClick={() => navigator.clipboard.writeText(formUrl)}
                    >
                      Copy
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-6"
              onClick={() => setTab?.('workitems')}
            >
              View Items
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-6 text-destructive hover:text-destructive"
              onClick={() => onSuspend(t.id)}
            >
              Suspend
            </Button>
          </div>
        </div>
      )}

      <WorkflowPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        workflows={workflows}
        currentWorkflowId={t.current_workflow_id}
        onSelect={wfId => onChangeWorkflow(t.id, wfId)}
      />
    </div>
  )
}

// ─── Policies Section ────────────────────────────────────────────────────────

const STAGE_CLASS_DOT = {
  'intake': '#3B82F6', 'triage': '#F59E0B', 'queued': '#8B5CF6',
  'in-progress': '#10B981', 'blocked': '#EF4444', 'review': '#14B8A6',
  'approved': '#6366F1', 'delivery': '#6366F1', 'done': '#84CC16', 'cancelled': '#94A3B8',
}

const STAGE_CLASS_LABELS = {
  'intake': 'Intake', 'triage': 'Triage', 'queued': 'Queued',
  'in-progress': 'In Progress', 'blocked': 'Blocked', 'review': 'Review',
  'approved': 'Approved', 'delivery': 'Delivery', 'done': 'Done', 'cancelled': 'Cancelled',
}

const POLICY_TABS = [
  { id: 'wip', label: 'WIP Limits' },
  { id: 'rules', label: 'Stage Rules' },
]

function PoliciesSection({ orgId, org, onSaved }) {
  const { data, loading, error, reload } = useApi(() => api.orgPolicyData(orgId), [orgId])
  const [retention, setRetention] = useState(String(org?.done_retention_days ?? 14))
  const [policyTab, setPolicyTab] = useState('wip')
  const [drawerStage, setDrawerStage] = useState(null)
  const [drawerTransitions, setDrawerTransitions] = useState([])

  useEffect(() => { setRetention(String(org?.done_retention_days ?? 14)) }, [org?.done_retention_days])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const workflows = data?.workflows || []
  const wipLimits = data?.wip_limits || {}
  const wipClassLimits = data?.wip_class_limits || {}

  async function saveRetention() {
    const val = Math.max(0, parseInt(retention) || 0)
    try {
      await api.updateOrganization(orgId, { done_retention_days: val })
      onSaved?.()
    } catch (err) { console.error(err) }
  }

  async function saveWipLimit(stageName, wipLimit, enforcement = 'soft') {
    try {
      const val = parseInt(wipLimit)
      if (!val || val <= 0) {
        const existing = wipLimits[stageName]
        if (existing) await api.deleteOrgWipLimit(existing.id)
      } else {
        await api.setOrgWipLimit({ org_id: orgId, stage_name: stageName, wip_limit: val, enforcement })
      }
      reload()
    } catch (err) { console.error(err) }
  }

  async function saveWipClassLimit(stageClass, wipLimit, enforcement = 'soft') {
    try {
      const val = parseInt(wipLimit)
      if (!val || val <= 0) {
        const existing = wipClassLimits[stageClass]
        if (existing) await api.deleteOrgWipClassLimit(existing.id)
      } else {
        await api.setOrgWipClassLimit({ org_id: orgId, stage_class: stageClass, wip_limit: val, enforcement })
      }
      reload()
    } catch (err) { console.error(err) }
  }

  function openStageRules(stage, transitions) {
    setDrawerStage(stage)
    setDrawerTransitions(transitions)
  }

  return (
    <div className="space-y-5">
      {/* Board Policies */}
      <div className="space-y-3">
        <span className="text-sm font-semibold">Board</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-40">Completed item retention</span>
          <input
            className="w-16 bg-background border border-border rounded px-2 py-1 text-xs"
            type="number"
            min="0"
            value={retention}
            onChange={e => setRetention(e.target.value)}
            onBlur={saveRetention}
            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
          />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
      </div>

      {/* Policy sub-tabs */}
      <div className="flex gap-0 border-b border-border">
        {POLICY_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setPolicyTab(t.id)}
            className={[
              'px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors',
              policyTab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {workflows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">No workflows assigned to this org's types</p>
      ) : policyTab === 'wip' ? (
        <WipLimitsView
          workflows={workflows}
          wipLimits={wipLimits}
          wipClassLimits={wipClassLimits}
          onSaveWipLimit={saveWipLimit}
          onSaveWipClassLimit={saveWipClassLimit}
        />
      ) : (
        <StageRulesView
          workflows={workflows}
          onOpenStageRules={openStageRules}
        />
      )}

      <StageRulesDrawer
        stage={drawerStage}
        transitions={drawerTransitions}
        open={!!drawerStage}
        onOpenChange={open => { if (!open) { setDrawerStage(null); setDrawerTransitions([]) } }}
        onChanged={reload}
      />
    </div>
  )
}

// ─── WIP Limits View ──────────────────────────────────────────────────────────

function WipLimitsView({ workflows, wipLimits, wipClassLimits, onSaveWipLimit, onSaveWipClassLimit }) {
  // Build hierarchical: stage_class → stages (deduplicated across workflows)
  const hierarchy = useMemo(() => {
    const classMap = new Map() // stage_class → { stages: Map<name, {stage_class, display_order}> }
    for (const wf of workflows) {
      for (const s of (wf.stages || [])) {
        if (s.is_entry_stage || s.is_terminal) continue
        if (!classMap.has(s.stage_class)) classMap.set(s.stage_class, new Map())
        const stages = classMap.get(s.stage_class)
        if (!stages.has(s.name) || s.display_order < stages.get(s.name).display_order) {
          stages.set(s.name, { display_order: s.display_order })
        }
      }
    }
    return [...classMap.entries()]
      .sort((a, b) => {
        const aMin = Math.min(...[...a[1].values()].map(v => v.display_order))
        const bMin = Math.min(...[...b[1].values()].map(v => v.display_order))
        return aMin - bMin
      })
      .map(([cls, stagesMap]) => ({
        stage_class: cls,
        stages: [...stagesMap.entries()]
          .sort((a, b) => a[1].display_order - b[1].display_order)
          .map(([name]) => name),
      }))
  }, [workflows])

  return (
    <div className="space-y-0">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-3">
        org policy — limits apply to this org only
      </p>
      {hierarchy.map(group => (
        <WipClassGroup
          key={group.stage_class}
          stageClass={group.stage_class}
          stageNames={group.stages}
          classLimit={wipClassLimits[group.stage_class]}
          wipLimits={wipLimits}
          onSaveClassLimit={onSaveWipClassLimit}
          onSaveStageLimit={onSaveWipLimit}
        />
      ))}
    </div>
  )
}

function WipClassGroup({ stageClass, stageNames, classLimit, wipLimits, onSaveClassLimit, onSaveStageLimit }) {
  const [classVal, setClassVal] = useState(classLimit ? String(classLimit.wip_limit) : '')
  const [classEnf, setClassEnf] = useState(classLimit?.enforcement_type || 'soft')

  useEffect(() => {
    setClassVal(classLimit ? String(classLimit.wip_limit) : '')
    setClassEnf(classLimit?.enforcement_type || 'soft')
  }, [classLimit?.wip_limit, classLimit?.enforcement_type])

  const dotColor = STAGE_CLASS_DOT[stageClass] || '#94A3B8'
  const label = STAGE_CLASS_LABELS[stageClass] || stageClass
  const hasMultipleStages = stageNames.length > 1

  function handleClassBlur() {
    const current = classLimit ? String(classLimit.wip_limit) : ''
    if (classVal !== current) onSaveClassLimit(stageClass, classVal, classEnf)
  }

  function handleClassEnfChange(e) {
    const newEnf = e.target.value
    setClassEnf(newEnf)
    if (classLimit) onSaveClassLimit(stageClass, classVal || classLimit.wip_limit, newEnf)
  }

  return (
    <div className="mb-2">
      {/* Class-level row */}
      <div className="flex items-center gap-2 py-1.5 bg-muted/20 rounded px-2">
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: dotColor }} />
        <span className="text-xs font-medium flex-1">{label}</span>
        {hasMultipleStages && (
          <span className="text-[10px] text-muted-foreground">{stageNames.length} stages</span>
        )}
        <div className="flex items-center gap-1">
          <input
            className="w-12 bg-background border border-border rounded px-1.5 py-0.5 text-xs text-center"
            type="number"
            placeholder="—"
            value={classVal}
            onChange={e => setClassVal(e.target.value)}
            onBlur={handleClassBlur}
            onKeyDown={e => e.key === 'Enter' && e.target.blur()}
            title="Class-level WIP limit"
          />
          <select
            className="bg-background border border-border rounded px-1 py-0.5 text-[10px] text-muted-foreground"
            value={classEnf}
            onChange={handleClassEnfChange}
          >
            <option value="soft">soft</option>
            <option value="hard">hard</option>
          </select>
        </div>
      </div>

      {/* Stage-level rows (indented) */}
      {stageNames.map(name => (
        <WipStageRow
          key={name}
          stageName={name}
          stageClass={stageClass}
          limit={wipLimits[name]}
          onSave={onSaveStageLimit}
        />
      ))}
    </div>
  )
}

function WipStageRow({ stageName, stageClass, limit, onSave }) {
  const [val, setVal] = useState(limit ? String(limit.wip_limit) : '')
  const [enforcement, setEnforcement] = useState(limit?.enforcement_type || 'soft')

  useEffect(() => {
    setVal(limit ? String(limit.wip_limit) : '')
    setEnforcement(limit?.enforcement_type || 'soft')
  }, [limit?.wip_limit, limit?.enforcement_type])

  function handleBlur() {
    const current = limit ? String(limit.wip_limit) : ''
    if (val !== current) onSave(stageName, val, enforcement)
  }

  function handleEnfChange(e) {
    const newEnf = e.target.value
    setEnforcement(newEnf)
    if (limit) onSave(stageName, val || limit.wip_limit, newEnf)
  }

  return (
    <div className="flex items-center gap-2 py-1 ml-5 pl-3 border-l border-border/40">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: STAGE_CLASS_DOT[stageClass] || '#94A3B8', opacity: 0.5 }} />
      <span className="text-xs text-foreground flex-1">{stageName}</span>
      <div className="flex items-center gap-1">
        <input
          className="w-12 bg-background border border-border rounded px-1.5 py-0.5 text-xs text-center"
          type="number"
          placeholder="—"
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        />
        <select
          className="bg-background border border-border rounded px-1 py-0.5 text-[10px] text-muted-foreground"
          value={enforcement}
          onChange={handleEnfChange}
        >
          <option value="soft">soft</option>
          <option value="hard">hard</option>
        </select>
      </div>
    </div>
  )
}

// ─── Stage Rules View ─────────────────────────────────────────────────────────

function StageRulesView({ workflows, onOpenStageRules }) {
  return (
    <div className="space-y-4">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
        workflow policy — applies to all orgs using each workflow
      </p>
      {workflows.map(wf => (
        <StageRulesWorkflow key={wf.id} workflow={wf} onOpenStageRules={onOpenStageRules} />
      ))}
    </div>
  )
}

function StageRulesWorkflow({ workflow, onOpenStageRules }) {
  const [expanded, setExpanded] = useState(true)
  const stages = (workflow.stages || []).filter(s => !s.is_entry_stage)

  return (
    <div>
      <button
        className="flex items-center gap-2 w-full text-left py-1"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs text-muted-foreground">{expanded ? '▾' : '▸'}</span>
        <span className="text-xs font-semibold flex-1">{workflow.name}</span>
        {workflow.is_system_default && <Badge variant="default" className="text-[10px]">system</Badge>}
      </button>

      {expanded && (
        <div className="ml-1 border-l border-border/60 pl-3 space-y-0">
          {stages.map(stage => {
            const transitions = stage.transitions || []
            const exitCount = stage.exit_criteria_count || 0
            const actionCount = transitions.reduce((sum, t) => sum + (t.actions?.length || 0), 0)
            const ruleCount = exitCount + actionCount
            const dotColor = STAGE_CLASS_DOT[stage.stage_class] || '#94A3B8'

            return (
              <button
                key={stage.id}
                className="w-full text-left flex items-center gap-2 py-1.5 px-1 rounded hover:bg-black/[0.03] transition-colors group"
                onClick={() => onOpenStageRules(stage, transitions)}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
                <span className="text-xs flex-1">{stage.name}</span>
                {stage.is_terminal && <Badge variant="muted" className="text-[9px] px-1 py-0">terminal</Badge>}
                {exitCount > 0 && (
                  <span className="text-[10px] text-primary font-medium">{exitCount} condition{exitCount !== 1 ? 's' : ''}</span>
                )}
                {actionCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">{actionCount} action{actionCount !== 1 ? 's' : ''}</span>
                )}
                {ruleCount === 0 && (
                  <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">+ add rules</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Stage Rules Drawer ───────────────────────────────────────────────────────

function StageRulesDrawer({ stage, transitions, open, onOpenChange, onChanged }) {
  const [tab, setTab] = useState('conditions')

  // Reset tab when stage changes
  useEffect(() => { setTab('conditions') }, [stage?.id])

  if (!stage) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 w-[480px]">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STAGE_CLASS_DOT[stage.stage_class] || '#94A3B8' }} />
            {stage.name}
          </SheetTitle>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
            workflow policy — applies to all orgs using this workflow
          </p>
        </SheetHeader>

        {/* Tabs */}
        <div className="flex border-b border-border px-4">
          <button
            onClick={() => setTab('conditions')}
            className={[
              'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              tab === 'conditions' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            Exit Conditions
          </button>
          <button
            onClick={() => setTab('actions')}
            className={[
              'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
              tab === 'actions' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            Transition Actions
          </button>
        </div>

        {tab === 'conditions' ? (
          <ExitConditionsPanel stageId={stage.id} onChanged={onChanged} />
        ) : (
          <TransitionActionsPanel transitions={transitions} onChanged={onChanged} />
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Exit Conditions Panel ────────────────────────────────────────────────────

function ExitConditionsPanel({ stageId, onChanged }) {
  const { data, loading, reload } = useApi(
    () => stageId ? api.exitCriteria(stageId) : Promise.resolve({ rows: [] }),
    [stageId]
  )
  const [adding, setAdding] = useState(false)
  const [addType, setAddType] = useState('manual')
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addCondition, setAddCondition] = useState('')
  const [addEndpoint, setAddEndpoint] = useState('')

  const criteria = data?.rows || []

  async function addCriteria() {
    if (!addName.trim()) return
    try {
      const payload = {
        stage_id: stageId,
        name: addName.trim(),
        description: addDesc.trim() || null,
        criteria_tier: addType,
        is_blocking: true,
      }
      if (addType === 'codified' && addCondition.trim()) {
        try { payload.codified_condition = JSON.parse(addCondition) } catch {}
      }
      if (addType === 'api' && addEndpoint.trim()) {
        payload.api_endpoint = addEndpoint.trim()
        payload.api_method = 'GET'
      }
      await api.createExitCriteria(payload)
      resetAddForm()
      reload()
      onChanged?.()
    } catch (err) { console.error(err) }
  }

  function resetAddForm() {
    setAdding(false)
    setAddName('')
    setAddDesc('')
    setAddCondition('')
    setAddEndpoint('')
    setAddType('manual')
  }

  async function toggleActive(c) {
    try {
      if (c.is_active) await api.deleteExitCriteria(c.id)
      else await api.updateExitCriteria(c.id, { is_active: true })
      reload()
      onChanged?.()
    } catch (err) { console.error(err) }
  }

  async function toggleBlocking(c) {
    try {
      await api.updateExitCriteria(c.id, { is_blocking: !c.is_blocking })
      reload()
    } catch (err) { console.error(err) }
  }

  const tierLabel = { manual: 'Manual sign-off', codified: 'System check', api: 'API gate' }
  const tierBadge = { manual: 'muted', codified: 'blue', api: 'amber' }
  const tierDesc = {
    manual: 'Human acknowledges this condition is met before work can proceed.',
    codified: 'System evaluates a condition: required field, child items complete, checklist done.',
    api: 'External system returns pass/fail via API call.',
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? <LoadingState /> : criteria.length === 0 && !adding ? (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground mb-1">No exit conditions defined</p>
            <p className="text-[10px] text-muted-foreground/60">Work can leave this stage without restrictions</p>
          </div>
        ) : (
          criteria.map(c => (
            <div key={c.id} className={`border border-border/60 rounded p-2.5 space-y-1.5 ${!c.is_active ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium flex-1">{c.name}</span>
                <Badge variant={tierBadge[c.criteria_tier] || 'muted'} className="text-[9px]">
                  {c.criteria_tier}
                </Badge>
                {c.is_blocking ? (
                  <span className="text-[9px] text-destructive font-medium">blocks</span>
                ) : (
                  <span className="text-[9px] text-muted-foreground">advisory</span>
                )}
              </div>
              {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
              {c.codified_condition && (
                <ConditionSummary condition={c.codified_condition} />
              )}
              {c.api_endpoint && (
                <div className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
                  {c.api_method || 'GET'} {c.api_endpoint}
                </div>
              )}
              <div className="flex items-center gap-3 pt-0.5">
                <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => toggleBlocking(c)}>
                  {c.is_blocking ? 'Make advisory' : 'Make blocking'}
                </button>
                <button className="text-[10px] text-muted-foreground hover:text-destructive" onClick={() => toggleActive(c)}>
                  {c.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))
        )}

        {adding && (
          <div className="border border-primary/30 rounded p-3 space-y-2 bg-primary/5">
            <div className="text-xs font-medium">New Exit Condition</div>

            {/* Type selector */}
            <div className="flex gap-1">
              {['manual', 'codified', 'api'].map(t => (
                <button
                  key={t}
                  onClick={() => setAddType(t)}
                  className={[
                    'text-[10px] px-2 py-1 rounded border transition-colors',
                    addType === t ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  {tierLabel[t]}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{tierDesc[addType]}</p>

            <input
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
              placeholder="Condition name"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              autoFocus
            />
            <input
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
              placeholder="Description (optional)"
              value={addDesc}
              onChange={e => setAddDesc(e.target.value)}
            />

            {addType === 'codified' && (
              <>
                <select
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
                  value={addCondition ? '' : ''}
                  onChange={e => {
                    const templates = {
                      field_value: '{"type":"field_value","field_key":"","operator":"gt","value":0}',
                      child_items_terminal: '{"type":"child_items_terminal","work_item_type_id":null}',
                      checklist_complete: '{"type":"checklist_complete","checklist_id":null}',
                    }
                    if (templates[e.target.value]) setAddCondition(templates[e.target.value])
                  }}
                >
                  <option value="">Select condition type...</option>
                  <option value="field_value">Field has value</option>
                  <option value="child_items_terminal">Child items complete</option>
                  <option value="checklist_complete">Checklist complete</option>
                </select>
                <textarea
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs min-h-[60px]"
                  placeholder="Condition JSON"
                  value={addCondition}
                  onChange={e => setAddCondition(e.target.value)}
                />
              </>
            )}

            {addType === 'api' && (
              <input
                className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
                placeholder="API endpoint URL"
                value={addEndpoint}
                onChange={e => setAddEndpoint(e.target.value)}
              />
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" className="text-xs h-7" onClick={addCriteria} disabled={!addName.trim()}>Add Condition</Button>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={resetAddForm}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {!adding && (
        <div className="px-4 py-3 border-t border-border">
          <Button size="sm" variant="outline" className="text-xs h-7 w-full" onClick={() => setAdding(true)}>
            + Add Exit Condition
          </Button>
        </div>
      )}
    </div>
  )
}

function ConditionSummary({ condition }) {
  if (!condition) return null
  const c = typeof condition === 'string' ? JSON.parse(condition) : condition
  let text = ''
  if (c.type === 'field_value') {
    text = `Field "${c.field_key}" ${c.operator} ${JSON.stringify(c.value)}`
  } else if (c.type === 'child_items_terminal') {
    text = `All child items${c.work_item_type_id ? ` of type #${c.work_item_type_id}` : ''} must be complete`
  } else if (c.type === 'checklist_complete') {
    text = `Checklist${c.checklist_id ? ` #${c.checklist_id}` : ''} must be fully checked`
  } else {
    text = JSON.stringify(c)
  }
  return <div className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1">{text}</div>
}

// ─── Transition Actions Panel ─────────────────────────────────────────────────

function TransitionActionsPanel({ transitions, onChanged }) {
  const [adding, setAdding] = useState(null) // transition id being added to
  const [addType, setAddType] = useState('spawn')
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')

  // Spawn fields
  const [spawnTypeId, setSpawnTypeId] = useState('')
  const [spawnOrgId, setSpawnOrgId] = useState('')

  // API fields
  const [apiEndpoint, setApiEndpoint] = useState('')
  const [apiMethod, setApiMethod] = useState('POST')

  const { data: typesData } = useApi(() => api.witTypes())
  const { data: orgsData } = useApi(() => api.organizations())

  const types = typesData?.rows || []
  const orgs = orgsData?.rows || []

  function resetForm() {
    setAdding(null)
    setAddType('spawn')
    setAddName('')
    setAddDesc('')
    setSpawnTypeId('')
    setSpawnOrgId('')
    setApiEndpoint('')
    setApiMethod('POST')
  }

  async function createAction(transitionId) {
    if (!addName.trim()) return
    try {
      const payload = {
        stage_transition_id: transitionId,
        name: addName.trim(),
        description: addDesc.trim() || null,
        action_type: addType,
      }
      if (addType === 'spawn' || addType === 'optional_spawn') {
        if (spawnTypeId) payload.spawn_work_item_type_id = parseInt(spawnTypeId)
        if (spawnOrgId) payload.spawn_target_org_id = parseInt(spawnOrgId)
        if (addType === 'optional_spawn') {
          payload.optional_spawn_prompt = addDesc.trim() || `Create ${addName.trim()}?`
        }
      }
      if (addType === 'api_call') {
        payload.api_endpoint = apiEndpoint.trim()
        payload.api_method = apiMethod
      }
      await api.createTransitionAction(payload)
      resetForm()
      onChanged?.()
    } catch (err) { console.error(err) }
  }

  async function deleteAction(id) {
    try {
      await api.deleteTransitionAction(id)
      onChanged?.()
    } catch (err) { console.error(err) }
  }

  const actionTypeLabel = { spawn: 'Create Work Item', optional_spawn: 'Prompt to Create', api_call: 'API Call', notify: 'Notification' }
  const actionTypeBadge = { spawn: 'default', optional_spawn: 'blue', api_call: 'amber', notify: 'muted' }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {transitions.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">No outbound transitions from this stage</p>
      ) : (
        transitions.map(t => (
          <div key={t.id} className="space-y-2">
            {/* Transition header */}
            <div className="flex items-center gap-2 py-1">
              <span className="text-xs text-muted-foreground">→</span>
              <span className="text-xs font-medium flex-1">{t.transition_label || t.to_stage_name}</span>
              <Badge variant={t.transition_kind === 'forward' ? 'default' : t.transition_kind === 'backward' ? 'amber' : 'blue'} className="text-[9px] px-1 py-0">
                {t.transition_kind}
              </Badge>
              {t.requires_reason && <span className="text-[9px] text-muted-foreground">requires reason</span>}
            </div>

            {/* Existing actions */}
            {(t.actions || []).map(a => (
              <div key={a.id} className="ml-4 border border-border/60 rounded p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium flex-1">{a.name}</span>
                  <Badge variant={actionTypeBadge[a.action_type] || 'muted'} className="text-[9px]">
                    {actionTypeLabel[a.action_type] || a.action_type}
                  </Badge>
                  <button className="text-[10px] text-muted-foreground hover:text-destructive" onClick={() => deleteAction(a.id)}>×</button>
                </div>
                {a.description && <p className="text-[10px] text-muted-foreground">{a.description}</p>}
                {a.spawn_type_name && (
                  <div className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
                    Creates: {a.spawn_type_name}{a.spawn_target_org_name ? ` in ${a.spawn_target_org_name}` : ''}
                  </div>
                )}
                {a.api_endpoint && (
                  <div className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
                    {a.api_method || 'POST'} {a.api_endpoint}
                  </div>
                )}
              </div>
            ))}

            {/* Add action form */}
            {adding === t.id ? (
              <div className="ml-4 border border-primary/30 rounded p-3 space-y-2 bg-primary/5">
                <div className="text-xs font-medium">New Action</div>
                <div className="flex gap-1">
                  {['spawn', 'optional_spawn', 'api_call'].map(at => (
                    <button
                      key={at}
                      onClick={() => setAddType(at)}
                      className={[
                        'text-[10px] px-2 py-1 rounded border transition-colors',
                        addType === at ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:text-foreground',
                      ].join(' ')}
                    >
                      {actionTypeLabel[at]}
                    </button>
                  ))}
                </div>

                <input
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
                  placeholder="Action name"
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  autoFocus
                />
                <input
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
                  placeholder={addType === 'optional_spawn' ? 'Prompt text (e.g. "Create estimation request?")' : 'Description (optional)'}
                  value={addDesc}
                  onChange={e => setAddDesc(e.target.value)}
                />

                {(addType === 'spawn' || addType === 'optional_spawn') && (
                  <div className="space-y-2">
                    <select
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
                      value={spawnTypeId}
                      onChange={e => setSpawnTypeId(e.target.value)}
                    >
                      <option value="">Select work item type to create...</option>
                      {types.filter(t => t.is_active).map(t => (
                        <option key={t.id} value={t.id}>{t.name}{t.owner_org_name ? ` (${t.owner_org_name})` : ''}</option>
                      ))}
                    </select>
                    <select
                      className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs"
                      value={spawnOrgId}
                      onChange={e => setSpawnOrgId(e.target.value)}
                    >
                      <option value="">Target org (same as source)</option>
                      {orgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {addType === 'api_call' && (
                  <div className="flex gap-2">
                    <select
                      className="bg-background border border-border rounded px-2 py-1.5 text-xs w-24"
                      value={apiMethod}
                      onChange={e => setApiMethod(e.target.value)}
                    >
                      <option>GET</option>
                      <option>POST</option>
                      <option>PUT</option>
                      <option>PATCH</option>
                    </select>
                    <input
                      className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-xs"
                      placeholder="https://..."
                      value={apiEndpoint}
                      onChange={e => setApiEndpoint(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" className="text-xs h-7" onClick={() => createAction(t.id)} disabled={!addName.trim()}>Add Action</Button>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={resetForm}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button
                className="ml-4 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                onClick={() => { resetForm(); setAdding(t.id) }}
              >
                + add action
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ─── Members Section ─────────────────────────────────────────────────────────

function MembersSection({ orgId }) {
  const { data, loading, error, reload } = useApi(() => api.orgMembers(orgId), [orgId])
  const { data: usersData } = useApi(() => api.users())
  const { data: rolesData } = useApi(() => api.roles())
  const [search, setSearch] = useState('')
  const [addRoleId, setAddRoleId] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const members = data?.rows || []
  const allUsers = usersData?.rows || []
  const roles = rolesData?.rows || []
  const memberUserIds = new Set(members.map(m => m.user_id))
  const nonMembers = allUsers.filter(u => !memberUserIds.has(u.id) && u.is_active !== false)

  const searchResults = search.trim().length >= 2
    ? nonMembers.filter(u =>
        u.display_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8)
    : []

  async function addMember(userId) {
    const roleId = addRoleId || (roles.length ? roles.find(r => r.name === 'Member')?.id || roles[0].id : null)
    if (!roleId) return
    try {
      await api.addOrgMember({ org_id: orgId, user_id: userId, role_id: parseInt(roleId) })
      setSearch('')
      reload()
    } catch (err) { console.error(err) }
  }

  async function changeRole(membershipId, roleId) {
    try {
      await api.updateOrgMember(membershipId, { role_id: parseInt(roleId) })
      reload()
    } catch (err) { console.error(err) }
  }

  async function remove(membershipId) {
    try {
      await api.removeOrgMember(membershipId)
      reload()
    } catch (err) { console.error(err) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Members</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{members.length}</span>
          <Button size="sm" variant="outline" className="text-xs h-6" onClick={() => setShowSearch(!showSearch)}>
            {showSearch ? 'Cancel' : '+ Add'}
          </Button>
        </div>
      </div>

      {/* Search-based add member */}
      {showSearch && (
        <div className="space-y-1.5 border border-border rounded p-2.5 bg-muted/20">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Search by name or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            <select
              className="bg-background border border-border rounded px-2 py-1.5 text-xs w-28"
              value={addRoleId}
              onChange={e => setAddRoleId(e.target.value)}
            >
              <option value="">Role...</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {searchResults.length > 0 && (
            <div className="border border-border rounded bg-card max-h-[200px] overflow-y-auto">
              {searchResults.map(u => (
                <button
                  key={u.id}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 hover:bg-black/[0.03] transition-colors"
                  onClick={() => addMember(u.id)}
                >
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-medium flex-shrink-0">
                    {(u.display_name || '?')[0].toUpperCase()}
                  </span>
                  <span className="text-xs flex-1 truncate">{u.display_name}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>
                </button>
              ))}
            </div>
          )}
          {search.trim().length >= 2 && searchResults.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-2">No matching users</div>
          )}
        </div>
      )}

      {/* Member list */}
      <div className="space-y-0.5">
        {members.map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-black/[0.03] group">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-medium flex-shrink-0">
              {(m.display_name || '?')[0].toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{m.display_name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{m.email}</div>
            </div>
            <select
              className="bg-background border border-border rounded px-1.5 py-0.5 text-xs"
              value={m.role_id}
              onChange={e => changeRole(m.id, e.target.value)}
            >
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button
              className="text-muted-foreground hover:text-destructive text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => remove(m.id)}
              title="Remove member"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Workflows Section ───────────────────────────────────────────────────────

function WorkflowsSection({ orgId, setTab }) {
  const { data, loading, error } = useApi(() => api.orgWorkflows(orgId), [orgId])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const workflows = data?.rows || []

  return (
    <div className="space-y-3">
      <span className="text-sm font-semibold">Workflows</span>
      <div className="text-xs text-muted-foreground">
        Workflows assigned to this org's types. Edit stages, transitions, and exit criteria in the Workflow Editor.
      </div>

      {!workflows.length ? (
        <div className="text-xs text-muted-foreground py-6 text-center">No workflows assigned to this org's types</div>
      ) : (
        <div className="space-y-1">
          {workflows.map(w => (
            <button
              key={w.id}
              className="w-full text-left flex items-center gap-2 py-1.5 px-2 rounded hover:bg-black/[0.03] transition-colors"
              onClick={() => setTab?.('workflows')}
            >
              <span className="text-xs flex-1">{w.name}</span>
              {w.is_system_default && <Badge variant="default" className="text-[10px]">system</Badge>}
              {!w.is_active && <Badge variant="muted" className="text-[10px]">inactive</Badge>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Org Detail ──────────────────────────────────────────────────────────────

function OrgDetail({ org, section, setSection, onSaved, setTab }) {
  if (!org) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        Select an organization
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0">
        <span className="text-sm font-semibold truncate">{org.name}</span>
        <Badge variant={ORG_TYPE_COLORS[org.org_type] || 'muted'}>{org.org_type}</Badge>
        {!org.is_active && <Badge variant="muted">inactive</Badge>}
        {org.member_count > 0 && (
          <span className="text-xs text-muted-foreground">{org.member_count} member{org.member_count !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Body: pills + content */}
      <div className="flex flex-1 min-h-0">
        <SectionPills active={section} onChange={setSection} />
        <div className="flex-1 overflow-y-auto p-4">
          {section === 'settings'  && <SettingsSection org={org} onSaved={onSaved} />}
          {section === 'catalog'   && <CatalogSection orgId={org.id} setTab={setTab} />}
          {section === 'policies'  && <PoliciesSection orgId={org.id} org={org} onSaved={onSaved} />}
          {section === 'members'   && <MembersSection orgId={org.id} />}
          {section === 'workflows' && <WorkflowsSection orgId={org.id} setTab={setTab} />}
          {section === 'context'   && <OrgContextLibrary orgId={org.id} />}
          {section === 'aimodels'  && <OrgAiModels orgId={org.id} />}
        </div>
      </div>
    </div>
  )
}

// ─── Create Fields ───────────────────────────────────────────────────────────

const CREATE_FIELDS = [
  {
    key: 'name', label: 'Name', type: 'text', required: true,
    placeholder: 'e.g. Mobile Engineering',
  },
  {
    key: 'slug', label: 'Slug', isSlug: true, slugFrom: 'name', required: true,
    hint: 'Globally unique URL-safe identifier.',
  },
  {
    key: 'org_type', label: 'Type', type: 'select', required: true,
    loadOptions: () => api.orgTypes().then(d =>
      d.rows.filter(t => t.slug !== 'system' && t.is_active).map(t => ({ label: t.name, value: t.slug }))
    ),
  },
  {
    key: 'parent_id', label: 'Parent Org', type: 'select',
    hint: 'Optional. Leave blank for a top-level org.',
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: o.name, value: o.id }))
    ),
  },
  {
    key: 'description', label: 'Description', type: 'textarea',
    placeholder: 'What does this org do?',
  },
]

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Organizations({ setTab }) {
  const { data, loading, error, reload } = useApi(() => api.organizations())
  const [selectedId, setSelectedId] = useState(null)
  const [section, setSection] = useState('settings')
  const [creating, setCreating] = useState(false)

  const tree = useMemo(() => {
    if (!data?.rows) return []
    return buildOrgTree(data.rows)
  }, [data])

  const orgsById = useMemo(() => {
    if (!data?.rows) return {}
    const m = {}
    for (const o of data.rows) m[o.id] = o
    return m
  }, [data])

  const selectedOrg = selectedId ? orgsById[selectedId] : null

  // Auto-select first org
  useEffect(() => {
    if (!selectedId && data?.rows?.length) {
      setSelectedId(data.rows[0].id)
    }
  }, [data, selectedId])

  return (
    <>
      <div className="flex h-full min-h-0">
        {/* Compact tree sidebar */}
        <div className="w-[220px] flex-shrink-0 border-r border-border bg-card flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organizations</span>
            <Button size="sm" variant="outline" className="text-xs h-6 px-2" onClick={() => setCreating(true)}>+</Button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {loading ? <LoadingState /> :
             error ? <ErrorState message={error} /> :
             tree.map(node => (
               <CompactTreeNode key={node.id} node={node} selectedId={selectedId} onSelect={setSelectedId} />
             ))
            }
          </div>
        </div>

        {/* Detail area */}
        <OrgDetail
          key={selectedId}
          org={selectedOrg}
          section={section}
          setSection={setSection}
          onSaved={reload}
          setTab={setTab}
        />
      </div>

      <FormDrawer
        open={creating}
        onOpenChange={setCreating}
        title="New Organization"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createOrganization({ ...v, parent_id: v.parent_id ? parseInt(v.parent_id) : null })}
        onSaved={() => { reload(); setCreating(false) }}
      />
    </>
  )
}
