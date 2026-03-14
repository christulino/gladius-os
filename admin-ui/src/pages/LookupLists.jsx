/**
 * LookupLists — Shared value lists for select/multi_select fields
 *
 * Two scopes:
 * - System lists: owned by the system org, available everywhere
 * - Org lists: owned by a specific org, visible to that org + descendants
 *
 * Configure → Lists in the sidebar.
 */

import { useState, useEffect, useCallback } from 'react'
import { useApi }     from '@/hooks/useApi'
import { api }        from '@/lib/api'
import { DataTable }  from '@/components/ui/data-table'
import { Badge }      from '@/components/ui/badge'
import { Button }     from '@/components/ui/button'
import { FormDrawer } from '@/components/FormDrawer'
import { Panel, PanelHeader, PanelTitle, PanelMeta, LoadingState, ErrorState } from '@/components/Panel'
import { GripVertical, Plus, X, Check } from 'lucide-react'

// ─── List editor drawer fields ─────────────────────────────────────────────

const EDIT_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'sort_mode', label: 'Sort Mode', type: 'select',
    options: [
      { label: 'Alphabetical', value: 'alpha' },
      { label: 'Manual (drag to reorder)', value: 'manual' },
    ],
  },
  { key: 'is_active', label: 'Active', type: 'boolean' },
]

const CREATE_FIELDS = [
  {
    key: 'org_id', label: 'Owner Org', type: 'select', required: true,
    loadOptions: () => api.organizations().then(d =>
      d.rows.map(o => ({ label: o.name, value: o.id }))
    ),
  },
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'sort_mode', label: 'Sort Mode', type: 'select',
    options: [
      { label: 'Alphabetical', value: 'alpha' },
      { label: 'Manual (drag to reorder)', value: 'manual' },
    ],
  },
]

const COLUMNS = [
  { accessorKey: 'name', header: 'Name', cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
  { accessorKey: 'org_slug', header: 'Owner', cell: ({ getValue }) => <Badge variant="muted">{getValue()}</Badge> },
  { accessorKey: 'sort_mode', header: 'Sort', cell: ({ getValue }) => getValue() === 'alpha' ? 'A→Z' : 'Manual' },
  { accessorKey: 'value_count', header: 'Values', cell: ({ getValue }) => getValue() || 0 },
  { accessorKey: 'is_active', header: 'Active', cell: ({ getValue }) => getValue() ? <Badge>Active</Badge> : <Badge variant="muted">Inactive</Badge> },
]

// ─── Values Editor (inline in the edit drawer) ─────────────────────────────

function ValuesEditor({ listId, sortMode }) {
  const [values, setValues] = useState([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [dragIdx, setDragIdx] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.lookupValues(listId)
      setValues(data.rows)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [listId])

  useEffect(() => { load() }, [load])

  const addValue = async () => {
    if (!newLabel.trim()) return
    await api.createLookupValue(listId, { label: newLabel.trim() })
    setNewLabel('')
    load()
  }

  const toggleActive = async (val) => {
    await api.updateLookupValue(val.id, { is_active: !val.is_active })
    load()
  }

  const updateLabel = async (val, label) => {
    if (label === val.label) return
    await api.updateLookupValue(val.id, { label })
    load()
  }

  const handleDragStart = (idx) => setDragIdx(idx)
  const handleDragOver = (e) => e.preventDefault()
  const handleDrop = async (targetIdx) => {
    if (dragIdx === null || dragIdx === targetIdx) return
    const reordered = [...values]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(targetIdx, 0, moved)
    setValues(reordered)
    setDragIdx(null)
    await api.reorderLookupValues(listId, reordered.map(v => v.id))
  }

  if (loading) return <div className="text-xs text-muted-foreground p-2">Loading values...</div>

  return (
    <div className="border-t border-border mt-2 pt-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Values</div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {values.map((val, idx) => (
          <div
            key={val.id}
            className="flex items-center gap-1.5 group"
            draggable={sortMode === 'manual'}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(idx)}
          >
            {sortMode === 'manual' && (
              <GripVertical className="h-3 w-3 text-muted-foreground cursor-grab flex-shrink-0" />
            )}
            <input
              className={[
                'flex-1 text-xs px-2 py-1 rounded border border-transparent bg-transparent',
                'hover:border-border focus:border-primary focus:outline-none',
                !val.is_active && 'line-through text-muted-foreground',
              ].filter(Boolean).join(' ')}
              defaultValue={val.label}
              onBlur={(e) => updateLabel(val, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
            <button
              onClick={() => toggleActive(val)}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              title={val.is_active ? 'Deactivate' : 'Activate'}
            >
              {val.is_active
                ? <X className="h-3 w-3" />
                : <Check className="h-3 w-3" />
              }
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <input
          className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background focus:border-primary focus:outline-none"
          placeholder="Add value..."
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addValue()}
        />
        <Button size="sm" variant="ghost" onClick={addValue} disabled={!newLabel.trim()}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function LookupLists() {
  const { data, loading, error, reload } = useApi(() => api.lookupLists())
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} />

  const rows = data?.rows || []

  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>Lookup Lists</PanelTitle>
          <PanelMeta>{rows.length} list{rows.length !== 1 && 's'}</PanelMeta>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3 w-3 mr-1" /> New List
          </Button>
        </PanelHeader>
        <DataTable
          columns={COLUMNS}
          data={rows}
          onRowClick={(row) => setEditing(row)}
        />
      </Panel>

      {/* Create drawer */}
      <FormDrawer
        open={creating}
        onOpenChange={setCreating}
        title="New Lookup List"
        fields={CREATE_FIELDS}
        initialValues={{ sort_mode: 'alpha' }}
        onSubmit={vals => api.createLookupList(vals)}
        onSaved={() => { setCreating(false); reload() }}
      />

      {/* Edit drawer */}
      {editing && (
        <FormDrawer
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          title={editing.name}
          fields={EDIT_FIELDS}
          initialValues={editing}
          autoSave
          onSubmit={vals => api.updateLookupList(editing.id, vals)}
          onSaved={() => reload()}
          extraContent={
            <ValuesEditor listId={editing.id} sortMode={editing.sort_mode} />
          }
        />
      )}
    </>
  )
}
