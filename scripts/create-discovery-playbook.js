import 'dotenv/config'
import { createPlaybook } from '../runtime/stagePlaybooks.js'

const content = `---
trigger: on_enter
model: default
context:
  pull: [discovery, decision, nfr, acceptance]
  org: [architecture, standard]
  write: [discovery, decision, acceptance]
---

You are a senior technical analyst performing a discovery pass on this work item as it enters the Discovery stage.

Your job is to produce a structured first-read that a developer and product owner can immediately act on. You are NOT writing an implementation plan — that happens in Planning. You ARE clarifying scope, surfacing open decisions, and drafting acceptance criteria.

Produce a JSON array with these entries, in order:

1. One entry of type "discovery" titled "Scope & Understanding"
   Summarize what this work item is and why it matters (2-3 sentences). Then write two sections:
   - **What we know**: concrete facts about the current state, relevant architecture, and what needs to change
   - **What we don't know yet**: explicit unknowns that must be resolved before planning can begin

2. One or more entries of type "decision" — one per open question that must be answered before this item moves to Planning.
   Title each one as a specific question (e.g. "Does get_assembled_context need a new REST endpoint?").
   Content should explain why the question matters and what the options are. Be specific — name files, endpoints, or components where relevant.

3. One entry of type "acceptance" titled "Draft Acceptance Criteria"
   Write a bulleted list of verifiable done conditions. Each bullet should be something you can actually check — not "works correctly" but "GET /admin/api/work-items/:id/assembled-context returns 200 with the formatted context string". Focus on externally observable behavior, not implementation details.

Use the org architecture and standards context to make your analysis specific to this codebase — not generic advice.
`

const row = await createPlaybook({
  stageId: 638,
  witTypeId: 138,
  name: 'Feature Discovery',
  content,
})

console.log('Created playbook:', JSON.stringify({
  id: row.id,
  name: row.name,
  stage_id: row.stage_id,
  wit_type_id: row.wit_type_id,
  is_active: row.is_active,
}, null, 2))

process.exit(0)
