/**
 * WitTypes — Org Service Catalog
 *
 * Work item type classes are global templates owned by the System org.
 * Each org creates its own work item types based on those templates —
 * that collection is their service catalog.
 *
 * Even if an org uses a class unchanged, creating a type for it preserves
 * the ability to add custom fields, rules, or workflow changes later.
 */

import { useState, useMemo } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable }  from '@/components/ui/data-table'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { FormDrawer } from '@/components/FormDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

const REQUEST_MODE_OPTIONS = [
  { label: 'User Requestable — visible in service catalog', value: 'user_requestable' },
  { label: 'Restricted — visibility rules apply',           value: 'restricted' },
  { label: 'Automation Only — never in catalog',            value: 'automation_only' },
]

const CREATE_FIELDS = [
  {
    key: 'name', label: 'Type Name', type: 'text', required: true,
    placeholder: 'e.g. IT Support Request',
    hint: 'Name this type as your team will refer to it.',
  },
  {
    key: 'class_id', label: 'Template Class', type: 'select', required: true,
    hint: 'Select the global class this type is based on. You can customize it after creation.',
    loadOptions: () => api.witClasses().then(d =>
      d.rows
        .filter(c => c.is_active)
        .map(c => ({ label: c.name, value: c.id }))
    ),
  },
  {
    key: 'owner_org_id', label: 'Org (service catalog owner)', type: 'select', required: true,
    hint: 'Which org\'s service catalog this type belongs to.',
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: `${o.name} (${o.slug})`, value: o.id }))
    ),
  },
  {
    key: 'description', label: 'Description', type: 'textarea',
    placeholder: 'What is this type used for? Who requests it?',
  },
  {
    key: 'request_mode', label: 'Request Mode', type: 'select',
    options: REQUEST_MODE_OPTIONS,
    defaultValue: 'user_requestable',
  },
  {
    key: 'icon', label: 'Icon', type: 'text',
    placeholder: '🎫',
    hint: 'Emoji or identifier shown on board cards.',
  },
  {
    key: 'color', label: 'Color', type: 'text',
    placeholder: '#6366f1',
    hint: 'Hex color for card accents. Used as visual identity on the board.',
  },
  {
    key: 'is_published', label: 'Publish to Catalog', type: 'boolean',
    defaultValue: false,
    hint: 'Published types appear in the service catalog when creating work items.',
  },
]

const EDIT_FIELDS = [
  { key: 'name',         label: 'Type Name',           type: 'text',     required: true },
  { key: 'description',  label: 'Description',         type: 'textarea' },
  { key: 'request_mode', label: 'Request Mode',        type: 'select',   options: REQUEST_MODE_OPTIONS },
  { key: 'icon',         label: 'Icon',                type: 'text',     placeholder: '🎫' },
  { key: 'color',        label: 'Color',               type: 'text',     placeholder: '#6366f1' },
  {
    key: 'is_published', label: 'Published in Catalog', type: 'boolean',
    hint: 'Controls visibility in the service library when creating work items.',
  },
  {
    key: 'is_active', label: 'Active',                 type: 'boolean',
    hint: 'Deactivated types are hidden from the catalog and cannot receive new work items.',
  },
]

export default function WitTypes() {
  const { data, loading, error, reload } = useApi(() => api.witTypes())
  const { data: orgsData }               = useApi(() => api.organizations())
  const [creating,   setCreating]   = useState(false)
  const [editRow,    setEditRow]    = useState(null)
  const [filterOrg,  setFilterOrg]  = useState('all')
  const [showInactive, setShowInactive] = useState(false)

  const orgs = orgsData?.rows ?? []

  const filtered = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.filter(r => {
      if (!showInactive && !r.is_active) return false
      if (filterOrg !== 'all' && String(r.owner_org_id) !== filterOrg) return false
      return true
    })
  }, [data, filterOrg, showInactive])

  const columns = [
    {
      accessorKey: 'icon', header: '',
      cell: ({ getValue }) => <span className="text-base">{getValue() ?? ''}</span>,
    },
    {
      accessorKey: 'name', header: 'Type Name',
      cell: ({ getValue, row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{getValue()}</span>
          {!row.original.is_active && (
            <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">inactive</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'class_name', header: 'Based On',
      cell: ({ getValue }) => (
        <span className="font-mono text-[10px] text-muted-foreground italic">{getValue()}</span>
      ),
    },
    {
      accessorKey: 'owner_org_name', header: 'Org Catalog',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
    },
    {
      accessorKey: 'request_mode', header: 'Visibility',
      cell: ({ getValue }) => {
        const v = getValue()
        const labels = { user_requestable: 'requestable', restricted: 'restricted', automation_only: 'auto only' }
        return <span className="font-mono text-[10px] text-muted-foreground">{labels[v] ?? v}</span>
      },
    },
    {
      accessorKey: 'is_published', header: 'Catalog',
      cell: ({ getValue }) => getValue()
        ? <Badge variant="default">published</Badge>
        : <Badge variant="muted">draft</Badge>,
    },
    {
      accessorKey: 'color', header: '',
      cell: ({ getValue }) => {
        const v = getValue()
        if (!v) return null
        return <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: v }} title={v} />
      },
    },
    {
      accessorKey: 'is_system_default', header: '',
      cell: ({ getValue }) => getValue()
        ? <Badge variant="brown">system</Badge>
        : null,
    },
  ]

  return (
    <>
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <div className="flex flex-col gap-0.5">
            <PanelTitle>Service Catalog — Work Item Types</PanelTitle>
            <p className="font-mono text-[10px] text-muted-foreground">
              Each org defines its own types, based on shared template classes.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Org filter */}
            <select
              value={filterOrg}
              onChange={e => setFilterOrg(e.target.value)}
              className="bg-background border border-border rounded text-xs font-mono text-foreground px-2 py-1.5 focus:outline-none focus:border-primary"
            >
              <option value="all">All orgs</option>
              {orgs.map(o => (
                <option key={o.id} value={String(o.id)}>{o.name}</option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
                className="accent-primary"
              />
              <span className="font-mono text-[10px] text-muted-foreground">show inactive</span>
            </label>

            {data && <PanelMeta>{filtered.length} type{filtered.length !== 1 ? 's' : ''}</PanelMeta>}
            <Button size="sm" onClick={() => setCreating(true)}>+ Add Type</Button>
          </div>
        </PanelHeader>
        {loading ? <LoadingState /> :
         error   ? <ErrorState message={error} /> :
         <DataTable columns={columns} data={filtered} className="flex-1 min-h-0"
           onRowClick={setEditRow} />}
      </Panel>

      <FormDrawer
        open={creating}
        onOpenChange={setCreating}
        title="Add Work Item Type to Catalog"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createWitType({
          ...v,
          class_id:     parseInt(v.class_id),
          owner_org_id: parseInt(v.owner_org_id),
        })}
        onSaved={reload}
      />

      <FormDrawer
        open={!!editRow}
        onOpenChange={open => !open && setEditRow(null)}
        title={`Edit — ${editRow?.name ?? ''}`}
        fields={EDIT_FIELDS}
        initialValues={editRow}
        onSubmit={v => api.updateWitType(editRow.id, v)}
        onSaved={() => { setEditRow(null); reload() }}
      />
    </>
  )
}
