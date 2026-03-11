/**
 * db/seeds/data/roles.js
 * System default roles — seeded once under the system org.
 * These serve as the global starting templates.
 * Orgs can define additional custom roles and override permissions.
 */

export const roles = [
  // --- System-level ---
  {
    name:        'Admin',
    description: 'System administrator. Full access to everything including org and user creation.',
    is_system_default: true,
  },

  // --- Org-level defaults ---
  {
    name:        'Org Admin',
    description: 'Owns an org. Manages members, roles, workflows, and work item types within their org.',
    is_system_default: true,
  },
  {
    name:        'View Only',
    description: 'Read-only access. Can view work items and reports but cannot create, edit, or transition.',
    is_system_default: true,
  },

  // --- Common named roles (starting point — orgs can add their own) ---
  {
    name:        'Service Delivery Manager',
    description: 'Manages org settings, members, and the full delivery workflow.',
    is_system_default: true,
  },
  {
    name:        'Product Owner',
    description: 'Manages workflows and work item types. Full work item access including acceptance.',
    is_system_default: true,
  },
  {
    name:        'Service Manager',
    description: 'Manages the service catalog and handles incoming service requests.',
    is_system_default: true,
  },
  {
    name:        'Team Member',
    description: 'Standard team contributor. Can create, edit, and transition work items.',
    is_system_default: true,
  },
  {
    name:        'Stakeholder',
    description: 'Can view work items and add comments. Cannot create or transition.',
    is_system_default: true,
  },
]
