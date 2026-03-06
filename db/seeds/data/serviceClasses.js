/**
 * db/seeds/data/serviceClasses.js
 * System default Kanban service classes.
 * Every org gets these four. They govern how work items flow through the system.
 * Orgs can modify limits and colors but cannot delete system defaults.
 */

export const serviceClasses = [
  {
    name:           'Expedited',
    description:    'Urgent work that bypasses normal WIP limits. Use sparingly.',
    priority_order: 0,
    color:          '#EF4444',
    max_concurrent: 1,
    can_bypass_wip: true,
    is_system_default: true,
  },
  {
    name:           'Fixed Date',
    description:    'Work with a hard deadline. SLA is date-driven.',
    priority_order: 1,
    color:          '#F59E0B',
    max_concurrent: null,
    can_bypass_wip: false,
    is_date_driven: true,
    is_system_default: true,
  },
  {
    name:           'Standard',
    description:    'Default for all new work items. First in, first out.',
    priority_order: 2,
    color:          '#3B82F6',
    max_concurrent: null,
    can_bypass_wip: false,
    is_system_default: true,
  },
  {
    name:           'Deferred',
    description:    'Low urgency. Pulled only when capacity is available.',
    priority_order: 3,
    color:          '#9CA3AF',
    max_concurrent: null,
    can_bypass_wip: false,
    is_system_default: true,
  },
]
