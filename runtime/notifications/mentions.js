/**
 * runtime/notifications/mentions.js
 * Pure function: extract user ids from @handle mentions in a body string.
 * The handle→id map is passed in — caller is responsible for populating it.
 */

const MENTION_RE = /@([A-Za-z0-9_.-]+)/g

export function extractMentions(body, handleToId) {
  if (!body || typeof body !== 'string') return []
  const out = new Set()
  let m
  while ((m = MENTION_RE.exec(body)) !== null) {
    const id = handleToId[m[1]]
    if (id) out.add(id)
  }
  return [...out]
}

export default { extractMentions }
