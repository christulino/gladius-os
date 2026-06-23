import { useState, useEffect } from 'react'
import { mcpApi } from '@/lib/api'
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react'

function PropRow({ name, schema, required }) {
  const isRequired = required?.includes(name)
  const typeLabel = schema.enum
    ? schema.enum.map(v => JSON.stringify(v)).join(' | ')
    : schema.type || 'any'
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3 text-xs font-medium text-foreground whitespace-nowrap">
        {name}
        {isRequired && <span className="ml-1 text-destructive">*</span>}
      </td>
      <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{typeLabel}</td>
      <td className="py-1.5 text-xs text-muted-foreground">{schema.description}</td>
    </tr>
  )
}

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false)
  const props = tool.inputSchema?.properties || {}
  const required = tool.inputSchema?.required || []

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-black/[0.03]"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium text-foreground">{tool.name}</span>
        <span className="text-xs text-muted-foreground ml-1 truncate">{tool.description}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-border">
          <p className="text-xs text-muted-foreground mt-3 mb-3">{tool.description}</p>
          {Object.keys(props).length > 0 && (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-muted-foreground pb-1.5 pr-3">Parameter</th>
                  <th className="text-left text-xs font-medium text-muted-foreground pb-1.5 pr-3">Type</th>
                  <th className="text-left text-xs font-medium text-muted-foreground pb-1.5">Description</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(props).map(([name, schema]) => (
                  <PropRow key={name} name={name} schema={schema} required={required} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function MCPTools() {
  const [tools, setTools] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    mcpApi.tools()
      .then(r => { setTools(r.tools || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Terminal className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-semibold text-foreground">MCP Tool Reference</h1>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        These tools are exposed via the Gladius MCP stdio server at{' '}
        <span className="text-xs bg-muted px-1 rounded">mcp/gladius-context-server.js</span>.
        External AI agents connect via Claude&apos;s MCP integration. Parameters marked{' '}
        <span className="text-destructive">*</span> are required.
      </p>
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      <div className="space-y-2">
        {tools.map(t => <ToolCard key={t.name} tool={t} />)}
      </div>
    </div>
  )
}
