/**
 * simulation/agents/productOwner.js
 * Product Owner agent — creates features/epics, triages intake, reviews, sets priorities.
 */

import { AgentBase } from '../agentBase.js'
import { content }   from '../contentLibrary.js'

export class ProductOwnerAgent extends AgentBase {
  constructor(config) {
    super({ cooldownTicks: 3, ...config })
  }

  async decide(world) {
    this._org   = world.org(this.orgSlug)
    this._types = world.typesForOrg(this.orgSlug)

    const orgItems = world.activeItemsForOrg(this.orgSlug)

    const intake = orgItems.filter(wi => wi.current_stage_class === 'intake')
    const review = orgItems.filter(wi => wi.current_stage_class === 'review')

    const actions = [
      { action: 'createFeature',  weight: this._org && this._types.length > 0 ? 30 : 0 },
      { action: 'triage',         weight: intake.length > 0 ? 25 : 0 },
      { action: 'comment',        weight: orgItems.length > 0 ? 20 : 0 },
      { action: 'setPriority',    weight: orgItems.length > 0 ? 15 : 0 },
      { action: 'approve',        weight: review.length > 0 ? 10 : 0 },
    ]

    const action = this.weightedPick(actions)
    if (!action) return null

    return { action, params: { intake, review, orgItems } }
  }

  async act(action, params, apiClient) {
    switch (action) {
      case 'createFeature': return this._createFeature(apiClient)
      case 'triage':        return this._triage(params, apiClient)
      case 'comment':       return this._comment(params, apiClient)
      case 'setPriority':   return this._setPriority(params, apiClient)
      case 'approve':       return this._approve(params, apiClient)
      default: return { detail: 'unknown action' }
    }
  }

  async _createFeature(apiClient) {
    // Prefer feature/epic types
    const featureTypes = this._types.filter(t =>
      t.name.toLowerCase().includes('feature') || t.name.toLowerCase().includes('epic')
    )
    const types = featureTypes.length > 0 ? featureTypes : this._types
    if (!types.length) return { detail: 'No types available' }

    const type  = content.pick(types)
    const isEpic = type.name.toLowerCase().includes('epic')
    const title = isEpic ? content.title('epic') : content.title('feature')

    const result = await apiClient.createWorkItem({
      title,
      work_item_type_id: type.id,
      owner_org_id: this._org.id,
      description: content.description('feature'),
    })
    return { detail: `Created ${type.name} "${title}" (${result.display_key})`, workItemId: result.id }
  }

  async _triage({ intake }, apiClient) {
    const item = content.pick(intake)
    const transitions = await apiClient.workItemTransitions(item.id)
    const forward = transitions.rows?.find(t => t.transition_kind === 'forward')
    if (!forward) return { detail: `No forward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.transitionWorkItem(item.id, forward.to_stage_id, 'Triaged and prioritized')
    await apiClient.addComment(item.id, content.comment('triage'))
    return { detail: `Triaged "${item.title}" → ${forward.to_stage_name}`, workItemId: item.id }
  }

  async _comment({ orgItems }, apiClient) {
    const item = content.pick(orgItems)
    const body = content.comment('question')
    await apiClient.addComment(item.id, body)
    return { detail: `Commented on "${item.title}"`, workItemId: item.id }
  }

  async _setPriority({ orgItems }, apiClient) {
    const item = content.pick(orgItems)
    // Randomly set due date or expedited flag
    const roll = Math.random()
    if (roll < 0.3) {
      const daysOut = Math.floor(Math.random() * 14) + 3
      const dueDate = new Date(Date.now() + daysOut * 86400000).toISOString().split('T')[0]
      await apiClient.updateWorkItem(item.id, { due_date: dueDate })
      return { detail: `Set due date on "${item.title}" → ${dueDate}`, workItemId: item.id }
    } else if (roll < 0.4) {
      await apiClient.updateWorkItem(item.id, { is_expedited: true })
      return { detail: `Expedited "${item.title}"`, workItemId: item.id }
    } else {
      await apiClient.updateWorkItem(item.id, { work_nature: 'improvement' })
      return { detail: `Marked "${item.title}" as improvement work`, workItemId: item.id }
    }
  }

  async _approve({ review }, apiClient) {
    const item = content.pick(review)
    const transitions = await apiClient.workItemTransitions(item.id)
    const forward = transitions.rows?.find(t => t.transition_kind === 'forward')
    if (!forward) return { detail: `No forward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.transitionWorkItem(item.id, forward.to_stage_id, 'Approved')
    await apiClient.addComment(item.id, content.comment('review'))
    return { detail: `Approved "${item.title}" → ${forward.to_stage_name}`, workItemId: item.id }
  }
}
