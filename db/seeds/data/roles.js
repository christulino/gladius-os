/**
 * db/seeds/data/roles.js
 * System default roles — seeded once, available to every org.
 * These are the baseline roles. Orgs can define additional custom roles.
 */

export const roles = [
  {
    name:        'owner',
    description: 'Full control — can delete the org, manage all members and settings',
    is_system_default: true,
  },
  {
    name:        'admin',
    description: 'Can manage members, workflows, and work item types. Cannot delete org.',
    is_system_default: true,
  },
  {
    name:        'member',
    description: 'Can create and transition work items. Default role for new members.',
    is_system_default: true,
  },
  {
    name:        'viewer',
    description: 'Read-only access. Can see work items and boards but cannot create or transition.',
    is_system_default: true,
  },
  {
    name:        'external',
    description: 'Minimal access for users outside the organization. Service catalog requests only.',
    is_system_default: true,
  },
]
