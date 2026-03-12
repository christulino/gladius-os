import { useState, useMemo } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { FormDrawer } from '@/components/FormDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

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

function OrgTreeNode({ node, depth = 0, onEdit }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const badgeVariant = ORG_TYPE_COLORS[node.org_type] || 'muted'

  return (
    <>
      <button
        className="w-full text-left flex items-center gap-2 py-2 hover:bg-black/[0.03] transition-colors rounded group"
        style={{ paddingLeft: `${12 + depth * 24}px`, paddingRight: 12 }}
        onClick={() => onEdit(node)}
      >
        {/* Expand/collapse toggle */}
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

        {/* Org name */}
        <span className="text-xs font-medium text-foreground flex-1 truncate">
          {node.name}
        </span>

        {/* Type badge */}
        <Badge variant={badgeVariant} className="flex-shrink-0">
          {node.org_type}
        </Badge>

        {/* Member count */}
        {node.member_count > 0 && (
          <span className="text-xs text-muted-foreground flex-shrink-0 w-12 text-right" title="Members">
            {node.member_count}
          </span>
        )}

        {/* Work item count */}
        <span className="text-xs text-muted-foreground flex-shrink-0 w-12 text-right" title="Work items">
          {node.work_item_count || '—'}
        </span>

        {/* Status */}
        {!node.is_active && (
          <Badge variant="muted" className="flex-shrink-0">inactive</Badge>
        )}
      </button>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <OrgTreeNode key={child.id} node={child} depth={depth + 1} onEdit={onEdit} />
          ))}
        </div>
      )}
    </>
  )
}

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

const EDIT_FIELDS = [
  { key: 'name',        label: 'Name',        type: 'text',     required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'org_type', label: 'Type', type: 'select',
    loadOptions: () => api.orgTypes().then(d =>
      d.rows.filter(t => t.slug !== 'system' && t.is_active).map(t => ({ label: t.name, value: t.slug }))
    ),
  },
  {
    key: 'parent_id', label: 'Parent Org', type: 'select',
    hint: 'Leave blank for a top-level org.',
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: o.name, value: o.id }))
    ),
  },
  { key: 'is_active', label: 'Active', type: 'boolean' },
]

export default function Organizations() {
  const { data, loading, error, reload } = useApi(() => api.organizations())
  const [creating, setCreating] = useState(false)
  const [editRow,  setEditRow]  = useState(null)

  const tree = useMemo(() => {
    if (!data?.rows) return []
    return buildOrgTree(data.rows)
  }, [data])

  return (
    <>
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <PanelTitle>Organizations</PanelTitle>
          <div className="flex items-center gap-3">
            {data && <PanelMeta>{data.count} orgs</PanelMeta>}
            <Button size="sm" onClick={() => setCreating(true)}>+ New Org</Button>
          </div>
        </PanelHeader>
        {loading ? <LoadingState /> :
         error   ? <ErrorState message={error} /> : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Column headers */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 sticky top-0">
              <span className="w-4 flex-shrink-0" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex-1">Name</span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex-shrink-0 w-20 text-center">Type</span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex-shrink-0 w-12 text-right">Mbrs</span>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex-shrink-0 w-12 text-right">Items</span>
            </div>

            {/* Tree */}
            <div className="py-1">
              {tree.map(node => (
                <OrgTreeNode key={node.id} node={node} onEdit={setEditRow} />
              ))}
            </div>
          </div>
        )}
      </Panel>

      <FormDrawer
        open={creating}
        onOpenChange={setCreating}
        title="New Organization"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createOrganization({ ...v, parent_id: v.parent_id ? parseInt(v.parent_id) : null })}
        onSaved={reload}
      />

      <FormDrawer
        open={!!editRow}
        onOpenChange={open => !open && setEditRow(null)}
        title={editRow?.name ?? ''}
        fields={EDIT_FIELDS}
        initialValues={editRow}
        autoSave
        onSubmit={v => api.updateOrganization(editRow.id, { ...v, parent_id: v.parent_id ? parseInt(v.parent_id) : null })}
        onSaved={reload}
      />
    </>
  )
}
