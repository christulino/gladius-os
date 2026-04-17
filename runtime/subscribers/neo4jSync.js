/**
 * runtime/subscribers/neo4jSync.js
 * Replaces the former synchronous syncToGraph() calls in transitions.js and
 * workItems.js. Thin mapper from event type → existing graph/sync.js handlers.
 */

import { syncToGraph } from '../../graph/sync.js'

const HANDLED_PREFIXES = ['work_item.', 'transition_action.']

export function handlesEventType(eventType) {
  return HANDLED_PREFIXES.some(p => eventType.startsWith(p))
}

export async function neo4jSyncHandler(event) {
  switch (event.event_type) {

    case 'work_item.created':
      return syncToGraph('work_item', event.entity_uri, 'create', event.payload)

    case 'work_item.edited':
      // payload.current contains the up-to-date work item snapshot
      return syncToGraph('work_item', event.entity_uri, 'update',
        event.payload.current ?? event.payload)

    case 'work_item.transitioned':
      return syncToGraph('stage_transition', event.entity_uri, 'update', event.payload)

    case 'work_item.substate_changed':
      return syncToGraph('work_item', event.entity_uri, 'update', event.payload)

    case 'work_item.assigned':
      return syncToGraph('user_relationship', event.entity_uri, 'upsert', event.payload)

    case 'work_item.unassigned':
      return syncToGraph('user_relationship', event.entity_uri, 'delete', event.payload)

    case 'work_item.linked':
      // parent/child links are captured by work_item.created relationship logic in sync.js
      // for explicit relinking, re-upsert the work item
      return syncToGraph('work_item', event.entity_uri, 'update', event.payload.current ?? event.payload)

    case 'work_item.commented':
      // Comments are not currently Neo4j entities — no-op.
      return

    case 'transition_action.spawn_fired':
      return syncToGraph('work_item', event.payload.spawned_uri, 'create', event.payload.spawned)

    case 'transition_action.api_call_fired':
      // Informational — no Neo4j effect.
      return

    default:
      // Unknown work_item.* or transition_action.* event type — log and move on.
      console.warn(`[neo4j-sync] No mapping for event_type "${event.event_type}"`)
      return
  }
}

export default { neo4jSyncHandler, handlesEventType }
