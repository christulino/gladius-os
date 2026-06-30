export const meta = {
  name: 'gladius-backlog-grinder',
  description: 'Serially implement ready Gladius backlog items to PR (no merge): curate live from board, sonnet implementers in isolated worktrees, batched human merge review',
  phases: [
    { title: 'Curate', detail: 'query Gladius org 109 for next ready items, apply exclusion + conflict-avoidance rules' },
    { title: 'Implement', detail: 'serial sonnet implementer per item -> worktree -> PR' },
    { title: 'Report', detail: 'collect PRs + outcomes for batched merge review' },
  ],
}

const ORG = 109
const COUNT = (args && args.count) || 5

const CURATE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          work_item_id: { type: 'number' },
          display_key: { type: 'string' },
          title: { type: 'string' },
          is_frontend: { type: 'boolean' },
          rationale: { type: 'string' },
        },
        required: ['work_item_id', 'display_key', 'title', 'is_frontend'],
      },
    },
    excluded_note: { type: 'string' },
  },
  required: ['items'],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    display_key: { type: 'string' },
    status: { type: 'string', enum: ['pr_opened', 'blocked', 'failed'] },
    pr_url: { type: 'string' },
    final_stage: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    test_result: { type: 'string' },
    blockers: { type: 'string' },
    discovered_items: { type: 'string' },
  },
  required: ['display_key', 'status'],
}

function implPrompt(item, frontendNote) {
  return [
    'You are a Gladius Worker. Dogfood Gladius-os: drive the work THROUGH the Gladius board via its MCP tools as you implement.',
    '',
    'SESSION GOAL - implement exactly one item:',
    '  ' + item.display_key + ' (work_item_id ' + item.work_item_id + ', org_id ' + ORG + ')',
    '  "' + item.title + '"',
    '',
    'START',
    '- Read the item and its journal: get_work_item + list_context_entries. The discovery entry holds the problem, approach, and acceptance criteria. Treat acceptance criteria as the definition of done.',
    '- Read the stage playbook and exit criteria up front: get_stage_playbook + get_exit_criteria for the stage(s) this item moves through. These are your operating instructions and your gates.',
    '- CLAIM IT FIRST to avoid double-implementation: get_available_transitions then transition_work_item to move it out of Backlog into the active/in-progress stage. Add a comment that you (agent) are starting it.',
    '',
    'PRE-BUILD GATE CHECK (run this BEFORE writing any code):',
    '- After claiming, call get_exit_criteria for the current stage and get_available_transitions to understand what gates stand between you and the build stage.',
    '- If any exit criterion is CURRENTLY FAILING for a reason the agent alone cannot resolve — for example: no_unresolved_decisions requires a human to resolve an open decision; manual-ack criteria require a human sign-off; external evidence criteria require an artifact the agent cannot produce — STOP IMMEDIATELY.',
    '- Do NOT write any implementation code. Do NOT open a PR. Add a comment on the item naming the specific blocking criterion and what human action is needed to unblock it. Return status "blocked" with that reason in blockers.',
    '- The gate is authority. A blocked criterion means the work is not ready to build. Honor it unconditionally — never route around it.',
    '',
    'PLAYBOOK & EXIT CRITERIA (non-negotiable)',
    '- You are the Worker: you execute and verify; Gladius frames and gates. Follow the stage playbook steps and satisfy the exit criteria exactly.',
    '- Check gates BEFORE writing code. Read exit criteria for each stage in your path before opening any editor or creating any file.',
    '- NEVER bypass, falsify, ignore, or waive an exit criterion to make progress. Only ack_exit_criterion when it is genuinely, verifiably satisfied. Never mark a criterion met that is not. Do not skip playbook steps.',
    '- If you cannot honestly satisfy a criterion, cannot follow a playbook step, or the item needs a Gladius decision resolved before it can succeed: STOP. add_comment on the item explaining exactly what blocked you (which criterion or step, and what is needed to unblock - e.g. a decision to resolve in Gladius), leave the item where it is (do NOT force it forward), and return status "blocked" with that reason in your blockers. Do not bypass the gate to keep going.',
    '',
    'ISOLATION (critical)',
    '- Do NOT work in /Users/chris/Documents/ai/gladius-os - that checkout is the live PM2 dogfood instance on :3000.',
    '- git fetch origin, then create a SEPARATE worktree off origin/main in a sibling dir (sanitize the dot in the key to a dash for the path):',
    '    git worktree add -b fix/' + item.display_key + '-work ../gladius-os-' + item.display_key.replace('.', '-') + ' origin/main',
    '  If that path already exists, append a numeric suffix. Do ALL work in that worktree.',
    '',
    'IMPLEMENT',
    '- Minimal, scope-disciplined change. Touch only what this item needs. If you discover other problems or follow-up work, WRITE IT BACK to Gladius as a note/discovery journal entry on the item (write_context_entry) AND mention it in your report - do not fix it here.' + frontendNote,
    '',
    'VERIFY (before PR)',
    '- npx eslint .',
    '- Run ONLY the specific test file(s) that cover your change (e.g. node --test tests/<file>.test.js) - do NOT run the whole suite. Many integration tests still write work items to the live dogfood board (org 109), so running the full suite pollutes it (DEBT.26004 follow-up: test isolation). If a test needs a running server, start one against YOUR worktree on an ALT port (e.g. 3011+) - never disturb :3000.',
    '- State the actual test + eslint output in your report. No "should pass".',
    '',
    'SHIP (PR only - do NOT merge)',
    '- Commit with the repo\'s required Co-Authored-By / Claude-Session trailers (copy the format from a recent commit), push the branch, open a PR against main with gh. Capture the PR URL.',
    '- You MUST NOT merge - merge is gated for human review and is denied by settings + branch protection.',
    '- Update Gladius: set the pr_url + pr_status custom fields via set_work_item_fields. IMPORTANT: field_values REPLACES the whole object, so pass BOTH keys in one call: {"pr_url":"<url>","pr_status":"open"}. Also add_comment with the PR link.',
    '- Then transition the item to the REVIEW stage only - do NOT push to Done. The Done gate requires pr_status=merged, which only the human sets after merging the PR.',
    '',
    'GUARDRAIL - serial supervised run:',
    '- If blocked, ambiguous, a step fails after ONE retry, you cannot honestly satisfy an exit criterion or playbook step, the item needs a Gladius decision resolved first, or you would need to touch shared/out-of-scope files: STOP, leave the item claimed with a comment explaining where you stopped, and return status "blocked". Do NOT churn, expand scope, or bypass/falsify a gate.',
    '',
    'Return your structured result: display_key, status (pr_opened|blocked|failed), pr_url, final_stage, files_changed, test_result, blockers, discovered_items.',
  ].join('\n')
}

phase('Curate')
const curated = await agent([
  'You are curating the Gladius dev backlog for an autonomous, SERIAL implementation loop. Org is ' + ORG + '.',
  'Use the gladius MCP tools (get_session_context, and search_work_items with org_id ' + ORG + ' and stage filters) to read the LIVE board right now.',
  '',
  'Return the next ' + COUNT + ' READY, INDEPENDENT work items to implement, in priority order (priority 1 first). Pick from items currently in Backlog/intake only.',
  '',
  'EXCLUSION RULES - never include:',
  '- Auto-generated test artifacts: titles containing "Field writes test", "Attribution test", "transitions test", "Playbook read test".',
  '- Conflict-cluster (shared schema/subscribers/mcp or large deletions, must be done sequentially with merges between): DEBT.25488, DEBT.25489, DEBT.25490, FEAT.25491, DEBT.25492, FEAT.25493, DEBT.25494, FEAT.25602, FEAT.25603, FEAT.25604, FEAT.25605.',
  '- Meta/infra: DEBT.25475 (worktree reconcile), DEBT.25483 (vague hardening).',
  '- Anything not currently in Backlog/intake (already in progress, in review, done, or claimed by another agent - check for an in-progress comment).',
  '- Work that targets a surface slated for deletion (e.g. the /v1 API surface per DEBT.25492) - flag in excluded_note and skip. Never polish code that is planned to be deleted.',
  '',
  'CONFLICT-AVOIDANCE (important for serial-to-PR with batched merge):',
  '- These PRs all branch off the same origin/main and are not merged until human review, so two items that edit the SAME hot file will collide at merge time.',
  '- admin/api.js is the biggest hot file (~80 endpoints). Do NOT pick more than ONE item per run that is likely to edit admin/api.js. Spread the batch across distinct files/subsystems (ui components, runtime/*, tests/, mcp/, etc.).',
  '',
  'Set is_frontend=true if the item primarily changes admin-ui React components. Return work_item_id, display_key, title, is_frontend, and a one-line rationale. Put any skipped-but-notable items (e.g. /v1-targeting) in excluded_note.',
].join('\n'), { label: 'curate-backlog', phase: 'Curate', schema: CURATE_SCHEMA })

const queue = ((curated && curated.items) || []).slice(0, COUNT)
log('Curated ' + queue.length + ' items: ' + queue.map(i => i.display_key).join(', '))
if (curated && curated.excluded_note) log('Curator note: ' + curated.excluded_note)

phase('Implement')
const results = []
for (const item of queue) {
  const frontendNote = item.is_frontend
    ? '\n- FRONTEND ITEM: after implementing, run a Playwright MCP smoke test against the running admin-ui to confirm the change renders (build/integration tests miss render bugs). Do this before opening the PR.'
    : ''
  const r = await agent(implPrompt(item, frontendNote), {
    label: 'impl:' + item.display_key,
    phase: 'Implement',
    model: 'sonnet',
    schema: IMPL_SCHEMA,
  })
  results.push(r || { display_key: item.display_key, status: 'failed', blockers: 'agent returned null' })
  log(item.display_key + ': ' + (r ? r.status : 'failed') + (r && r.pr_url ? ' ' + r.pr_url : ''))
}

phase('Report')
const blocked = results.filter(r => r && r.status === 'blocked')
const opened = results.filter(r => r && r.status === 'pr_opened')
const failed = results.filter(r => r && r.status === 'failed')
if (blocked.length) {
  log('=== ESCALATION NEEDED — BLOCKED ITEMS ===')
  for (const b of blocked) {
    log(b.display_key + ': ' + (b.blockers || 'no blocker detail — check item comments on the board'))
  }
}
if (opened.length) log('PRs opened: ' + opened.map(r => r.display_key + (r.pr_url ? ' ' + r.pr_url : '')).join(', '))
if (failed.length) log('Failed: ' + failed.map(r => r.display_key + (r.blockers ? ' — ' + r.blockers : '')).join(', '))
return { processed: results.length, queue: queue.map(i => i.display_key), results, blocked: blocked.map(b => ({ display_key: b.display_key, blocker: b.blockers })) }
