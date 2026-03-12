/**
 * simulation/orchestrator.js
 * Tick loop, agent lifecycle, state machine.
 *
 * States: idle → running ↔ paused → idle
 */

import { WorldState }        from './worldState.js'
import { apiClient }         from './apiClient.js'
import { logActivity }       from './activityLog.js'
import { DeveloperAgent }    from './agents/developer.js'
import { ProductOwnerAgent } from './agents/productOwner.js'
import { TechSupportAgent }  from './agents/techSupport.js'
import { TesterAgent }       from './agents/tester.js'

/** Default agent configuration — maps to seeded enterprise users */
const DEFAULT_AGENTS = [
  // Payments team
  { Class: DeveloperAgent,    name: 'Raj (Dev)',        orgSlug: 'payments',          role: 'Developer',     userEmail: 'raj.patel@flowos.dev' },
  { Class: DeveloperAgent,    name: 'Lisa (Dev)',       orgSlug: 'payments',          role: 'Developer',     userEmail: 'lisa.nakamura@flowos.dev' },
  { Class: ProductOwnerAgent, name: 'David (PO)',       orgSlug: 'payments',          role: 'Product Owner', userEmail: 'david.okafor@flowos.dev' },

  // Mobile team
  { Class: DeveloperAgent,    name: 'Yuki (Dev)',       orgSlug: 'mobile-experience', role: 'Developer',     userEmail: 'yuki.tanaka@flowos.dev' },
  { Class: DeveloperAgent,    name: 'James (Dev)',      orgSlug: 'mobile-experience', role: 'Developer',     userEmail: 'james.morrison@flowos.dev' },
  { Class: ProductOwnerAgent, name: 'Priya (PO)',       orgSlug: 'mobile-experience', role: 'Product Owner', userEmail: 'priya.sharma@flowos.dev' },

  // Product Engineering ART (cross-team)
  { Class: ProductOwnerAgent, name: 'Marcus (PO)',      orgSlug: 'product-engineering', role: 'Product Owner', userEmail: 'marcus.williams@flowos.dev' },
  { Class: TesterAgent,       name: 'Elena (QA)',       orgSlug: 'payments',          role: 'Tester',        userEmail: 'elena.vasquez@flowos.dev' },

  // IT Service Desk
  { Class: TechSupportAgent,  name: 'Maria (Support)',  orgSlug: 'it-service-desk',   role: 'Support Lead',  userEmail: 'maria.santos@flowos.dev' },
  { Class: TechSupportAgent,  name: 'Kevin (Support)',  orgSlug: 'it-service-desk',   role: 'Support Agent', userEmail: 'kevin.brown@flowos.dev' },

  // Cloud Infra
  { Class: DeveloperAgent,    name: 'Nina (Infra)',     orgSlug: 'cloud-infra',       role: 'Engineer',      userEmail: 'nina.kowalski@flowos.dev' },
  { Class: DeveloperAgent,    name: 'Omar (Infra)',     orgSlug: 'cloud-infra',       role: 'Engineer',      userEmail: 'omar.hassan@flowos.dev' },
]

class Orchestrator {
  constructor() {
    this.state     = 'idle'    // idle | running | paused
    this.agents    = []
    this.world     = new WorldState()
    this.tickCount = 0
    this.speed     = 1         // 1x–10x multiplier
    this.startedAt = null
    this._timer    = null
  }

  /** Base tick interval in ms (adjusted by speed) */
  get tickInterval() {
    return Math.max(500, 2000 / this.speed)
  }

  /**
   * Start the simulation.
   * @param {Object} [options]
   * @param {number} [options.speed] - Tick speed multiplier 1–10
   * @param {Array}  [options.agents] - Custom agent config (uses defaults if omitted)
   */
  async start(options = {}) {
    if (this.state === 'running') return { error: 'Already running' }

    this.speed = Math.min(10, Math.max(1, options.speed || 1))
    this.tickCount = 0
    this.startedAt = new Date().toISOString()

    // Initialize agents
    const agentConfigs = options.agents || DEFAULT_AGENTS
    this.agents = agentConfigs.map(cfg => new cfg.Class({
      name:      cfg.name,
      orgSlug:   cfg.orgSlug,
      role:      cfg.role,
      userEmail: cfg.userEmail,
    }))

    // Initial world state refresh
    try {
      await this.world.refresh()
    } catch (err) {
      return { error: `Failed to load world state: ${err.message}` }
    }

    this.state = 'running'
    logActivity('Orchestrator', 'start', `Simulation started with ${this.agents.length} agents at ${this.speed}x speed`)

    this._scheduleTick()
    return this.status()
  }

  /** Stop the simulation */
  stop() {
    if (this.state === 'idle') return { error: 'Not running' }

    clearTimeout(this._timer)
    this._timer = null
    this.state  = 'idle'

    logActivity('Orchestrator', 'stop', `Simulation stopped after ${this.tickCount} ticks`)
    return this.status()
  }

  /** Pause the simulation */
  pause() {
    if (this.state !== 'running') return { error: 'Not running' }

    clearTimeout(this._timer)
    this._timer = null
    this.state  = 'paused'

    logActivity('Orchestrator', 'pause', `Simulation paused at tick ${this.tickCount}`)
    return this.status()
  }

  /** Resume from paused state */
  resume() {
    if (this.state !== 'paused') return { error: 'Not paused' }

    this.state = 'running'
    logActivity('Orchestrator', 'resume', `Simulation resumed at tick ${this.tickCount}`)
    this._scheduleTick()
    return this.status()
  }

  /** Set speed multiplier */
  setSpeed(speed) {
    this.speed = Math.min(10, Math.max(1, speed))
    // Reschedule if running
    if (this.state === 'running' && this._timer) {
      clearTimeout(this._timer)
      this._scheduleTick()
    }
    return this.status()
  }

  /** Current status snapshot */
  status() {
    return {
      state:     this.state,
      speed:     this.speed,
      tickCount: this.tickCount,
      startedAt: this.startedAt,
      agents:    this.agents.map(a => a.status()),
      worldState: {
        orgs:      this.world.orgs.length,
        users:     this.world.users.length,
        witTypes:  this.world.witTypes.length,
        workItems: this.world.totalActiveItems(),
        lastRefresh: this.world.lastRefresh,
      },
    }
  }

  /** Schedule the next tick */
  _scheduleTick() {
    this._timer = setTimeout(() => this._tick(), this.tickInterval)
  }

  /** Execute one tick */
  async _tick() {
    if (this.state !== 'running') return

    this.tickCount++

    try {
      // Refresh world state every 5 ticks to avoid hammering the API
      if (this.tickCount % 5 === 1) {
        await this.world.refresh()
      }

      // Run all agents concurrently
      await Promise.allSettled(
        this.agents.map(agent => agent.tick(this.world, apiClient))
      )
    } catch (err) {
      logActivity('Orchestrator', 'error', `Tick ${this.tickCount} error: ${err.message}`)
    }

    // Schedule next tick
    if (this.state === 'running') {
      this._scheduleTick()
    }
  }
}

// Singleton
export const orchestrator = new Orchestrator()
