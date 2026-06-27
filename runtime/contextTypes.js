/**
 * runtime/contextTypes.js
 * Canonical taxonomy for journal entry types (runtime.context_entries).
 *
 * NOTE: blueprint.org_context uses a separate, freely-named type system
 * (e.g. "architecture", "domain", "process") and is NOT constrained here.
 *
 * Keep in sync with:
 *   - db/migrations/022_context_entry_types.sql (CHECK constraint)
 *   - mcp/toolsManifest.js (entry_type enum)
 */

export const VALID_ENTRY_TYPES = Object.freeze([
  'nfr',
  'discovery',
  'acceptance',
  'design',
  'decision',
  'note',
  'test-plan',
  'playbook',
])

/**
 * Throw if `type` is not in the canonical taxonomy.
 * The thrown error carries `status: 400` and `expose: true` so the global
 * Express error handler will return it as a client error (not a 500).
 *
 * @param {string} type - the entry type to validate
 * @throws {Error} with status 400 and expose true
 */
export function assertValidEntryType(type) {
  if (!VALID_ENTRY_TYPES.includes(type)) {
    const err = new Error(
      `Invalid entry type "${type}". Must be one of: ${VALID_ENTRY_TYPES.join(', ')}.`,
    )
    err.status = 400
    err.expose = true
    throw err
  }
}
