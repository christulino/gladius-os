// mcp/flowos-context-server.js
// FlowOS MCP stdio server — exposes 8 context/workflow tools to external AI agents.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { apiGet, apiPost, WRITE_TOOLS } from './http-client.js'

const WRITE_LIMIT = process.env.FLOWOS_MCP_WRITE_RATE_LIMIT
  ? parseInt(process.env.FLOWOS_MCP_WRITE_RATE_LIMIT, 10)
  : null
let writeCount = 0

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_context_entries',
    description: 'List journal entries for a work item',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by entry types (optional): nfr, discovery, acceptance, design, decision, note, test-plan, playbook',
        },
      },
      required: ['work_item_id'],
    },
  },
  {
    name: 'write_context_entry',
    description: 'Write a context entry to a work item journal',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number' },
        type: {
          type: 'string',
          description: 'Entry type: nfr, discovery, acceptance, design, decision, note, test-plan, playbook',
        },
        title:      { type: 'string' },
        content:    { type: 'string', description: 'Markdown content' },
        visibility: { type: 'string', enum: ['item', 'descendants'], description: 'Defaults to item' },
        is_agent:   { type: 'boolean', description: 'Whether written by an AI agent (default: true)' },
      },
      required: ['work_item_id', 'type', 'content'],
    },
  },
  {
    name: 'get_assembled_context',
    description: 'Get fully assembled context for a work item (journal entries + ancestor entries + org-level context), formatted for prompt injection',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id:      { type: 'number' },
        org_id:            { type: 'number' },
        pull_types:        { type: 'array', items: { type: 'string' }, description: 'Journal entry types to pull' },
        org_types:         { type: 'array', items: { type: 'string' }, description: 'Org context types to inject' },
        include_ancestors: { type: 'boolean', description: 'Include ancestor work item context (default: false)' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
  {
    name: 'list_org_context',
    description: 'List org-level context entries (architecture standards, security policies, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number' },
        types:  { type: 'array', items: { type: 'string' } },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'get_work_item',
    description: 'Get work item details: title, description, display_key, stage, type, timestamps',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number' },
        org_id:       { type: 'number', description: 'Org the work item belongs to (required — prevents cross-org access)' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
  {
    name: 'search_work_items',
    description: 'Search work items using JQL (e.g. "type = BUG AND status = \\"In Progress\\"")',
    inputSchema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: 'JQL query string' },
        org_id: { type: 'number', description: 'Org to search within (required)' },
        limit:  { type: 'number', description: 'Max results (default 20, max 100)' },
      },
      required: ['query', 'org_id'],
    },
  },
  {
    name: 'transition_work_item',
    description: 'Move a work item to a different stage via the two-phase transition engine (exit criteria still apply). Actor is the configured agent identity.',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number' },
        to_stage_id:  { type: 'number' },
      },
      required: ['work_item_id', 'to_stage_id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a work item. Author is the configured agent identity (FLOWOS_AGENT_USER_ID).',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number' },
        body:         { type: 'string' },
      },
      required: ['work_item_id', 'body'],
    },
  },
]

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'flowos-context', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

// ── Tool dispatch ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (WRITE_TOOLS.has(name) && WRITE_LIMIT !== null && writeCount >= WRITE_LIMIT) {
      return {
        content: [{ type: 'text', text: `Error: write rate limit reached (${WRITE_LIMIT} writes per session). Set FLOWOS_MCP_WRITE_RATE_LIMIT to increase.` }],
        isError: true,
      }
    }

    switch (name) {

      case 'list_context_entries': {
        const data = await apiGet(`/admin/api/work-items/${args.work_item_id}/context-entries`,
          args.types?.length ? { types: args.types.join(',') } : {}
        )
        return { content: [{ type: 'text', text: JSON.stringify(data.rows ?? data, null, 2) }] }
      }

      case 'write_context_entry': {
        const entry = await apiPost(`/admin/api/work-items/${args.work_item_id}/context-entries`, {
          type:       args.type,
          title:      args.title ?? null,
          content:    args.content,
          visibility: args.visibility ?? 'item',
        })
        writeCount++
        return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] }
      }

      case 'get_assembled_context': {
        const params = {}
        if (args.pull_types?.length) params.pull_types = args.pull_types.join(',')
        if (args.org_types?.length)  params.org_types  = args.org_types.join(',')
        if (args.include_ancestors)  params.include_ancestors = 'true'
        const data = await apiGet(`/admin/api/work-items/${args.work_item_id}/assembled-context`, params)
        return { content: [{ type: 'text', text: data?.context ?? '(no context)' }] }
      }

      case 'list_org_context': {
        const data = await apiGet(`/admin/api/organizations/${args.org_id}/context`,
          args.types?.length ? { types: args.types.join(',') } : {}
        )
        return { content: [{ type: 'text', text: JSON.stringify(data.rows ?? data, null, 2) }] }
      }

      case 'get_work_item': {
        const data = await apiGet(`/admin/api/work-items/${args.work_item_id}`)
        if (!data) throw new Error(`Work item ${args.work_item_id} not found`)
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      }

      case 'search_work_items': {
        const limit = Math.min(args.limit ?? 20, 100)
        const data = await apiGet('/admin/api/search', { q: args.query, limit })
        return { content: [{ type: 'text', text: JSON.stringify(data?.rows ?? data, null, 2) }] }
      }

      case 'transition_work_item': {
        const prep = await apiGet(
          `/admin/api/work-items/${args.work_item_id}/transition/prepare`,
          { to_stage_id: args.to_stage_id }
        )
        if (!prep?.canTransition) {
          throw new Error(`Transition blocked: ${prep?.blockedCriteria?.[0]?.reason ?? 'exit criteria not met'}`)
        }
        const result = await apiPost(`/admin/api/work-items/${args.work_item_id}/transition`, {
          to_stage_id: args.to_stage_id,
        })
        writeCount++
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }

      case 'add_comment': {
        const comment = await apiPost(`/admin/api/work-items/${args.work_item_id}/comments`, {
          body: args.body,
        })
        writeCount++
        return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    }
  }
})

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[flowos-mcp] Context server running on stdio')
}

main().catch(err => {
  console.error('[flowos-mcp] Fatal:', err)
  process.exit(1)
})
