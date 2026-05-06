import { useState } from 'react'
import { Lock, Building2, Globe, MoreHorizontal } from 'lucide-react'

const ICONS = { private: Lock, org: Building2, global: Globe }

export default function SavedFiltersList({ filters, onSelect, onNew, onEdit, onDelete }) {
  const [openMenuId, setOpenMenuId] = useState(null)

  const groups = [
    { key: 'mine',   label: 'Mine',   match: f => f.is_owner },
    { key: 'org',    label: 'Org',    match: f => f.share_scope === 'org' && !f.is_owner },
    { key: 'global', label: 'Global', match: f => f.share_scope === 'global' && !f.is_owner },
  ]

  return (
    <div className="w-56 border-r border-border p-3 space-y-3 text-xs overflow-y-auto">
      {groups.map(g => {
        const items = filters.filter(g.match)
        if (items.length === 0) return null
        return (
          <div key={g.key}>
            <div className="font-medium uppercase tracking-wide text-foreground/60 mb-1">{g.label}</div>
            <ul className="space-y-0.5">
              {items.map(f => {
                const Icon = ICONS[f.share_scope] || Lock
                return (
                  <li key={f.id} className="relative group flex items-center">
                    <button onClick={() => onSelect(f)} className="flex-1 text-left flex items-center gap-2 hover:bg-black/[0.03] rounded px-2 py-1 truncate">
                      <Icon className="h-3 w-3 text-foreground/50 shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                    {f.can_edit && (
                      <button
                        onClick={() => setOpenMenuId(openMenuId === f.id ? null : f.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/[0.05] rounded"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                    )}
                    {openMenuId === f.id && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded shadow-md text-xs">
                        <button onClick={() => { onEdit(f); setOpenMenuId(null) }} className="block w-full text-left px-3 py-1 hover:bg-black/[0.03]">Edit</button>
                        <button onClick={() => { if (confirm(`Delete "${f.name}"?`)) onDelete(f); setOpenMenuId(null) }} className="block w-full text-left px-3 py-1 hover:bg-black/[0.03] text-destructive">Delete</button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      <button onClick={onNew} className="w-full text-left text-xs text-primary hover:underline px-2 py-1">+ New filter</button>
    </div>
  )
}
