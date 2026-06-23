// tests/parse-agent-entries.test.js
//
// Unit tests for parseAgentEntries — the tolerant parser for stage-playbook
// model output. It must handle: clean JSON arrays, code-fence-wrapped arrays,
// objects whose `content` contains markdown with its own ``` fences / braces /
// escaped quotes, and TRUNCATED arrays (the real bug: max_tokens cut the model
// off mid-array, JSON.parse threw, and the raw blob got stored as one note).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentEntries } from '../runtime/parseAgentEntries.js'

describe('parseAgentEntries', () => {
  it('parses a clean JSON array', () => {
    const raw = JSON.stringify([
      { type: 'note', title: 'A', content: '## Hi' },
      { type: 'decision', title: 'B', content: 'pick one' },
    ])
    const { entries, truncated } = parseAgentEntries(raw)
    assert.equal(entries.length, 2)
    assert.equal(entries[0].type, 'note')
    assert.equal(entries[1].content, 'pick one')
    assert.equal(truncated, false)
  })

  it('strips an outer ```json code fence', () => {
    const raw = '```json\n' + JSON.stringify([{ type: 'note', title: 'T', content: 'body' }]) + '\n```'
    const { entries } = parseAgentEntries(raw)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].content, 'body')
  })

  it('preserves content containing ``` fences, braces, and quotes', () => {
    // realistic: the model emits VALID JSON whose content is markdown with its
    // own fences/braces/quotes (JSON.stringify escapes newlines + quotes for us)
    const content = 'Run:\n```bash\necho {hi}\n```\nHe said "go" {now}'
    const raw = '```json\n' + JSON.stringify([{ type: 'note', title: 'X', content }]) + '\n```'
    const { entries } = parseAgentEntries(raw)
    assert.equal(entries.length, 1)
    assert.match(entries[0].content, /```bash/)   // inner fence preserved
    assert.match(entries[0].content, /\{now\}/)   // inner brace not mistaken for structure
    assert.match(entries[0].content, /"go"/)      // inner quote survived
  })

  it('salvages a complete object AND recovers a truncated trailing object', () => {
    const first = JSON.stringify({ type: 'note', title: 'First', content: '## Done\n\nfull object' })
    const raw = '```json\n[\n' + first + ',\n' +
      '{"type":"note","title":"Second","content":"## Overview\\n\\nthis got cut off mid sen'
    const { entries, truncated } = parseAgentEntries(raw)
    assert.equal(entries.length, 2, 'complete object + recovered partial')
    assert.equal(entries[0].title, 'First')
    assert.equal(entries[1].title, 'Second')
    assert.match(entries[1].content, /## Overview/)           // readable content recovered
    assert.match(entries[1].content, /_\[output truncated\]_/) // marked as truncated
    assert.equal(truncated, true)
  })

  it('recovers content from a single object truncated mid-content (the real bug)', () => {
    // mirrors entries 53–55: one fence-wrapped object, content cut off, no close
    const raw = '```json\n[\n  {\n    "type": "note",\n    "title": "Dev/Test Brief",\n' +
      '    "content": "## Overview\\n\\nRefactor the server.\\n\\n```bash\\nnpm install\\n```\\n\\nfile: `mcp/http-client.js`\\n-'
    const { entries, truncated } = parseAgentEntries(raw)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].type, 'note')
    assert.equal(entries[0].title, 'Dev/Test Brief')
    assert.match(entries[0].content, /## Overview/)
    assert.match(entries[0].content, /```bash/)               // inner fence preserved, unescaped
    assert.match(entries[0].content, /_\[output truncated\]_/)
    assert.equal(truncated, true)
  })

  it('returns no entries for non-array / garbage', () => {
    assert.deepEqual(parseAgentEntries('I could not complete this task.').entries, [])
    assert.deepEqual(parseAgentEntries('').entries, [])
    assert.deepEqual(parseAgentEntries(null).entries, [])
  })
})
