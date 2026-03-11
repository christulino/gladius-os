// Default permission sets per system role.
// These are global defaults (org_id = NULL).
// Org admins can add or revoke permissions for their org via role_permissions with org_id set.

const ALL_PERMISSIONS = [
  'create_org', 'create_user', 'manage_system_config',
  'manage_org', 'manage_members', 'manage_role_permissions',
  'manage_workflows', 'manage_work_item_types', 'manage_service_catalog',
  'create_work_item', 'edit_work_item', 'transition_work_item',
  'comment_work_item', 'manage_board_views',
  'view_work_items', 'view_reports',
]

const ORG_AND_WORK_PERMISSIONS = [
  'manage_org', 'manage_members', 'manage_role_permissions',
  'manage_workflows', 'manage_work_item_types', 'manage_service_catalog',
  'create_work_item', 'edit_work_item', 'transition_work_item',
  'comment_work_item', 'manage_board_views',
  'view_work_items', 'view_reports',
]

const WORK_PERMISSIONS = [
  'create_work_item', 'edit_work_item', 'transition_work_item',
  'comment_work_item', 'manage_board_views',
  'view_work_items', 'view_reports',
]

const READ_ONLY_PERMISSIONS = [
  'view_work_items', 'view_reports',
]

export const rolePermissions = [
  // System Admin — everything
  { role_name: 'Admin', permissions: ALL_PERMISSIONS },

  // Org Admin — everything except system-scope
  { role_name: 'Org Admin', permissions: ORG_AND_WORK_PERMISSIONS },

  // View Only — read access only
  { role_name: 'View Only', permissions: READ_ONLY_PERMISSIONS },

  // Service Delivery Manager — org mgmt + full work item access
  {
    role_name: 'Service Delivery Manager',
    permissions: ORG_AND_WORK_PERMISSIONS,
  },

  // Product Owner — workflow management + full work item access
  {
    role_name: 'Product Owner',
    permissions: [
      'manage_workflows',
      ...WORK_PERMISSIONS,
    ],
  },

  // Service Manager — service catalog + full work item access
  {
    role_name: 'Service Manager',
    permissions: [
      'manage_service_catalog',
      ...WORK_PERMISSIONS,
    ],
  },

  // Team Member — standard work item operations
  { role_name: 'Team Member', permissions: WORK_PERMISSIONS },

  // Stakeholder — can view and comment, not transition or create
  {
    role_name: 'Stakeholder',
    permissions: ['view_work_items', 'view_reports', 'comment_work_item'],
  },
]
