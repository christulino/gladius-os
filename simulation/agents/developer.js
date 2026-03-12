/**
 * simulation/agents/developer.js
 * Developer agent — picks up work, transitions through stages, comments, creates subtasks.
 */

import { AgentBase } from '../agentBase.js'
import { content }   from '../contentLibrary.js'

export class DeveloperAgent extends AgentBase {
  constructor(config) {
    super({ cooldownTicks: 2, ...config })
  }

  async decide(world) {
    this._org   = world.org(this.orgSlug)
    this._types = world.typesForOrg(this.orgSlug)

    const orgItems = world.activeItemsForOrg(this.orgSlug)

    const pickable = orgItems.filter(wi =>
      ['intake', 'queued', 'triage'].includes(wi.current_stage_class)
    )
    const inProgress = orgItems.filter(wi =>
      wi.current_stage_class === 'in-progress'
    )

    const actions = [
      { action: 'pickUp',       weight: pickable.length > 0 ? 20 : 0 },
      { action: 'advance',      weight: inProgress.length > 0 ? 40 : 0 },
      { action: 'comment',      weight: orgItems.length > 0 ? 25 : 0 },
      { action: 'createTask',   weight: this._org && this._types.length > 0 ? 10 : 0 },
      { action: 'markBlocked',  weight: inProgress.length > 0 ? 5 : 0 },
    ]

    const action = this.weightedPick(actions)
    if (!action) return null

    return { action, params: { pickable, inProgress, orgItems } }
  }

  async act(action, params, apiClient) {
    switch (action) {
      case 'pickUp':      return this._pickUp(params, apiClient)
      case 'advance':     return this._advance(params, apiClient)
      case 'comment':     return this._comment(params, apiClient)
      case 'createTask':  return this._createTask(apiClient)
      case 'markBlocked': return this._markBlocked(params, apiClient)
      default: return { detail: 'unknown action' }
    }
  }

  async _pickUp({ pickable }, apiClient) {
    const item = content.pick(pickable)
    const transitions = await apiClient.workItemTransitions(item.id)
    const forward = transitions.rows?.find(t => t.transition_kind === 'forward')
    if (!forward) return { detail: `No forward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.transitionWorkItem(item.id, forward.to_stage_id, 'Picking up work')
    await apiClient.addRelationship(item.id, this.userId, 'working_on').catch(() => {})
    return { detail: `Picked up "${item.title}" → ${forward.to_stage_name}`, workItemId: item.id }
  }

  async _advance({ inProgress }, apiClient) {
    const item = content.pick(inProgress)
    const transitions = await apiClient.workItemTransitions(item.id)
    const forward = transitions.rows?.find(t => t.transition_kind === 'forward')
    if (!forward) return { detail: `No forward transition for "${item.title}"`, workItemId: item.id }

    await apiClient.transitionWorkItem(item.id, forward.to_stage_id, 'Work completed, moving forward')
    return { detail: `Advanced "${item.title}" → ${forward.to_stage_name}`, workItemId: item.id }
  }

  async _comment({ orgItems }, apiClient) {
    const item = content.pick(orgItems)
    const body = content.comment('progress')
    await apiClient.addComment(item.id, body)
    return { detail: `Commented on "${item.title}"`, workItemId: item.id }
  }

  async _createTask(apiClient) {
    const taskTypes = this._types.filter(t => t.name.toLowerCase().includes('task'))
    if (!taskTypes.length) return { detail: 'No task types available' }

    const type  = content.pick(taskTypes)
    const title = content.title('task')

    const result = await apiClient.createWorkItem({
      title,
      work_item_type_id: type.id,
      owner_org_id: this._org.id,
      description: content.description('task'),
    })
    return { detail: `Created task "${title}" (${result.display_key})`, workItemId: result.id }
  }

  async _markBlocked({ inProgress }, apiClient) {
    const item = content.pick(inProgress)
    await apiClient.setSubstate(item.id, 'blocked')
    await apiClient.addComment(item.id, content.comment('blocker'))
    return { detail: `Marked "${item.title}" as blocked`, workItemId: item.id }
  }
}
