import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { Switch }     from '@/components/ui/switch'
import { FormDrawer } from '@/components/FormDrawer'
import { LoadingState, ErrorState } from '@/components/Panel'

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
  const [adding, setAdding] = useState(false)
  const [addClassId, setAddClassId] = useState('')
  const [addName, setAddName] = useState('')
  const [addPrefix, setAddPrefix] = useState('')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const rows = data?.rows || []
  const workflows = workflowsData?.rows || []
  const classes = classesData?.rows || []

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
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CatalogTypeRow({ type: t, workflows, onSuspend, onChangeWorkflow, setTab }) {
  const [expanded, setExpanded] = useState(false)

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
            <select
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs"
              value={t.current_workflow_id || ''}
              onChange={e => onChangeWorkflow(t.id, e.target.value)}
            >
              <option value="">None</option>
              {workflows.filter(w => w.is_active).map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Prefix</span>
            <span className="text-xs">{t.key_prefix || '—'}</span>
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
    </div>
  )
}

// ─── Policies Section ────────────────────────────────────────────────────────

function PoliciesSection({ orgId }) {
  const { data, loading, error, reload } = useApi(() => api.orgWipLimits(orgId), [orgId])
  const [newRow, setNewRow] = useState({ stage_name: '', wip_limit: '', enforcement: 'soft' })

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const limits = data?.rows || []

  async function saveLimit(stageName, wipLimit, enforcement) {
    try {
      const val = parseInt(wipLimit)
      if (!val || val <= 0) {
        const existing = limits.find(l => l.stage_name === stageName)
        if (existing) await api.deleteOrgWipLimit(existing.id)
      } else {
        await api.setOrgWipLimit({ org_id: orgId, stage_name: stageName, wip_limit: val, enforcement })
      }
      reload()
    } catch (err) {
      console.error(err)
    }
  }

  async function addLimit() {
    if (!newRow.stage_name.trim() || !parseInt(newRow.wip_limit)) return
    await saveLimit(newRow.stage_name.trim(), newRow.wip_limit, newRow.enforcement)
    setNewRow({ stage_name: '', wip_limit: '', enforcement: 'soft' })
  }

  return (
    <div className="space-y-3">
      <span className="text-sm font-semibold">WIP Limits</span>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground uppercase tracking-wide border-b border-border">
            <th className="text-left py-1.5 font-medium">Stage</th>
            <th className="text-left py-1.5 font-medium w-20">Limit</th>
            <th className="text-left py-1.5 font-medium w-20">Type</th>
          </tr>
        </thead>
        <tbody>
          {limits.map(l => (
            <WipLimitRow key={l.id} limit={l} onSave={saveLimit} />
          ))}
          <tr className="border-t border-border/50">
            <td className="py-1.5 pr-2">
              <input
                className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
                placeholder="Stage name"
                value={newRow.stage_name}
                onChange={e => setNewRow(r => ({ ...r, stage_name: e.target.value }))}
              />
            </td>
            <td className="py-1.5 pr-2">
              <input
                className="w-20 bg-background border border-border rounded px-2 py-1 text-xs"
                type="number"
                placeholder="0"
                value={newRow.wip_limit}
                onChange={e => setNewRow(r => ({ ...r, wip_limit: e.target.value }))}
              />
            </td>
            <td className="py-1.5">
              <Button size="sm" variant="outline" className="text-xs h-6" onClick={addLimit}>Add</Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function WipLimitRow({ limit, onSave }) {
  const [val, setVal] = useState(String(limit.wip_limit))

  useEffect(() => { setVal(String(limit.wip_limit)) }, [limit.wip_limit])

  return (
    <tr className="border-t border-border/50">
      <td className="py-1.5 text-foreground">{limit.stage_name}</td>
      <td className="py-1.5">
        <input
          className="w-16 bg-background border border-border rounded px-2 py-1 text-xs"
          type="number"
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={() => val !== String(limit.wip_limit) && onSave(limit.stage_name, val, limit.enforcement)}
        />
      </td>
      <td className="py-1.5 text-muted-foreground">{limit.enforcement || 'soft'}</td>
    </tr>
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
          {section === 'policies'  && <PoliciesSection orgId={org.id} />}
          {section === 'members'   && <MembersSection orgId={org.id} />}
          {section === 'workflows' && <WorkflowsSection orgId={org.id} setTab={setTab} />}
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
