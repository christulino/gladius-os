import { useState, useEffect } from 'react'
import { mcpApi } from '@/lib/api'
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react'

function typeLabel(schema) {
  return schema.enum ? 'enum' : (schema.type || 'any')
}

function descriptionText(schema) {
  if (schema.enum) {
    const vals = schema.enum.map(v => JSON.stringify(v)).join(', ')
    return schema.description ? `${schema.description} — ${vals}` : vals
  }
  return schema.description || ''
}

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false)
  const props = tool.inputSchema?.properties || {}
  const required = tool.inputSchema?.required || []

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-black/[0.03]"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="text-xs font-semibold text-foreground shrink-0 w-[190px]">{tool.name}</span>
        <span className="text-xs text-muted-foreground truncate">{tool.description}</span>
      </button>
      {open && Object.keys(props).length > 0 && (
        <div className="border-t border-border">
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: '180px' }} />
              <col style={{ width: '90px' }} />
              <col />
            </colgroup>
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground px-4 py-2">Parameter</th>
                <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground py-2">Type</th>
                <th className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground py-2 pr-4">Description</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(props).map(([name, schema]) => (
                <tr key={name} className="border-t border-border first:border-0">
                  <td className="py-2 px-4 text-xs font-medium text-foreground align-top">
                    {name}{required.includes(name) && <span className="ml-1 text-destructive">*</span>}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground align-top">{typeLabel(schema)}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground align-top">{descriptionText(schema)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        Exposed via{' '}
        <span className="text-xs bg-muted px-1 rounded">mcp/gladius-context-server.js</span>{' '}
        (stdio transport). Connect from Claude Desktop or any MCP client.
        Parameters marked <span className="text-destructive">*</span> are required.
      </p>
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      <div className="space-y-2">
        {tools.map(t => <ToolCard key={t.name} tool={t} />)}
      </div>
    </div>
  )
}
