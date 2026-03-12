/**
 * simulation/agents/techSupport.js
 * Tech Support agent — creates service requests/incidents, triages, transitions.
 */

import { AgentBase } from '../agentBase.js'
import { content }   from '../contentLibrary.js'

export class TechSupportAgent extends AgentBase {
  constructor(config) {
    super({ cooldownTicks: 1, ...config })
  }

  async decide(world) {
    this._org   = world.org(this.orgSlug)
    this._types = world.typesForOrg(this.orgSlug)

    const orgItems = world.activeItemsForOrg(this.orgSlug)

    const intake     = orgItems.filter(wi => wi.current_stage_class === 'intake')
    const inProgress = orgItems.filter(wi =>
      ['in-progress', 'triage', 'queued'].includes(wi.current_stage_class)
    )

    const actions = [
      { action: 'createRequest',  weight: this._org && this._types.length > 0 ? 35 : 0 },
      { action: 'triage',         weight: intake.length > 0 ? 30 : 0 },
      { action: 'advance',        weight: inProgress.length > 0 ? 20 : 0 },
      { action: 'comment',        weight: orgItems.length > 0 ? 15 : 0 },
    ]

    const action = this.weightedPick(actions)
    if (!action) return null

    return { action, params: { intake, inProgress, orgItems } }
  }

  async act(action, params, apiClient) {
    switch (action) {
      case 'createRequest': return this._createRequest(apiClient)
      case 'triage':        return this._triage(params, apiClient)
      case 'advance':       return this._advance(params, apiClient)
      case 'comment':       return this._comment(params, apiClient)
      default: return { detail: 'unknown action' }
    }
  }

  async _createRequest(apiClient) {
    // Prefer service request and incident types
    const srTypes = this._types.filter(t =>
      t.name.toLowerCase().includes('service') ||
      t.name.toLowerCase().includes('incident') ||
      t.name.toLowerCase().includes('access') ||
      t.name.toLowerCase().includes('equipment')
    )
    const types = srTypes.length > 0 ? srTypes : this._types
    if (!types.length) return { detail: 'No types available' }

    const type = content.pick(types)
    const isIncident = type.name.toLowerCase().includes('incident')
    const title = isIncident ? content.title('incident') : content.title('service')

    const data = {
      title,
      work_item_type_id: type.id,
      owner_org_id: this._org.id,
      description: content.description(isIncident ? 'bug' : 'feature'),
    }

    // Incidents are often expedited
    if (isIncident && Math.random() < 0.5) {
      data.is_expedited = true
    }

    const result = await apiClient.createWorkItem(data)
    return { detail: `Created ${type.name} "${title}" (${result.display_key})`, workItemId: result.id }
  }

  async _triage({ intake }, apiClient) {
    const item = content.pick(intake)
    const transitions = await apiClient.workItemTransitions(item.id)
    const forward = transitions.rows?.find(t => t.transition_kind === 'forward')
    if (!forward) return { detail: `No forward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.transitionWorkItem(item.id, forward.to_stage_id, 'Triaged by support')
    await apiClient.addRelationship(item.id, this.userId, 'owns').catch(() => {})
    return { detail: `Triaged "${item.title}" → ${forward.to_stage_name}`, workItemId: item.id }
  }

  async _advance({ inProgress }, apiClient) {
    const item = content.pick(inProgress)
    const transitions = await apiClient.workItemTransitions(item.id)
    const forward = transitions.rows?.find(t => t.transition_kind === 'forward')
    if (!forward) return { detail: `No forward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.transitionWorkItem(item.id, forward.to_stage_id, 'Resolved')
    return { detail: `Advanced "${item.title}" → ${forward.to_stage_name}`, workItemId: item.id }
  }

  async _comment({ orgItems }, apiClient) {
    const item = content.pick(orgItems)
    const body = content.comment('progress')
    await apiClient.addComment(item.id, body)
    return { detail: `Commented on "${item.title}"`, workItemId: item.id }
  }
}
