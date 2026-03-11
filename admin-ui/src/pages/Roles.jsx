import { useState } from 'react'
import { useApi }   from '@/hooks/useApi'
import { api }      from '@/lib/api'
import { DataTable }  from '@/components/ui/data-table'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { Switch }     from '@/components/ui/switch'
import { FormDrawer } from '@/components/FormDrawer'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'

const CREATE_FIELDS = [
  { key: 'name',        label: 'Name',         type: 'text',     required: true, placeholder: 'e.g. Tech Lead' },
  { key: 'org_id',      label: 'Organization', type: 'select',   required: true,
    loadOptions: () => api.organizations().then(d => d.rows.map(o => ({ label: `${o.name} (${o.slug})`, value: o.id }))) },
  { key: 'description', label: 'Description',  type: 'textarea', placeholder: 'What does this role do?' },
]

const EDIT_FIELDS = [
  { key: 'name',        label: 'Name',        type: 'text',     required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'is_active',   label: 'Active',      type: 'boolean'  },
]

const SCOPE_ORDER  = ['system', 'org', 'work', 'read']
const SCOPE_LABELS = { system: 'System', org: 'Organization', work: 'Work Items', read: 'Visibility' }
const SCOPE_HINTS  = {
  system: 'Global — applies across the entire system',
  org:    'Org-scoped — applies within a specific organization',
  work:   'Work item operations within an org',
  read:   'What the role can see',
}

function PermissionsPanel({ role, onClose, onSaved }) {
  const { data, loading } = useApi(() => api.rolePermissions(role.id), [role.id])
  const [overrides, setOverrides] = useState({})
  const [saving,    setSaving]    = useState(false)
  const [message,   setMessage]   = useState(null)

  function toggle(slug, current) {
    setOverrides(o => ({ ...o, [slug]: !current }))
    setMessage(null)
  }

  function effectiveGranted(row) {
    return overrides[row.slug] !== undefined ? overrides[row.slug] : row.effective_granted
  }

  async function save() {
    if (!data) return
    setSaving(true)
    setMessage(null)
    try {
      const perms = data.rows.map(r => ({ slug: r.slug, granted: effectiveGranted(r) }))
      await api.saveRolePermissions({ role_id: role.id, org_id: null, permissions: perms })
      setOverrides({})
      setMessage({ type: 'success', text: 'Permissions saved' })
      onSaved?.()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const grouped = {}
  if (data) {
    for (const row of data.rows) {
      if (!grouped[row.scope]) grouped[row.scope] = []
      grouped[row.scope].push(row)
    }
  }

  const changedCount = Object.keys(overrides).length

  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">{role.name}</SheetTitle>
          <p className="font-mono text-[10px] text-muted-foreground pt-0.5">
            {role.org_name} · Global permission defaults
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="font-mono text-xs text-muted-foreground py-8 text-center">Loading...</p>
          ) : (
            <div className="flex flex-col gap-6">
              {SCOPE_ORDER.filter(s => grouped[s]).map(scope => (
                <div key={scope}>
                  <div className="mb-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-primary">{SCOPE_LABELS[scope]}</p>
                    <p className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">{SCOPE_HINTS[scope]}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {grouped[scope].map(row => {
                      const granted = effectiveGranted(row)
                      const changed = overrides[row.slug] !== undefined
                      return (
                        <div key={row.slug} className={[
                          'flex items-center justify-between gap-3 px-3 py-2 rounded',
                          changed ? 'bg-primary/5 border border-primary/20' : 'border border-transparent',
                        ].join(' ')}>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-mono text-xs text-foreground truncate">{row.name}</span>
                            <span className="font-mono text-[10px] text-muted-foreground truncate">{row.slug}</span>
                          </div>
                          <Switch checked={granted} onCheckedChange={() => toggle(row.slug, granted)} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {message && (
            <div className={[
              'mt-4 font-mono text-[11px] px-3 py-2 rounded',
              message.type === 'success' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive border border-destructive/20',
            ].join(' ')}>
              {message.text}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={saving || changedCount === 0} className="flex-1">
            {saving ? 'Saving...' : changedCount ? `Save (${changedCount} changed)` : 'No changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export default function Roles() {
  const { data, loading, error, reload } = useApi(() => api.roles())
  const [creating,     setCreating]     = useState(false)
  const [editRow,      setEditRow]      = useState(null)
  const [selectedRole, setSelectedRole] = useState(null)

  function handleRowClick(row) {
    setSelectedRole(row)
  }

  const columns = [
    { accessorKey: 'id',               header: 'ID',          cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'name',             header: 'Name',        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'org_name',         header: 'Org',         cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span> },
    { accessorKey: 'description',      header: 'Description', cell: ({ getValue }) => <span className="text-muted-foreground truncate block max-w-[260px]">{getValue() ?? '—'}</span> },
    { accessorKey: 'is_system_default',header: '',            cell: ({ getValue }) => getValue() ? <Badge variant="blue">system</Badge> : null },
    { accessorKey: 'is_active',        header: 'Status',      cell: ({ getValue }) => getValue() ? <Badge variant="default">active</Badge> : <Badge variant="muted">inactive</Badge> },
    {
      id: 'edit', header: '', enableSorting: false,
      cell: ({ row }) => (
        <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setEditRow(row.original) }}>
          edit
        </Button>
      ),
    },
  ]

  return (
    <>
      <Panel className="flex-1 min-h-0">
        <PanelHeader>
          <PanelTitle>Roles</PanelTitle>
          <div className="flex items-center gap-3">
            {data && <PanelMeta>{data.count} roles</PanelMeta>}
            <Button size="sm" onClick={() => setCreating(true)}>+ New Role</Button>
          </div>
        </PanelHeader>
        {loading ? <LoadingState /> :
         error   ? <ErrorState message={error} /> :
         <DataTable columns={columns} data={data.rows} className="flex-1 min-h-0"
           onRowClick={handleRowClick} />}
      </Panel>

      <FormDrawer
        open={creating}
        onOpenChange={setCreating}
        title="New Role"
        fields={CREATE_FIELDS}
        onSubmit={v => api.createRole({ ...v, org_id: parseInt(v.org_id) })}
        onSaved={reload}
      />

      <FormDrawer
        open={!!editRow}
        onOpenChange={open => !open && setEditRow(null)}
        title={`Edit — ${editRow?.name ?? ''}`}
        fields={EDIT_FIELDS}
        initialValues={editRow}
        onSubmit={v => api.updateRole(editRow.id, v)}
        onSaved={() => { setEditRow(null); reload() }}
      />

      {selectedRole && (
        <PermissionsPanel
          role={selectedRole}
          onClose={() => setSelectedRole(null)}
          onSaved={reload}
        />
      )}
    </>
  )
}
