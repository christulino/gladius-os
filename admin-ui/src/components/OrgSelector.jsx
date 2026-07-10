import { useState, useEffect, useRef, useMemo } from 'react'
import { isMultiOrgEnabled } from '@/lib/appConfig'

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

function flattenTree(nodes, depth = 0) {
  const result = []
  for (const node of nodes) {
    result.push({ ...node, depth })
    if (node.children.length > 0) result.push(...flattenTree(node.children, depth + 1))
  }
  return result
}

export function OrgSelector({ orgs, selectedId, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const tree = useMemo(() => buildOrgTree(orgs), [orgs])
  const flat = useMemo(() => flattenTree(tree), [tree])

  const selectedOrg = orgs.find(o => o.id === selectedId)
  const label = selectedOrg?.name || 'Select org...'

  // Single-org mode (default): no tree/dropdown navigation, just the name.
  // Still shown if there's genuinely more than one org to pick from, so a
  // multi-org dataset never gets silently stranded behind the flag.
  if (!isMultiOrgEnabled() && orgs.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground min-w-[160px] max-w-[280px]">
        <span className="truncate">{label}</span>
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 bg-card border border-border rounded px-2.5 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors min-w-[160px] max-w-[280px]"
      >
        <span className="truncate flex-1 text-left">{label}</span>
        <span className="text-muted-foreground flex-shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded shadow-lg min-w-[240px] max-h-[320px] overflow-y-auto py-1">
          {flat.map(node => (
            <button
              key={node.id}
              onClick={() => { onChange(node.id); setOpen(false) }}
              className={`w-full text-left py-1.5 text-xs transition-colors flex items-center gap-2 ${
                node.id === selectedId
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-muted/50'
              }`}
              style={{ paddingLeft: `${12 + node.depth * 16}px`, paddingRight: 12 }}
            >
              <span>{node.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
