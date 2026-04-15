/**
 * api/routes/auth.js
 * Authentication endpoints: login, logout, session check, first-user setup.
 *
 * POST /auth/login     — email + password → session
 * POST /auth/logout    — destroy session
 * GET  /auth/me        — current user (or 401)
 * GET  /auth/status    — { needsSetup, authenticated } (public, no auth required)
 * POST /auth/setup     — create first admin user (only works when no users exist)
 */

import { Router } from 'express'
import { query } from '../../db/postgres.js'
import { generateUri } from '../../core/uri.js'
import {
  hashPassword,
  verifyPassword,
  findUserByEmail,
  findUserById,
} from '../../core/auth.js'

const router = Router()

// ─── GET /auth/status ──────────────────────────────────────────────────────
// Public — tells the frontend whether to show login or setup wizard.

router.get('/status', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT COUNT(*)::int AS count FROM blueprint.users WHERE password_hash IS NOT NULL'
    )
    const hasUsers = result.rows[0].count > 0
    const authenticated = !!req.session?.userId

    let user = null
    if (authenticated) {
      user = await findUserById(req.session.userId)
      if (user) {
        delete user.password_hash
      }
    }

    res.json({
      needsSetup: !hasUsers,
      authenticated,
      user,
    })
  } catch (err) { next(err) }
})

// ─── POST /auth/setup ──────────────────────────────────────────────────────
// Creates the first admin user. Only works when no users with passwords exist.

router.post('/setup', async (req, res, next) => {
  try {
    // Check if setup is still needed
    const check = await query(
      'SELECT COUNT(*)::int AS count FROM blueprint.users WHERE password_hash IS NOT NULL'
    )
    if (check.rows[0].count > 0) {
      return res.status(403).json({ error: 'Setup already complete. Use /auth/login instead.' })
    }

    const { email, password, display_name } = req.body
    if (!email?.trim())        return res.status(400).json({ error: 'email is required' })
    if (!password || password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' })
    if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' })

    const hash = await hashPassword(password)
    const uri = generateUri('system', 'users')

    // Upsert: if a user with this email already exists (from seed), update them
    const result = await query(`
      INSERT INTO blueprint.users (uri, email, display_name, password_hash, is_admin, is_active)
      VALUES ($1, $2, $3, $4, true, true)
      ON CONFLICT (email) DO UPDATE SET
        display_name  = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        is_admin      = true,
        updated_at    = NOW()
      RETURNING id, uri, email, display_name, is_admin
    `, [uri, email.toLowerCase().trim(), display_name.trim(), hash])

    const user = result.rows[0]

    // Start session immediately
    req.session.userId = user.id
    req.session.save((err) => {
      if (err) return next(err)
      res.status(201).json({ user })
    })
  } catch (err) { next(err) }
})

// ─── POST /auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'email and password are required' })
    }

    const user = await findUserByEmail(email)
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is deactivated' })
    }

    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Create session
    req.session.userId = user.id
    req.session.save((err) => {
      if (err) return next(err)
      res.json({
        user: {
          id:           user.id,
          uri:          user.uri,
          email:        user.email,
          display_name: user.display_name,
          is_admin:     user.is_admin,
        },
      })
    })
  } catch (err) { next(err) }
})

// ─── POST /auth/logout ─────────────────────────────────────────────────────

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err)
    res.clearCookie('flowos.sid')
    res.json({ ok: true })
  })
})

// ─── GET /auth/me ───────────────────────────────────────────────────────────
// Returns current user. 401 if not authenticated.

router.get('/me', async (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  try {
    const user = await findUserById(req.session.userId)
    if (!user) {
      req.session.destroy(() => {})
      return res.status(401).json({ error: 'User not found' })
    }
    res.json({ user })
  } catch (err) { next(err) }
})

export default router
