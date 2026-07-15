/**
 * core/secrets.js
 * Fail-fast validation of the secrets the server actually requires at boot.
 *
 * Rationale (DEBT.26613): the app used to boot silently on a hardcoded
 * session-secret fallback and only discovered a missing encryption key lazily,
 * on the first AI-model call. Both are security foot-guns. We validate up front
 * and refuse to start with a clear, actionable message instead.
 *
 * Checked secrets:
 *   - SESSION_SECRET         (core/auth.js session store) — must be present,
 *                            non-trivial, and not the well-known dev placeholder.
 *   - GLADIUS_ENCRYPTION_KEY (runtime/orgAiModels.js AES-256-GCM) — must be a
 *                            32-byte value, i.e. exactly 64 hex characters.
 *
 * CI generates both via `openssl rand -hex 32` (64 hex chars), so these rules
 * pass CI. A real dev/prod value passes too.
 */

// The literal fallback baked into core/auth.js's session middleware. Booting on
// this value is equivalent to having no secret at all, so we reject it.
const SESSION_SECRET_PLACEHOLDER = 'gladius-dev-secret-change-in-production'

// Minimum acceptable length for SESSION_SECRET. `openssl rand -hex 32` is 64
// chars; this only rejects trivially short secrets, never CI/dev values.
const SESSION_SECRET_MIN_LENGTH = 16

const HEX_64 = /^[0-9a-fA-F]{64}$/

/**
 * Returns an array of human-readable error messages, one per invalid secret.
 * Empty array means all required secrets are valid.
 */
export function checkRequiredSecrets(env = process.env) {
  const errors = []

  const sessionSecret = (env.SESSION_SECRET || '').trim()
  if (!sessionSecret) {
    errors.push(
      'SESSION_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to your environment.'
    )
  } else if (sessionSecret === SESSION_SECRET_PLACEHOLDER) {
    errors.push(
      'SESSION_SECRET is still the built-in dev placeholder. Set a real secret (`openssl rand -hex 32`).'
    )
  } else if (sessionSecret.length < SESSION_SECRET_MIN_LENGTH) {
    errors.push(
      'SESSION_SECRET is too short (min ' +
        SESSION_SECRET_MIN_LENGTH +
        ' chars). Use `openssl rand -hex 32`.'
    )
  }

  const encryptionKey = (env.GLADIUS_ENCRYPTION_KEY || '').trim()
  if (!encryptionKey) {
    errors.push(
      'GLADIUS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` (32-byte hex) and add it to your environment.'
    )
  } else if (!HEX_64.test(encryptionKey)) {
    errors.push(
      'GLADIUS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate one with `openssl rand -hex 32`.'
    )
  }

  return errors
}

/**
 * Validates required secrets and, on any failure, logs each problem and exits
 * the process with a non-zero code. Call this before `app.listen`.
 */
export function assertRequiredSecrets(env = process.env) {
  const errors = checkRequiredSecrets(env)
  if (errors.length === 0) return

  console.error('[secrets] Refusing to start — required secrets are missing or invalid:')
  for (const err of errors) console.error(`[secrets]   - ${err}`)
  process.exit(1)
}
