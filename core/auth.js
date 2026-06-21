/**
 * core/auth.js
 * Authentication utilities — password hashing, session middleware, route guards.
 *
 * Stack: bcrypt for passwords, express-session + connect-pg-simple for sessions.
 * Sessions are stored in runtime.sessions (PostgreSQL).
 */

import bcrypt from 'bcrypt'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import pg from 'pg'
import { query } from '../db/postgres.js'

const SALT_ROUNDS = 12

// ─── Password utilities ────────────────────────────────────────────────────

export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS)
}

export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash)
}

// ─── Session middleware ────────────────────────────────────────────────────

export function createSessionMiddleware() {
  const PgSession = connectPgSimple(session)

  // Separate pool for session store — keeps it independent of app queries
  const sessionPool = new pg.Pool({
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB       || 'flowos',
    user:     process.env.POSTGRES_USER     || 'flowos',
    password: process.env.POSTGRES_PASSWORD,
    max:      3,
  })

  return session({
    store: new PgSession({
      pool: sessionPool,
      schemaName: 'runtime',
      tableName: 'sessions',
      createTableIfMissing: false,  // We create it in migration 010
    }),
    secret: process.env.SESSION_SECRET || 'gladius-dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge:   24 * 60 * 60 * 1000,  // 24 hours
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
    },
    name: 'gladius.sid',
  })
}

// ─── Route guards ──────────────────────────────────────────────────────────

/**
 * Middleware: requires an authenticated session OR a valid Bearer API token.
 * Attaches req.userId for downstream use.
 *
 * Auth order: Bearer token → session. Bearer is required for non-human callers
 * (MCP server, automation) which can't maintain a cookie session.
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization']
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const user = await findUserByApiToken(token)
      if (user) {
        req.userId = user.id
        return next()
      }
      return res.status(401).json({ error: 'Invalid API token' })
    }

    if (req.session?.userId) {
      req.userId = req.session.userId
      return next()
    }

    res.status(401).json({ error: 'Authentication required' })
  } catch (err) {
    next(err)
  }
}

/**
 * Middleware: checks whether initial setup is complete.
 * If no users exist, allows unauthenticated access to /auth/setup only.
 */
export async function setupGuard(req, res, next) {
  // Cache the check — once setup is done it never reverts
  if (setupGuard._setupComplete) {
    return next()
  }

  try {
    const result = await query('SELECT COUNT(*)::int AS count FROM blueprint.users WHERE password_hash IS NOT NULL')
    const hasUsers = result.rows[0].count > 0
    if (hasUsers) {
      setupGuard._setupComplete = true
    }
    req.needsSetup = !hasUsers
    next()
  } catch (err) {
    next(err)
  }
}
setupGuard._setupComplete = false

// ─── User lookup ───────────────────────────────────────────────────────────

export async function findUserByEmail(email) {
  const result = await query(
    'SELECT id, uri, email, display_name, password_hash, is_admin, is_active FROM blueprint.users WHERE email = $1',
    [email.toLowerCase().trim()]
  )
  return result.rows[0] || null
}

export async function findUserById(id) {
  const result = await query(
    'SELECT id, uri, email, display_name, is_admin, is_active FROM blueprint.users WHERE id = $1',
    [id]
  )
  return result.rows[0] || null
}

export async function findUserByApiToken(token) {
  if (!token?.startsWith('fos_ak_')) return null
  const result = await query(
    'SELECT id, uri, email, display_name, is_admin, is_active, is_agent FROM blueprint.users WHERE api_token = $1 AND is_active = true',
    [token]
  )
  return result.rows[0] || null
}
