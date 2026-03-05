/**
 * graph/sync.js
 * Keeps Neo4j in sync with PostgreSQL.
 *
 * PostgreSQL is always source of truth.
 * Neo4j is a read-optimized replica for traversal and visualization.
 *
 * Sync modes:
 *   Synchronous — called inline on critical path (stage transitions, work item create/cancel)
 *   Asynchronous — queued for eventual consistency (org updates, type versioning)
 *
 * Usage:
 *   import { syncToGraph } from '../graph/sync.js'
 *
 *   await syncToGraph('work_item', workItem.uri, 'create', workItem)
 *   await syncToGraph('work_item', workItem.uri, 'update', { current_stage_uri: '...' })
 */

import { runWriteQuery, runWriteTransaction } from '../db/neo4j.js'

/**
 * Sync an entity change to Neo4j.
 * Router — delegates to type-specific sync functions.
 *
 * @param {string} entityType - See SYNC_HANDLERS below
 * @param {string} entityUri  - Global URI of the entity
 * @param {string} operation  - 'create' | 'update' | 'delete'
 * @param {Object} payload    - Full entity object from PostgreSQL
 * @returns {Promise<void>}
 */
export async function syncToGraph(entityType, entityUri, operation, payload) {
  const handler = SYNC_HANDLERS[entityType]
  if (!handler) {
    console.warn(`[sync] No handler for entity type: "${entityType}" — skipping`)
    return
  }

  try {
    await handler(operation, entityUri, payload)
  } catch (err) {
    // Neo4j sync failure is never fatal — log and continue
    // The system degrades gracefully: board still works via PostgreSQL,
    // hierarchy traversal and visualization will be stale until resync
    console.error(`[sync] Failed to sync ${entityType} ${entityUri} (${operation}):`, err.message)
    // TODO: Push to async retry queue
  }
}

// =============================================================================
// SYNC HANDLERS
// =============================================================================

const SYNC_HANDLERS = {

  // ---------------------------------------------------------------------------
  // ORGANIZATION
  // ---------------------------------------------------------------------------
  org: async (operation, uri, org) => {
    if (operation === 'delete') {
      await runWriteQuery('MATCH (o:Organization {uri: $uri}) SET o.is_active = false', { uri })
      return
    }

    await runWriteQuery(`
      MERGE (o:Organization {uri: $uri})
      SET o += {
        slug:            $slug,
        name:            $name,
        org_type:        $org_type,
        depth:           $depth,
        is_active:       $is_active,
        network_visible: $network_visible
      }
    `, {
      uri,
      slug:            org.slug,
      name:            org.name,
      org_type:        org.org_type    || 'team',
      depth:           org.depth       || 0,
      is_active:       org.is_active   ?? true,
      network_visible: org.network_visible ?? false,
    })

    if (org.parent_uri) {
      await runWriteQuery(`
        MATCH (parent:Organization {uri: $parentUri})
        MATCH (child:Organization  {uri: $childUri})
        MERGE (parent)-[:PARENT_OF]->(child)
      `, { parentUri: org.parent_uri, childUri: uri })
    }
  },

  // ---------------------------------------------------------------------------
  // USER
  // ---------------------------------------------------------------------------
  user: async (operation, uri, user) => {
    if (operation === 'delete') {
      await runWriteQuery('MATCH (u:User {uri: $uri}) SET u.is_active = false', { uri })
      return
    }
    await runWriteQuery(`
      MERGE (u:User {uri: $uri})
      SET u += { display_name: $displayName, email: $email, is_active: $isActive }
    `, { uri, displayName: user.display_name, email: user.email, isActive: user.is_active ?? true })
  },

  // ---------------------------------------------------------------------------
  // ORG MEMBERSHIP
  // ---------------------------------------------------------------------------
  membership: async (operation, uri, membership) => {
    if (operation === 'delete') {
      await runWriteQuery(`
        MATCH (u:User {uri: $userUri})-[m:MEMBER_OF]->(o:Organization {uri: $orgUri})
        SET m.is_active = false
      `, { userUri: membership.user_uri, orgUri: membership.org_uri })
      return
    }
    await runWriteQuery(`
      MATCH (u:User {uri: $userUri})
      MATCH (o:Organization {uri: $orgUri})
      MERGE (u)-[m:MEMBER_OF]->(o)
      SET m += { role_name: $roleName, role_uri: $roleUri, is_active: true, joined_at: datetime() }
    `, {
      userUri:  membership.user_uri,
      orgUri:   membership.org_uri,
      roleName: membership.role_name,
      roleUri:  membership.role_uri,
    })
  },

  // ---------------------------------------------------------------------------
  // WORK ITEM
  // ---------------------------------------------------------------------------
  work_item: async (operation, uri, item) => {
    if (operation === 'delete') {
      // No hard deletes — mark as cancelled
      await runWriteQuery(
        'MATCH (w:WorkItem {uri: $uri}) SET w.spawn_state = "cancelled"',
        { uri }
      )
      return
    }

    // Upsert the work item node
    await runWriteQuery(`
      MERGE (w:WorkItem {uri: $uri})
      SET w += {
        title:                  $title,
        work_item_type_uri:     $workItemTypeUri,
        work_item_type_name:    $workItemTypeName,
        owner_org_uri:          $ownerOrgUri,
        owner_org_slug:         $ownerOrgSlug,
        current_stage_uri:      $currentStageUri,
        current_stage_name:     $currentStageName,
        current_stage_class:    $currentStageClass,
        current_substate:       $currentSubstate,
        spawn_state:            $spawnState,
        service_class:          $serviceClass,
        sla_status:             $slaStatus,
        due_date:               $dueDate,
        created_at:             datetime($createdAt),
        updated_at:             datetime($updatedAt)
      }
    `, {
      uri,
      title:               item.title,
      workItemTypeUri:     item.work_item_type_uri  || null,
      workItemTypeName:    item.work_item_type_name || null,
      ownerOrgUri:         item.owner_org_uri,
      ownerOrgSlug:        item.owner_org_slug      || null,
      currentStageUri:     item.current_stage_uri   || null,
      currentStageName:    item.current_stage_name  || null,
      currentStageClass:   item.current_stage_class || null,
      currentSubstate:     item.current_substate    || null,
      spawnState:          item.spawn_state         || 'active',
      serviceClass:        item.service_class       || 'standard',
      slaStatus:           item.sla_status          || 'no_sla',
      dueDate:             item.due_date            || null,
      createdAt:           item.created_at,
      updatedAt:           item.updated_at,
    })

    // On create — establish structural relationships
    if (operation === 'create') {
      const queries = []

      // OWNS: org → work item
      queries.push({
        cypher: `
          MATCH (o:Organization {uri: $orgUri})
          MATCH (w:WorkItem {uri: $workItemUri})
          MERGE (o)-[:OWNS]->(w)
        `,
        params: { orgUri: item.owner_org_uri, workItemUri: uri },
      })

      // IS_INSTANCE_OF: work item → work item type
      if (item.work_item_type_uri) {
        queries.push({
          cypher: `
            MATCH (w:WorkItem {uri: $workItemUri})
            MATCH (t:WorkItemType {uri: $typeUri})
            MERGE (w)-[:IS_INSTANCE_OF]->(t)
          `,
          params: { workItemUri: uri, typeUri: item.work_item_type_uri },
        })
      }

      // DECOMPOSES_INTO: parent → this item
      if (item.parent_uri) {
        queries.push({
          cypher: `
            MATCH (parent:WorkItem {uri: $parentUri})
            MATCH (child:WorkItem {uri: $childUri})
            MERGE (parent)-[:DECOMPOSES_INTO {
              created_at: datetime(),
              display_order: $displayOrder
            }]->(child)
          `,
          params: {
            parentUri:    item.parent_uri,
            childUri:     uri,
            displayOrder: item.display_order || 0,
          },
        })
      }

      // SPAWNED: origin → this item (automation-created)
      if (item.origin_work_item_uri) {
        queries.push({
          cypher: `
            MATCH (origin:WorkItem {uri: $originUri})
            MATCH (spawned:WorkItem {uri: $spawnedUri})
            MERGE (origin)-[:SPAWNED {
              created_at:   datetime(),
              spawn_state:  $spawnState,
              was_optional: $wasOptional
            }]->(spawned)
          `,
          params: {
            originUri:   item.origin_work_item_uri,
            spawnedUri:  uri,
            spawnState:  item.spawn_state  || 'active',
            wasOptional: item.was_optional || false,
          },
        })
      }

      if (queries.length > 1) {
        await runWriteTransaction(queries)
      } else if (queries.length === 1) {
        await runWriteQuery(queries[0].cypher, queries[0].params)
      }
    }
  },

  // ---------------------------------------------------------------------------
  // WORK ITEM USER RELATIONSHIP
  // ---------------------------------------------------------------------------
  user_relationship: async (operation, uri, rel) => {
    if (operation === 'delete') {
      await runWriteQuery(`
        MATCH (u:User {uri: $userUri})-[r:WORKS_ON]->(w:WorkItem {uri: $workItemUri})
        WHERE r.relationship_type = $relType
        SET r.is_active = false
      `, {
        userUri:     rel.user_uri,
        workItemUri: rel.work_item_uri,
        relType:     rel.relationship_type,
      })
      return
    }
    await runWriteQuery(`
      MATCH (u:User {uri: $userUri})
      MATCH (w:WorkItem {uri: $workItemUri})
      MERGE (u)-[r:WORKS_ON {relationship_type: $relType}]->(w)
      SET r += { assigned_at: datetime(), is_active: true }
    `, {
      userUri:     rel.user_uri,
      workItemUri: rel.work_item_uri,
      relType:     rel.relationship_type,
    })
  },

  // ---------------------------------------------------------------------------
  // STAGE TRANSITION — most critical sync path
  // Updates current stage properties on work item node
  // ---------------------------------------------------------------------------
  stage_transition: async (operation, uri, transition) => {
    await runWriteQuery(`
      MATCH (w:WorkItem {uri: $uri})
      SET w += {
        current_stage_uri:   $stageUri,
        current_stage_name:  $stageName,
        current_stage_class: $stageClass,
        current_substate:    $substate,
        sla_status:          $slaStatus,
        updated_at:          datetime()
      }
    `, {
      uri,
      stageUri:   transition.to_stage_uri,
      stageName:  transition.to_stage_name,
      stageClass: transition.to_stage_class,
      substate:   transition.initial_substate || null,
      slaStatus:  'on_track', // recalculated by metrics module after transition
    })
  },

  // ---------------------------------------------------------------------------
  // BLOCKING RELATIONSHIP
  // ---------------------------------------------------------------------------
  block: async (operation, uri, block) => {
    if (operation === 'delete') {
      await runWriteQuery(`
        MATCH (b:WorkItem {uri: $blockerUri})-[r:BLOCKS]->(t:WorkItem {uri: $blockedUri})
        DELETE r
      `, { blockerUri: block.blocker_uri, blockedUri: block.blocked_uri })
      return
    }
    await runWriteQuery(`
      MATCH (blocker:WorkItem {uri: $blockerUri})
      MATCH (blocked:WorkItem {uri: $blockedUri})
      MERGE (blocker)-[:BLOCKS { created_at: datetime() }]->(blocked)
    `, { blockerUri: block.blocker_uri, blockedUri: block.blocked_uri })
  },

  // ---------------------------------------------------------------------------
  // WORK ITEM TYPE
  // ---------------------------------------------------------------------------
  work_item_type: async (operation, uri, type) => {
    await runWriteQuery(`
      MERGE (t:WorkItemType {uri: $uri})
      SET t += {
        name:         $name,
        version:      $version,
        owner_org_uri:$ownerOrgUri,
        request_mode: $requestMode,
        is_published: $isPublished,
        is_active:    $isActive,
        deprecated_at:$deprecatedAt
      }
    `, {
      uri,
      name:         type.name,
      version:      type.version       || '1.0.0',
      ownerOrgUri:  type.owner_org_uri,
      requestMode:  type.request_mode  || 'user_requestable',
      isPublished:  type.is_published  || false,
      isActive:     type.is_active     ?? true,
      deprecatedAt: type.deprecated_at || null,
    })

    if (type.class_uri) {
      await runWriteQuery(`
        MATCH (t:WorkItemType {uri: $typeUri})
        MATCH (c:WorkItemTypeClass {uri: $classUri})
        MERGE (t)-[:INHERITS_FROM]->(c)
      `, { typeUri: uri, classUri: type.class_uri })
    }

    if (type.successor_uri) {
      await runWriteQuery(`
        MATCH (v2:WorkItemType {uri: $successorUri})
        MATCH (v1:WorkItemType {uri: $uri})
        MERGE (v2)-[:SUCCEEDS]->(v1)
      `, { successorUri: type.successor_uri, uri })
    }
  },

}

export default { syncToGraph }
