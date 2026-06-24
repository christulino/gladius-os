// mcp/gladius-context-server.js
// Gladius MCP stdio server — exposes context/workflow tools to external AI agents.
// All tools call the Gladius REST API via Bearer auth (GLADIUS_API_KEY).
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { apiGet, apiPost, WRITE_TOOLS } from './http-client.js'
import { TOOLS } from './toolsManifest.js'

const WRITE_LIMIT = process.env.GLADIUS_MCP_WRITE_RATE_LIMIT
  ? parseInt(process.env.GLADIUS_MCP_WRITE_RATE_LIMIT, 10)
  : null
let writeCount = 0

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'gladius-context', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

// ── Tool dispatch ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (WRITE_TOOLS.has(name) && WRITE_LIMIT !== null && writeCount >= WRITE_LIMIT) {
      return {
        content: [{ type: 'text', text: `Error: write rate limit reached (${WRITE_LIMIT} writes per session). Set GLADIUS_MCP_WRITE_RATE_LIMIT to increase.` }],
        isError: true,
      }
    }

    switch (name) {

      case 'list_context_entries': {
        const params = {}
        if (args.types?.length) params.types = args.types.join(',')
        const data = await apiGet(`/admin/api/work-items/${args.work_item_id}/context-entries`, params)
        return { content: [{ type: 'text', text: JSON.stringify(data?.rows ?? data, null, 2) }] }
      }

      case 'write_context_entry': {
        writeCount++
        const entry = await apiPost(`/admin/api/work-items/${args.work_item_id}/context-entries`, {
          type:       args.entry_type,
          title:      args.title ?? null,
          content:    args.content,
          visibility: args.visibility ?? 'item',
          is_agent:   args.is_agent !== false,
        })
        return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] }
      }

      case 'get_assembled_context': {
        const params = {}
        if (args.pull_types?.length)    params.pull_types = args.pull_types.join(',')
        if (args.org_types?.length)     params.org_types  = args.org_types.join(',')
        if (args.include_ancestors)     params.include_ancestors = 'true'
        const data = await apiGet(`/admin/api/work-items/${args.work_item_id}/assembled-context`, params)
        return { content: [{ type: 'text', text: data?.context ?? '(no context)' }] }
      }

      case 'list_org_context': {
        const params = {}
        if (args.types?.length) params.types = args.types.join(',')
        const data = await apiGet(`/admin/api/organizations/${args.org_id}/context`, params)
        return { content: [{ type: 'text', text: JSON.stringify(data?.rows ?? data, null, 2) }] }
      }

      case 'get_work_item': {
        const data = await apiGet(`/admin/api/work-items/${args.work_item_id}`)
        if (!data) throw new Error(`Work item ${args.work_item_id} not found`)
        if (data.owner_org_id !== args.org_id) {
          throw new Error(`Work item ${args.work_item_id} not found in org ${args.org_id}`)
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      }

      case 'search_work_items': {
        const params = { org_id: args.org_id, limit: Math.min(args.limit ?? 20, 100) }
        if (args.keyword)     params.keyword     = args.keyword
        if (args.stage_class) params.stage_class = args.stage_class
        if (args.type_name)   params.type_name   = args.type_name
        if (args.priority)    params.priority    = args.priority
        if (args.assignee_id) params.assignee_id = args.assignee_id
        const data = await apiGet('/admin/api/search', params)
        return { content: [{ type: 'text', text: JSON.stringify(data?.rows ?? data, null, 2) }] }
      }

      case 'transition_work_item': {
        writeCount++
        const prep = await apiGet(
          `/admin/api/work-items/${args.work_item_id}/transition/prepare`,
          { to_stage_id: args.target_stage_id }
        )
        if (!prep?.canTransition) {
          const reason = prep?.blockedCriteria?.[0]?.reason ?? prep?.reason ?? 'exit criteria not met'
          throw new Error(`Transition blocked: ${reason}`)
        }
        const result = await apiPost(`/admin/api/work-items/${args.work_item_id}/transition`, {
          to_stage_id: args.target_stage_id,
          comment: args.comment,
        })
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }

      case 'get_session_context': {
        const data = await apiGet(`/admin/api/organizations/${args.org_id}/session-context`)
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      }

      case 'add_comment': {
        writeCount++
        const comment = await apiPost(`/admin/api/work-items/${args.work_item_id}/comments`, {
          body:      args.body,
          parent_id: args.parent_id ?? null,
        })
        return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] }
      }

      case 'get_stage_playbook': {
        const data = await apiGet(`/admin/api/work-items/${args.work_item_id}/stage-playbook`)
        if (data === null) {
          return { content: [{ type: 'text', text: 'No active playbook for current stage.' }] }
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
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
  console.error('[gladius-mcp] Context server running on stdio')
}

main().catch(err => {
  console.error('[gladius-mcp] Fatal:', err)
  process.exit(1)
})
