// Fixed permission vocabulary — each slug maps to a runtime code check.
// scope:    'system' | 'org' | 'work' | 'read'
// category: 'administration' | 'membership' | 'workflow' | 'work_items' | 'visibility'

export const permissions = [

  // ---------------------------------------------------------------------------
  // SYSTEM — global operations, Admin only by default
  // ---------------------------------------------------------------------------
  {
    slug: 'create_org',
    name: 'Create Organization',
    description: 'Create new organizations anywhere in the hierarchy.',
    scope: 'system', category: 'administration',
  },
  {
    slug: 'create_user',
    name: 'Create User',
    description: 'Create new user accounts.',
    scope: 'system', category: 'administration',
  },
  {
    slug: 'manage_system_config',
    name: 'Manage System Config',
    description: 'Edit system-level settings including org types and global role defaults.',
    scope: 'system', category: 'administration',
  },

  // ---------------------------------------------------------------------------
  // ORG — org management operations, Org Admin and above by default
  // ---------------------------------------------------------------------------
  {
    slug: 'manage_org',
    name: 'Manage Organization',
    description: 'Edit org name, description, type, and settings.',
    scope: 'org', category: 'membership',
  },
  {
    slug: 'manage_members',
    name: 'Manage Members',
    description: 'Add or remove members and assign roles within an org.',
    scope: 'org', category: 'membership',
  },
  {
    slug: 'manage_role_permissions',
    name: 'Manage Role Permissions',
    description: 'Customize which permissions each role has within this org.',
    scope: 'org', category: 'membership',
  },
  {
    slug: 'manage_workflows',
    name: 'Manage Workflows',
    description: 'Create and edit workflows, stages, and transitions for this org.',
    scope: 'org', category: 'workflow',
  },
  {
    slug: 'manage_work_item_types',
    name: 'Manage Work Item Types',
    description: 'Create and configure work item types for this org.',
    scope: 'org', category: 'workflow',
  },
  {
    slug: 'manage_service_catalog',
    name: 'Manage Service Catalog',
    description: 'Create and publish service catalog items for this org.',
    scope: 'org', category: 'workflow',
  },

  // ---------------------------------------------------------------------------
  // WORK — work item operations
  // ---------------------------------------------------------------------------
  {
    slug: 'create_work_item',
    name: 'Create Work Item',
    description: 'Create new work items in this org.',
    scope: 'work', category: 'work_items',
  },
  {
    slug: 'edit_work_item',
    name: 'Edit Work Item',
    description: 'Edit fields and details on existing work items.',
    scope: 'work', category: 'work_items',
  },
  {
    slug: 'transition_work_item',
    name: 'Transition Work Item',
    description: 'Move work items between stages.',
    scope: 'work', category: 'work_items',
  },
  {
    slug: 'comment_work_item',
    name: 'Comment on Work Item',
    description: 'Add comments and discussion to work items.',
    scope: 'work', category: 'work_items',
  },
  {
    slug: 'manage_board_views',
    name: 'Manage Board Views',
    description: 'Create and save personal and shared board view configurations.',
    scope: 'work', category: 'work_items',
  },

  // ---------------------------------------------------------------------------
  // READ — visibility permissions, all roles get these by default
  // ---------------------------------------------------------------------------
  {
    slug: 'view_work_items',
    name: 'View Work Items',
    description: 'See work items on the board and in lists.',
    scope: 'read', category: 'visibility',
  },
  {
    slug: 'view_reports',
    name: 'View Reports',
    description: 'View flow metrics, reports, and board health indicators.',
    scope: 'read', category: 'visibility',
  },
]
