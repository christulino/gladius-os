/**
 * simulation/agents/tester.js
 * Tester agent — processes review queue, approves/rejects, files bugs.
 */

import { AgentBase } from '../agentBase.js'
import { content }   from '../contentLibrary.js'

export class TesterAgent extends AgentBase {
  constructor(config) {
    super({ cooldownTicks: 2, ...config })
  }

  async decide(world) {
    this._org   = world.org(this.orgSlug)
    this._types = world.typesForOrg(this.orgSlug)

    const orgItems = world.activeItemsForOrg(this.orgSlug)

    const review     = orgItems.filter(wi => wi.current_stage_class === 'review')
    const inProgress = orgItems.filter(wi => wi.current_stage_class === 'in-progress')

    const actions = [
      { action: 'approve',     weight: review.length > 0 ? 40 : 0 },
      { action: 'reviewComment', weight: review.length > 0 ? 25 : 0 },
      { action: 'reject',      weight: review.length > 0 ? 20 : 0 },
      { action: 'fileBug',     weight: this._org && this._types.length > 0 ? 15 : 0 },
    ]

    const action = this.weightedPick(actions)
    if (!action) return null

    return { action, params: { review, inProgress, orgItems } }
  }

  async act(action, params, apiClient) {
    switch (action) {
      case 'approve':       return this._approve(params, apiClient)
      case 'reviewComment': return this._reviewComment(params, apiClient)
      case 'reject':        return this._reject(params, apiClient)
      case 'fileBug':       return this._fileBug(apiClient)
      default: return { detail: 'unknown action' }
    }
  }

  async _approve({ review }, apiClient) {
    const item = content.pick(review)
    const transitions = await apiClient.workItemTransitions(item.id)
    const forward = transitions.rows?.find(t => t.transition_kind === 'forward')
    if (!forward) return { detail: `No forward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.addComment(item.id, content.comment('review'))
    await apiClient.transitionWorkItem(item.id, forward.to_stage_id, 'QA approved')
    return { detail: `Approved "${item.title}" → ${forward.to_stage_name}`, workItemId: item.id }
  }

  async _reviewComment({ review }, apiClient) {
    const item = content.pick(review)
    const body = content.comment('review')
    await apiClient.addComment(item.id, body)
    return { detail: `Review comment on "${item.title}"`, workItemId: item.id }
  }

  async _reject({ review }, apiClient) {
    const item = content.pick(review)
    const transitions = await apiClient.workItemTransitions(item.id)
    const backward = transitions.rows?.find(t => t.transition_kind === 'backward')
    if (!backward) return { detail: `No backward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.addComment(item.id, 'Found issues during testing. Sending back for rework.')
    await apiClient.transitionWorkItem(item.id, backward.to_stage_id, 'Failed QA — needs rework')
    return { detail: `Rejected "${item.title}" → ${backward.to_stage_name}`, workItemId: item.id }
  }

  async _fileBug(apiClient) {
    const bugTypes = this._types.filter(t =>
      t.name.toLowerCase().includes('bug')
    )
    if (!bugTypes.length) return { detail: 'No bug types available' }

    const type  = content.pick(bugTypes)
    const title = content.title('bug')

    const result = await apiClient.createWorkItem({
      title,
      work_item_type_id: type.id,
      owner_org_id: this._org.id,
      description: content.description('bug'),
    })
    return { detail: `Filed bug "${title}" (${result.display_key})`, workItemId: result.id }
  }
}
