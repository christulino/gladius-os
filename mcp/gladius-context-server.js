// mcp/gladius-context-server.js
// Gladius MCP stdio server — exposes 8 context/workflow tools to external AI agents.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { listContextEntries, createContextEntry } from '../runtime/contextEntries.js'
import { listOrgContext } from '../runtime/orgContext.js'
import { assembleContext, formatContextForPrompt } from '../runtime/contextAssembler.js'
import { pool } from '../db/postgres.js'

// Agent identity — must be set to a valid blueprint.users.id for tools that
// write records (add_comment, transition_work_item). Callers cannot override this.
const AGENT_USER_ID = process.env.GLADIUS_AGENT_USER_ID
  ? parseInt(process.env.GLADIUS_AGENT_USER_ID, 10)
  : null

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
    description: 'Search work items using structured filters',
    inputSchema: {
      type: 'object',
      properties: {
        keyword:     { type: 'string',  description: 'Full-text search across title, description, and comments' },
        stage_class: { type: 'string',  enum: ['active','queued','done','cancelled'], description: 'Filter by stage class' },
        type_name:   { type: 'string',  description: 'Filter by work item type name (e.g. "Bug", "Feature")' },
        priority:    { type: 'number',  enum: [1,2,3,4], description: '1=critical, 2=high, 3=medium, 4=low' },
        assignee_id: { type: 'number',  description: 'Filter by assignee user ID' },
        org_id:      { type: 'number',  description: 'Org to search within (required)' },
        limit:       { type: 'number',  description: 'Max results (default 20, max 100)' },
      },
      required: ['org_id'],
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
    description: 'Add a comment to a work item. Author is the configured agent identity (GLADIUS_AGENT_USER_ID).',
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
  { name: 'gladius-context', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

// ── Tool dispatch ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {

      case 'list_context_entries': {
        const rows = await listContextEntries(args.work_item_id, { types: args.types })
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      }

      case 'write_context_entry': {
        const entry = await createContextEntry(args.work_item_id, {
          type:       args.type,
          title:      args.title ?? null,
          content:    args.content,
          visibility: args.visibility ?? 'item',
          isAgent:    args.is_agent !== false,
          authorId:   null,
        })
        return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] }
      }

      case 'get_assembled_context': {
        const meta = {
          context: {
            pull: [
              ...(args.pull_types || []),
              ...(args.include_ancestors ? ['ancestors'] : []),
            ],
            org: args.org_types || [],
          },
        }
        const ctx = await assembleContext(args.work_item_id, args.org_id, meta)
        const formatted = formatContextForPrompt(ctx)
        return { content: [{ type: 'text', text: formatted || '(no context)' }] }
      }

      case 'list_org_context': {
        const rows = await listOrgContext(args.org_id, { types: args.types })
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
      }

      case 'get_work_item': {
        // Scope to org_id to prevent cross-org IDOR
        const r = await pool.query(`
          SELECT wi.id, wi.display_key, wi.title, wi.description,
                 wi.current_substate, wi.priority, wi.tags, wi.estimate, wi.estimate_unit,
                 wi.due_date, wi.is_expedited, wi.work_nature, wi.origin,
                 wi.created_at, wi.updated_at, wi.started_at, wi.resolved_at,
                 s.name  AS stage_name,  s.stage_class,
                 wit.name AS type_name,  wit.icon AS type_icon,
                 o.slug  AS org_slug,    o.name AS org_name
          FROM runtime.work_items wi
          LEFT JOIN blueprint.stages             s   ON s.id   = wi.current_stage_id
          LEFT JOIN blueprint.work_item_types    wit ON wit.id = wi.work_item_type_id
          LEFT JOIN blueprint.organizations      o   ON o.id   = wi.owner_org_id
          WHERE wi.id = $1 AND wi.owner_org_id = $2
        `, [args.work_item_id, args.org_id])
        if (!r.rows.length) throw new Error(`Work item ${args.work_item_id} not found in org ${args.org_id}`)
        return { content: [{ type: 'text', text: JSON.stringify(r.rows[0], null, 2) }] }
      }

      case 'search_work_items': {
        const limit = Math.min(args.limit ?? 20, 100)
        const qparams = [args.org_id]
        const where = [`wi.owner_org_id = $1`]
        where.push(`(wi.resolved_at IS NULL OR wi.resolved_at > NOW() - INTERVAL '90 days')`)
        if (args.keyword) {
          const tokens = String(args.keyword).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
          if (tokens.length > 0) {
            const tsq = tokens.map(t => t + ':*').join(' & ')
            qparams.push(tsq)
            where.push(`wis.search_doc @@ to_tsquery('english', $${qparams.length})`)
          }
        }
        if (args.stage_class) {
          qparams.push(args.stage_class)
          where.push(`s.stage_class = $${qparams.length}`)
        }
        if (args.type_name) {
          qparams.push(args.type_name)
          where.push(`wit.name = $${qparams.length}`)
        }
        if (args.priority) {
          qparams.push(args.priority)
          where.push(`wi.priority = $${qparams.length}`)
        }
        if (args.assignee_id) {
          qparams.push(args.assignee_id)
          where.push(`rel_owns.user_id = $${qparams.length}`)
        }
        qparams.push(limit)
        const searchSql = `
          SELECT wi.id, wi.display_key, wi.title, wi.priority, wi.updated_at, wi.resolved_at,
                 s.name AS status, s.stage_class,
                 o.name AS org_name, wit.name AS type_name
          FROM runtime.work_items wi
          JOIN blueprint.stages s ON s.id = wi.current_stage_id
          JOIN blueprint.organizations o ON o.id = wi.owner_org_id
          JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
          LEFT JOIN runtime.work_item_user_relationships rel_owns
            ON rel_owns.work_item_id = wi.id AND rel_owns.relationship_type = 'owns'
          LEFT JOIN runtime.work_item_search wis ON wis.work_item_id = wi.id
          WHERE ${where.join(' AND ')}
          ORDER BY wi.priority DESC NULLS LAST, wi.updated_at DESC
          LIMIT $${qparams.length}
        `.trim()
        const r = await pool.query(searchSql, qparams)
        return { content: [{ type: 'text', text: JSON.stringify(r.rows, null, 2) }] }
      }

      case 'transition_work_item': {
        if (!AGENT_USER_ID) throw new Error('GLADIUS_AGENT_USER_ID env var not set — cannot perform transitions')
        const { prepareTransition, executeTransition } = await import('../runtime/transitions.js')
        const prep = await prepareTransition(args.work_item_id, args.to_stage_id, AGENT_USER_ID)
        if (!prep.canTransition) {
          throw new Error(`Transition blocked: ${prep.reason ?? 'exit criteria not met'}`)
        }
        const result = await executeTransition(args.work_item_id, args.to_stage_id, AGENT_USER_ID)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }

      case 'add_comment': {
        if (!AGENT_USER_ID) throw new Error('GLADIUS_AGENT_USER_ID env var not set — cannot post comments')
        const r = await pool.query(`
          INSERT INTO runtime.work_item_comments (work_item_id, author_user_id, body)
          VALUES ($1, $2, $3)
          RETURNING id, work_item_id, author_user_id, body, created_at, updated_at
        `, [args.work_item_id, AGENT_USER_ID, args.body])
        return { content: [{ type: 'text', text: JSON.stringify(r.rows[0], null, 2) }] }
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
