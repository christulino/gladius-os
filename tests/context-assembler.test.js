// tests/context-assembler.test.js
//
// Tests for the context assembler — the component that gathers journal entries,
// ancestor context, and org-level context before AI playbook execution.
//
// Coverage:
//   formatContextForPrompt — pure function; tested without any DB access
//   assembleContext        — DB integration; creates throwaway data, verifies
//                            pull_types filtering, 'ancestors' traversal, org context

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { query } from '../db/postgres.js'
import { assembleContext, formatContextForPrompt, MAX_CONTEXT_CHARS } from '../runtime/contextAssembler.js'
import { createWorkItem } from '../runtime/workItems.js'
import { createContextEntry } from '../runtime/contextEntries.js'

const ORG_ID   = 109   // Gladius Development
const TYPE_ID  = 140   // Tech Debt
const AGENT_ID = 309   // agent@flowos.internal

// ── formatContextForPrompt ────────────────────────────────────────────────────

describe('formatContextForPrompt', () => {
  const EMPTY = { itemJournal: [], ancestors: [], orgContext: [] }

  it('returns empty string when all context arrays are empty', () => {
    const result = formatContextForPrompt(EMPTY)
    assert.equal(result, '')
  })

  it('includes Org Context section when orgContext has entries', () => {
    const ctx = {
      ...EMPTY,
      orgContext: [{ type: 'nfr', title: 'No secrets', content: 'Never log secrets.' }],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.includes('## Org Context'), 'should include ## Org Context header')
    assert.ok(result.includes('No secrets'), 'should include entry title')
    assert.ok(result.includes('Never log secrets'), 'should include entry content')
  })

  it('includes Item Journal section when itemJournal has entries', () => {
    const ctx = {
      ...EMPTY,
      itemJournal: [{ type: 'discovery', title: 'Scope', content: 'Auth service scope.' }],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.includes('## Item Journal'), 'should include ## Item Journal header')
    assert.ok(result.includes('Auth service scope'), 'should include entry content')
  })

  it('includes Ancestor Context section when ancestors has entries', () => {
    const ctx = {
      ...EMPTY,
      ancestors: [{ type: 'note', title: 'Parent note', content: 'Parent scope.', work_item_id: 1 }],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.includes('## Ancestor Context'), 'should include ## Ancestor Context header')
    assert.ok(result.includes('Parent scope'), 'should include ancestor content')
  })

  it('renders all three sections in org → ancestors → journal order', () => {
    const ctx = {
      orgContext:  [{ type: 'nfr', title: 'Org NFR', content: 'org content' }],
      ancestors:   [{ type: 'note', title: 'Ancestor', content: 'ancestor content', work_item_id: 1 }],
      itemJournal: [{ type: 'discovery', title: 'Item', content: 'item content' }],
    }
    const result = formatContextForPrompt(ctx)
    const orgPos      = result.indexOf('## Org Context')
    const ancestorPos = result.indexOf('## Ancestor Context')
    const journalPos  = result.indexOf('## Item Journal')
    assert.ok(orgPos !== -1,      '## Org Context must be present')
    assert.ok(ancestorPos !== -1, '## Ancestor Context must be present')
    assert.ok(journalPos !== -1,  '## Item Journal must be present')
    assert.ok(orgPos < ancestorPos, 'Org Context must precede Ancestor Context')
    assert.ok(ancestorPos < journalPos, 'Ancestor Context must precede Item Journal')
  })

  it('omits missing sections without inserting blank headers', () => {
    const ctx = {
      ...EMPTY,
      itemJournal: [{ type: 'note', title: null, content: 'only journal' }],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(!result.includes('## Org Context'),     'should omit Org Context section')
    assert.ok(!result.includes('## Ancestor Context'), 'should omit Ancestor Context section')
    assert.ok(result.includes('## Item Journal'),      'should include Item Journal section')
  })

  // ── Provenance fencing (DEBT.25498) ────────────────────────────────────────

  it('tags human journal entries with [human] provenance label', () => {
    const ctx = {
      ...EMPTY,
      itemJournal: [{ type: 'discovery', title: 'Scope', content: 'human-written', is_agent: false }],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.includes('[human]'), 'human entries must be tagged [human]')
    assert.ok(!result.includes('[agent]'), 'no agent tag expected for human-only journal')
  })

  it('tags agent journal entries with [agent] provenance label', () => {
    const ctx = {
      ...EMPTY,
      itemJournal: [{ type: 'note', title: 'Brief', content: 'agent-written', is_agent: true }],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.includes('[agent]'), 'agent entries must be tagged [agent]')
    assert.ok(!result.includes('[human]'), 'no human tag expected for agent-only journal')
  })

  it('correctly fences a mix of human and agent journal entries', () => {
    const ctx = {
      ...EMPTY,
      itemJournal: [
        { type: 'discovery', title: 'Human disc', content: 'from human', is_agent: false },
        { type: 'note',      title: 'Agent note', content: 'from agent', is_agent: true },
      ],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.includes('[human]'), 'must include [human] tag')
    assert.ok(result.includes('[agent]'), 'must include [agent] tag')
    // Human tag must precede agent tag (most-recent-first order means human disc entry was added second)
    // — just assert both labels are present and both contents are included
    assert.ok(result.includes('from human'), 'human content must be present')
    assert.ok(result.includes('from agent'), 'agent content must be present')
  })

  it('tags ancestor entries with [human] or [agent] based on is_agent', () => {
    const ctx = {
      ...EMPTY,
      ancestors: [
        { type: 'nfr', title: 'Human NFR', content: 'human ancestor', is_agent: false, work_item_id: 1 },
        { type: 'note', title: 'Agent note', content: 'agent ancestor', is_agent: true, work_item_id: 1 },
      ],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.includes('[human]'), 'human ancestor must be tagged [human]')
    assert.ok(result.includes('[agent]'), 'agent ancestor must be tagged [agent]')
  })

  it('defaults to [human] when is_agent is missing (legacy entries)', () => {
    const ctx = {
      ...EMPTY,
      itemJournal: [{ type: 'discovery', title: 'Old entry', content: 'no flag set' }],
    }
    const result = formatContextForPrompt(ctx)
    // is_agent undefined → falsy → treated as human
    assert.ok(result.includes('[human]'), 'entries without is_agent flag must default to [human]')
    assert.ok(!result.includes('[agent]'), 'should not inject spurious [agent] tag')
  })

  // ── Character budget (DEBT.25498) ───────────────────────────────────────────

  it('returns context unchanged when within MAX_CONTEXT_CHARS', () => {
    const ctx = {
      ...EMPTY,
      itemJournal: [{ type: 'note', title: 'T', content: 'short', is_agent: false }],
    }
    const result = formatContextForPrompt(ctx)
    assert.ok(result.length < MAX_CONTEXT_CHARS, 'short context must not be truncated')
    assert.ok(!result.includes('context truncated to budget'), 'no truncation notice for short context')
  })

  it('truncates to MAX_CONTEXT_CHARS and appends a notice when budget is exceeded', () => {
    const longContent = 'x'.repeat(MAX_CONTEXT_CHARS)
    const ctx = {
      ...EMPTY,
      orgContext: [{ type: 'nfr', title: 'Giant entry', content: longContent }],
    }
    const result = formatContextForPrompt(ctx)
    // Truncation notice adds a small suffix — allow up to 200 chars of overhead
    assert.ok(result.length <= MAX_CONTEXT_CHARS + 200, 'output must be bounded near MAX_CONTEXT_CHARS')
    assert.ok(result.includes('context truncated to budget'), 'must append truncation notice')
  })
})

// ── assembleContext ───────────────────────────────────────────────────────────

describe('assembleContext', () => {
  let workItemId
  let parentWorkItemId
  let orgContextId

  before(async () => {
    // Create a parent work item
    const parent = await createWorkItem(
      { title: 'assembler test parent ' + Date.now(), work_item_type_id: TYPE_ID, owner_org_id: ORG_ID },
      AGENT_ID,
    )
    parentWorkItemId = parent.id
    assert.ok(parentWorkItemId, 'failed to create parent work item')

    // Create a child work item
    const child = await createWorkItem(
      {
        title: 'assembler test child ' + Date.now(),
        work_item_type_id: TYPE_ID,
        owner_org_id: ORG_ID,
        parent_id: parentWorkItemId,
      },
      AGENT_ID,
    )
    workItemId = child.id
    assert.ok(workItemId, 'failed to create child work item')

    // Create discovery entries on the child
    await createContextEntry(workItemId, { type: 'discovery', title: 'Child disc', content: 'Child discovery.', authorId: AGENT_ID, isAgent: true })
    // Create a design entry on the child (should NOT appear when pulling 'discovery')
    await createContextEntry(workItemId, { type: 'design', title: 'Child design', content: 'Child design note.', authorId: AGENT_ID, isAgent: true })
    // Create a note entry on the child (DEBT.25727 — Planning playbook must pull Worker analysis notes)
    await createContextEntry(workItemId, { type: 'note', title: 'Worker analysis', content: 'Code-verified prior analysis.', authorId: AGENT_ID, isAgent: true })
    // Create an NFR entry on the parent (used for ancestor traversal)
    await createContextEntry(parentWorkItemId, { type: 'nfr', title: 'Parent NFR', content: 'Parent nfr.', authorId: AGENT_ID, isAgent: true })

    // Create a throwaway org context entry
    const { rows } = await query(`
      INSERT INTO blueprint.org_context (org_id, type, title, content, author_id)
      VALUES ($1, 'nfr', $2, 'Org NFR content.', $3)
      RETURNING id
    `, [ORG_ID, '__test org context ' + Date.now(), AGENT_ID])
    orgContextId = rows[0].id
  })

  after(async () => {
    if (orgContextId) {
      await query('DELETE FROM blueprint.org_context WHERE id = $1', [orgContextId]).catch(() => {})
    }
    for (const id of [workItemId, parentWorkItemId]) {
      if (!id) continue
      for (const sql of [
        'DELETE FROM runtime.exit_criteria_status WHERE work_item_id = $1',
        'DELETE FROM runtime.context_entries WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = $1',
        'DELETE FROM runtime.work_item_search WHERE work_item_id = $1',
      ]) await query(sql, [id]).catch(() => {})
      await query('DELETE FROM runtime.work_items WHERE id = $1', [id]).catch(() => {})
    }
  })

  it('returns empty arrays when meta has no pull or org types configured', async () => {
    const ctx = await assembleContext(workItemId, ORG_ID, {})
    assert.deepEqual(ctx.itemJournal, [], 'itemJournal should be empty')
    assert.deepEqual(ctx.ancestors,   [], 'ancestors should be empty')
    assert.deepEqual(ctx.orgContext,  [], 'orgContext should be empty')
  })

  it('fetches only journal entries matching the pull type', async () => {
    const ctx = await assembleContext(workItemId, ORG_ID, {
      context: { pull: ['discovery'], org: [] },
    })
    assert.ok(ctx.itemJournal.length >= 1, 'should have at least one discovery entry')
    for (const e of ctx.itemJournal) {
      assert.equal(e.type, 'discovery', `expected only discovery entries, got type '${e.type}'`)
    }
  })

  it('does not include entries of non-requested types', async () => {
    const ctx = await assembleContext(workItemId, ORG_ID, {
      context: { pull: ['acceptance'], org: [] },
    })
    // No acceptance entries were created — result should be empty
    assert.equal(ctx.itemJournal.length, 0, 'should return no entries for a type not present')
  })

  // DEBT.25727 — Planning playbook context.pull excluded note, making prior Worker
  // analysis (code-verified corrections to stale Discovery entries) invisible to the
  // Planning AI. Regression test: note entries MUST be returned when pull includes 'note'.
  it('includes note entries when pull contains note (DEBT.25727)', async () => {
    const ctx = await assembleContext(workItemId, ORG_ID, {
      context: { pull: ['note'], org: [] },
    })
    assert.ok(ctx.itemJournal.length >= 1, 'should return at least one note entry')
    for (const e of ctx.itemJournal) {
      assert.equal(e.type, 'note', `expected only note entries, got type '${e.type}'`)
    }
    const titles = ctx.itemJournal.map(e => e.title)
    assert.ok(titles.includes('Worker analysis'), 'should include the Worker analysis note')
  })

  it('note entries are excluded when pull does not include note (DEBT.25727)', async () => {
    const ctx = await assembleContext(workItemId, ORG_ID, {
      context: { pull: ['discovery'], org: [] },
    })
    for (const e of ctx.itemJournal) {
      assert.notEqual(e.type, 'note', 'note entries must not appear when pull omits note')
    }
  })

  it('fetches ancestor journal entries when pull includes ancestors sentinel', async () => {
    const ctx = await assembleContext(workItemId, ORG_ID, {
      context: { pull: ['ancestors'], org: [] },
    })
    // The parent has an NFR entry that should appear in ancestors
    assert.ok(ctx.ancestors.length >= 1, 'should have at least one ancestor entry')
    // Ancestor entries must NOT include the child (only actual ancestors)
    for (const a of ctx.ancestors) {
      assert.notEqual(a.work_item_id, workItemId, 'ancestor entries must not include the item itself')
    }
  })

  it('fetches org context when org types are specified', async () => {
    const ctx = await assembleContext(workItemId, ORG_ID, {
      context: { pull: [], org: ['nfr'] },
    })
    assert.ok(ctx.orgContext.length >= 1, 'should have at least one org context entry')
    for (const e of ctx.orgContext) {
      assert.equal(e.type, 'nfr', `expected only nfr org context, got type '${e.type}'`)
    }
  })
})
