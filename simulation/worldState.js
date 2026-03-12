/**
 * simulation/worldState.js
 * Cached snapshot of the system state for agent decision-making.
 * Refreshed each tick from the real API.
 */

import { apiClient } from './apiClient.js'

export class WorldState {
  constructor() {
    this.orgs       = []
    this.users      = []
    this.witTypes   = []
    this.workflows  = []
    this.workItems  = []
    this.lastRefresh = null
  }

  async refresh() {
    const [orgsData, usersData, typesData, workflowsData, itemsData] = await Promise.all([
      apiClient.organizations(),
      apiClient.users(),
      apiClient.witTypes(),
      apiClient.workflows(),
      apiClient.workItems(500),
    ])

    this.orgs       = orgsData.rows  || []
    this.users      = usersData.rows || []
    this.witTypes   = typesData.rows || []
    this.workflows  = workflowsData.rows || []
    this.workItems  = itemsData.rows || []
    this.lastRefresh = Date.now()
  }

  /** Active (non-terminal) work items */
  activeItems() {
    return this.workItems.filter(wi => wi.spawn_state === 'active')
  }

  /** Items in a specific stage class */
  itemsInStageClass(stageClass) {
    return this.activeItems().filter(wi => wi.current_stage_class === stageClass)
  }

  /** Items owned by a specific org (by slug) */
  itemsForOrg(orgSlug) {
    return this.activeItems().filter(wi => wi.org_slug === orgSlug)
  }

  /** Items in a non-terminal stage for a given org */
  activeItemsForOrg(orgSlug) {
    return this.itemsForOrg(orgSlug).filter(wi => !wi.is_terminal)
  }

  /** Work item types for a specific org (by slug) */
  typesForOrg(orgSlug) {
    return this.witTypes.filter(t => t.owner_org_slug === orgSlug)
  }

  /** Find org by slug */
  org(slug) {
    return this.orgs.find(o => o.slug === slug)
  }

  /** Find user by email */
  userByEmail(email) {
    return this.users.find(u => u.email === email)
  }

  /** Users who are members of a specific org */
  usersForOrg(orgSlug) {
    return this.users.filter(u =>
      u.memberships?.some(m => m.org_slug === orgSlug)
    )
  }

  /** Stages for a given workflow */
  stagesForWorkflow(workflowId) {
    const wf = this.workflows.find(w => w.id === workflowId)
    return wf?.stages || []
  }

  /** Total active work item count */
  totalActiveItems() {
    return this.activeItems().length
  }
}
