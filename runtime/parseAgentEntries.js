/**
 * runtime/parseAgentEntries.js
 *
 * Tolerant parser for stage-playbook model output. The model is asked for a
 * JSON array of { type, title, content } objects, but the output may be wrapped
 * in a ```json code fence and/or TRUNCATED by the model's token limit. A naive
 * JSON.parse throws on truncation, which previously caused the whole raw blob to
 * be stored as one unreadable "AI Analysis" note.
 *
 * Recovery strategy (most-to-least clean):
 *   1. Parse the whole array cleanly (fast path).
 *   2. Salvage every COMPLETE top-level object (brace-counted, string-aware so
 *      fences/braces/quotes inside `content` are not mistaken for structure).
 *   3. Recover the final, truncated object by extracting its fields with an
 *      escape-aware string reader — its `content` (readable markdown) is kept and
 *      marked as truncated.
 *
 * Returns { entries, truncated }. `truncated` is true whenever the clean parse
 * failed (the caller can log / raise max_tokens).
 */

export function parseAgentEntries(rawText) {
  if (!rawText || typeof rawText !== 'string') return { entries: [], truncated: false }

  const arrStart = rawText.indexOf('[')
  if (arrStart === -1) return { entries: [], truncated: false }
  const s = rawText.slice(arrStart)

  // 1. Fast path: the array (up to its last ']') parses cleanly.
  const cleanEnd = s.lastIndexOf(']')
  if (cleanEnd !== -1) {
    try {
      const arr = JSON.parse(s.slice(0, cleanEnd + 1))
      if (Array.isArray(arr)) return { entries: arr.filter(isEntry), truncated: false }
    } catch { /* fall through to salvage */ }
  }

  // 2 + 3. Salvage complete objects, then recover a truncated trailing object.
  const { complete, tail } = scanObjects(s)
  const entries = complete.filter(isEntry)
  if (tail) {
    const partial = extractPartialEntry(tail)
    if (partial) entries.push(partial)
  }
  return { entries, truncated: true }
}

function isEntry(o) {
  return o && typeof o === 'object' && typeof o.type === 'string' && typeof o.content === 'string'
}

/**
 * Brace-count through the array body collecting each complete top-level {...}
 * object (parsed in isolation). Returns the complete objects plus the substring
 * of any trailing object that was never closed (truncation).
 */
function scanObjects(s) {
  const complete = []
  let depth = 0, inString = false, escaped = false, objStart = -1

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { if (depth === 0) objStart = i; depth++; continue }
    if (ch === '}') {
      depth--
      if (depth === 0 && objStart !== -1) {
        try { complete.push(JSON.parse(s.slice(objStart, i + 1))) } catch { /* skip */ }
        objStart = -1
      }
    }
  }
  const tail = (depth > 0 && objStart !== -1) ? s.slice(objStart) : null
  return { complete, tail }
}

/** Recover a {type,title,content} entry from a truncated object substring. */
function extractPartialEntry(objStr) {
  const content = readField(objStr, 'content')
  if (!content || !content.value.trim()) return null
  const type  = readField(objStr, 'type')?.value || 'note'
  const title = readField(objStr, 'title')?.value || null
  const suffix = content.terminated ? '' : '\n\n_[output truncated]_'
  return { type, title, content: content.value + suffix }
}

/** Find `"key": "..."` and return the decoded string value (tolerant of truncation). */
function readField(objStr, key) {
  const re = new RegExp('"' + key + '"\\s*:\\s*"')
  const m = re.exec(objStr)
  if (!m) return null
  return readJsonString(objStr, m.index + m[0].length - 1)
}

/** Read a JSON string starting at the opening quote s[i]; returns { value, terminated }. */
function readJsonString(s, i) {
  let j = i + 1
  let buf = ''
  while (j < s.length) {
    const ch = s[j]
    if (ch === '\\') {
      const next = s[j + 1]
      if (next === undefined) return { value: buf, terminated: false } // dangling backslash
      switch (next) {
        case 'n': buf += '\n'; break
        case 't': buf += '\t'; break
        case 'r': buf += '\r'; break
        case 'b': buf += '\b'; break
        case 'f': buf += '\f'; break
        case '"': buf += '"'; break
        case '\\': buf += '\\'; break
        case '/': buf += '/'; break
        case 'u': {
          const hex = s.slice(j + 2, j + 6)
          if (hex.length === 4) { buf += String.fromCharCode(parseInt(hex, 16)); j += 4 }
          break
        }
        default: buf += next
      }
      j += 2
      continue
    }
    if (ch === '"') return { value: buf, terminated: true }
    buf += ch
    j++
  }
  return { value: buf, terminated: false }
}

export default { parseAgentEntries }
