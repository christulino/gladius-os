/**
 * mcp/toolsManifest.js
 * Canonical list of Gladius MCP tools — imported by the MCP server and the
 * REST API (/admin/api/mcp/tools) so they stay in sync.
 */

export const TOOLS = [
  {
    name: 'list_context_entries',
    description: 'List journal entries for a work item',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        types: {
          type: 'array', items: { type: 'string' },
          description: 'Filter by entry types (optional): nfr, discovery, acceptance, design, decision, note, test-plan, playbook',
        },
        org_id: { type: 'number', description: 'Org the work item belongs to (required)' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
  {
    name: 'write_context_entry',
    description: 'Write a context entry to a work item journal',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        org_id:       { type: 'number', description: 'Org the work item belongs to (required)' },
        entry_type:   { type: 'string', enum: ['nfr','discovery','acceptance','design','decision','note','test-plan','playbook'], description: 'Entry type' },
        title:        { type: 'string', description: 'Short title for the entry (recommended; max ~120 chars)' },
        content:      { type: 'string', description: 'Markdown content' },
        visibility:   { type: 'string', enum: ['item','descendants'], description: 'Defaults to item' },
        is_agent:     { type: 'boolean', description: 'Whether written by an AI agent (default: true)' },
      },
      required: ['work_item_id', 'org_id', 'entry_type', 'content'],
    },
  },
  {
    name: 'get_assembled_context',
    description: 'Get fully assembled context for a work item (journal entries + ancestor entries + org-level context), formatted for prompt injection',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id:      { type: 'number', description: 'Work item ID' },
        org_id:            { type: 'number', description: 'Org the work item belongs to (required)' },
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
        org_id: { type: 'number', description: 'Organization ID' },
        types:  { type: 'array', items: { type: 'string' }, description: 'Filter by context types (optional)' },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'write_org_context',
    description: 'Create a new org-level context entry (architecture standards, team agreements, security policies, etc.). Org context is shared knowledge available to all agents and playbooks in the org.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:  { type: 'number', description: 'Organization ID (required — cross-tenant guard)' },
        type:    { type: 'string', description: 'Context type (e.g. architecture, domain, process, security, standards, team-agreement, policy)' },
        title:   { type: 'string', description: 'Short descriptive title (max ~120 chars)' },
        content: { type: 'string', description: 'Markdown content' },
        tags:    { type: 'array', items: { type: 'string' }, description: 'Optional tags for filtering' },
      },
      required: ['org_id', 'type', 'title', 'content'],
    },
  },
  {
    name: 'get_work_item',
    description: 'Get work item details: title, description, display_key, stage, type, timestamps',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        org_id:       { type: 'number', description: 'Org the work item belongs to (required — prevents cross-org access)' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
  {
    name: 'search_work_items',
    description: 'Search work items by keyword and structured filters',
    inputSchema: {
      type: 'object',
      properties: {
        keyword:     { type: 'string', description: 'Full-text search across title, description, and comments' },
        stage_class: { type: 'string', enum: ['intake','queued','in-progress','done','cancelled'], description: 'Filter by stage class' },
        type_name:   { type: 'string', description: 'Filter by work item type name (e.g. "Bug", "Feature")' },
        priority:    { type: 'number', enum: [1,2,3,4], description: '1=critical, 2=high, 3=medium, 4=low' },
        assignee_id: { type: 'number', description: 'Filter by assignee user ID' },
        org_id:      { type: 'number', description: 'Org to search within (required)' },
        limit:       { type: 'number', description: 'Max results (default 20, max 100)' },
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
        work_item_id:    { type: 'number', description: 'Work item ID' },
        org_id:          { type: 'number', description: 'Org the work item belongs to (required)' },
        target_stage_id: { type: 'number', description: 'Destination stage ID' },
        comment:         { type: 'string', description: 'Optional comment to add with the transition' },
      },
      required: ['work_item_id', 'org_id', 'target_stage_id'],
    },
  },
  {
    name: 'get_session_context',
    description: 'Get a board snapshot for session orientation: active items (in-progress), queued items (up next), recently completed (last 7 days), and open decisions on active/queued work items. Call this at the start of a session instead of multiple search_work_items calls.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'number', description: 'Organization ID' },
      },
      required: ['org_id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a work item. Author is the configured agent identity (GLADIUS_AGENT_USER_ID).',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        org_id:       { type: 'number', description: 'Org the work item belongs to (required)' },
        body:         { type: 'string', description: 'Comment text (markdown supported)' },
        parent_id:    { type: 'number', description: 'Comment ID to reply to (optional)' },
      },
      required: ['work_item_id', 'org_id', 'body'],
    },
  },
  {
    name: 'set_work_item_fields',
    description: 'Update native fields or custom field values on a work item. Use field_values for custom fields like pr_url, pr_status, deployed_version.',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id:  { type: 'number', description: 'Work item ID' },
        org_id:        { type: 'number', description: 'Org the work item belongs to (required)' },
        priority:      { type: 'number', enum: [1,2,3,4], description: '1=critical, 2=high, 3=medium, 4=low' },
        tags:          { type: 'array', items: { type: 'string' }, description: 'Replace tag list' },
        estimate:      { type: 'number', description: 'Effort estimate' },
        estimate_unit: { type: 'string', enum: ['points','hours','days'], description: 'Unit for estimate' },
        due_date:      { type: 'string', description: 'Due date as ISO string (e.g. 2026-07-01)' },
        is_expedited:  { type: 'boolean', description: 'Mark as expedited' },
        field_values:  { type: 'object', description: 'Custom field key-value pairs (e.g. {"pr_url": "...", "pr_status": "merged", "deployed_version": "1.2.3"})' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
  {
    name: 'get_exit_criteria',
    description: 'Get exit criteria for the work item\'s current stage with their current pass/fail status. Call this to see what needs to be satisfied before transitioning.',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        org_id:       { type: 'number', description: 'Org the work item belongs to (required)' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
  {
    name: 'ack_exit_criterion',
    description: 'Acknowledge a manual exit criterion as met. Only works on criteria with criteria_tier = "manual". Get criterion IDs from get_exit_criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id:  { type: 'number', description: 'Work item ID' },
        org_id:        { type: 'number', description: 'Org the work item belongs to (required)' },
        criterion_id:  { type: 'number', description: 'Exit criterion ID (from get_exit_criteria response)' },
      },
      required: ['work_item_id', 'org_id', 'criterion_id'],
    },
  },
  {
    name: 'get_stage_playbook',
    description: 'Get the active playbook for a work item\'s current stage. Returns playbook content (markdown with YAML frontmatter), is_active flag, and execution_owner. Returns null if no active playbook exists for the current stage.',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        org_id:       { type: 'number', description: 'Org the work item belongs to (required)' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
  {
    name: 'get_available_transitions',
    description: 'Get the stages this work item can transition to from its current stage. Returns an empty array if the item is in a terminal stage or has no outbound transitions configured. Use to_stage_id values with transition_work_item.',
    inputSchema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'number', description: 'Work item ID' },
        org_id:       { type: 'number', description: 'Org the work item belongs to (required — prevents cross-org access)' },
      },
      required: ['work_item_id', 'org_id'],
    },
  },
]
