/**
 * simulation/agentBase.js
 * Base class for all simulation agents.
 * Subclasses define action weights and implement action methods.
 */

import { logActivity } from './activityLog.js'

export class AgentBase {
  /**
   * @param {Object} config
   * @param {string} config.name       - Human-readable agent name
   * @param {string} config.orgSlug    - Primary org this agent works in
   * @param {string} config.role       - Role description (for display)
   * @param {string} config.userEmail  - Email of the user this agent acts as
   * @param {number} config.cooldownTicks - Ticks to wait after acting (default 1)
   */
  constructor({ name, orgSlug, role, userEmail, cooldownTicks = 1 }) {
    this.name          = name
    this.orgSlug       = orgSlug
    this.role          = role
    this.userEmail     = userEmail
    this.cooldownTicks = cooldownTicks
    this.ticksRemaining = 0
    this.lastAction     = null
    this.lastActionTime = null
    this.actionCount    = 0
    this.userId         = null  // resolved on first tick
  }

  /**
   * Called each tick. Returns { action, params } or null to skip.
   * Subclasses must override.
   */
  async decide(_world) {
    return null
  }

  /**
   * Execute the decided action. Subclasses must override.
   * @returns {Object} { detail, workItemId } for logging
   */
  async act(_action, _params, _apiClient) {
    return { detail: 'no-op' }
  }

  /**
   * Main tick handler — called by orchestrator.
   */
  async tick(world, apiClient) {
    // Resolve userId on first tick
    if (this.userId === null) {
      const user = world.userByEmail(this.userEmail)
      this.userId = user?.id || 1
    }

    // Cooldown
    if (this.ticksRemaining > 0) {
      this.ticksRemaining--
      return null
    }

    try {
      const decision = await this.decide(world)
      if (!decision) return null

      const { action, params } = decision
      const result = await this.act(action, params, apiClient)

      this.lastAction     = action
      this.lastActionTime = new Date().toISOString()
      this.actionCount++
      this.ticksRemaining = this.cooldownTicks

      logActivity(this.name, action, result.detail, result.workItemId)

      return { action, ...result }
    } catch (err) {
      logActivity(this.name, 'error', `${err.message}`)
      return null
    }
  }

  /**
   * Weighted random selection from an array of { action, weight } entries.
   * Only includes actions whose weight > 0.
   */
  weightedPick(actions) {
    const total = actions.reduce((sum, a) => sum + a.weight, 0)
    if (total === 0) return null
    let r = Math.random() * total
    for (const a of actions) {
      r -= a.weight
      if (r <= 0) return a.action
    }
    return actions[actions.length - 1].action
  }

  /** Status snapshot for the UI */
  status() {
    return {
      name:           this.name,
      orgSlug:        this.orgSlug,
      role:           this.role,
      lastAction:     this.lastAction,
      lastActionTime: this.lastActionTime,
      actionCount:    this.actionCount,
      cooldown:       this.ticksRemaining,
    }
  }
}
