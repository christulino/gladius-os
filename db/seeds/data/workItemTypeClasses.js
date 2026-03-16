/**
 * db/seeds/data/workItemTypeClasses.js
 * System default work item type classes.
 * These are the object-oriented templates that work item types inherit from.
 * Think of them as abstract base types — they define default behavior and
 * field expectations that concrete work item types extend.
 */

export const workItemTypeClasses = [
  {
    name:        'Task',
    description: 'A discrete unit of work with a clear definition of done. The atomic building block.',
    icon:        'check-square',
    color:       '#3B82F6',
    is_system_default: true,
    default_workflow_name: 'Simple Task',
    default_fields: [
      { key: 'estimate_hours', label: 'Estimate (hours)', type: 'number',  required: false },
      { key: 'actual_hours',   label: 'Actual (hours)',   type: 'number',  required: false },
    ],
  },
  {
    name:        'Feature',
    description: 'A user-facing capability delivered as a collection of tasks.',
    icon:        'star',
    color:       '#8B5CF6',
    is_system_default: true,
    default_workflow_name: 'Standard Feature',
    default_fields: [
      { key: 'user_story',     label: 'User Story',       type: 'text',    required: false },
      { key: 'estimate_points',label: 'Story Points',     type: 'number',  required: false },
      { key: 'acceptance_criteria', label: 'Acceptance Criteria', type: 'text', required: false },
    ],
  },
  {
    name:        'Bug',
    description: 'A defect or unintended behavior that needs to be fixed.',
    icon:        'bug',
    color:       '#EF4444',
    is_system_default: true,
    default_workflow_name: 'Bug Triage',
    default_fields: [
      { key: 'severity',       label: 'Severity',         type: 'select',  required: true,
        options: ['critical', 'high', 'medium', 'low'] },
      { key: 'steps_to_reproduce', label: 'Steps to Reproduce', type: 'text', required: false },
      { key: 'expected_behavior',  label: 'Expected Behavior',  type: 'text', required: false },
      { key: 'actual_behavior',    label: 'Actual Behavior',    type: 'text', required: false },
    ],
  },
  {
    name:        'Epic',
    description: 'A large body of work that can be broken down into features and tasks.',
    icon:        'layers',
    color:       '#EC4899',
    is_system_default: true,
    default_workflow_name: 'Standard Feature',
    default_fields: [
      { key: 'business_objective', label: 'Business Objective', type: 'text',   required: false },
      { key: 'success_metrics',    label: 'Success Metrics',    type: 'text',   required: false },
      { key: 'target_quarter',     label: 'Target Quarter',     type: 'string', required: false },
    ],
  },
  {
    name:        'Project',
    description: 'A time-bounded initiative with a defined scope, outcome, and stakeholders.',
    icon:        'folder',
    color:       '#10B981',
    is_system_default: true,
    default_workflow_name: 'Standard Feature',
    default_fields: [
      { key: 'business_case',  label: 'Business Case',    type: 'text',    required: false },
      { key: 'budget',         label: 'Budget',           type: 'currency',required: false },
      { key: 'target_date',    label: 'Target Date',      type: 'date',    required: false },
      { key: 'sponsor',        label: 'Sponsor',          type: 'string',  required: false },
    ],
  },
  {
    name:        'Service Request',
    description: 'A request for something from a service catalog. Initiates a defined fulfillment workflow.',
    icon:        'inbox',
    color:       '#F59E0B',
    is_system_default: true,
    default_workflow_name: 'Service Request',
    default_fields: [
      { key: 'requested_for',  label: 'Requested For',    type: 'string',  required: false },
      { key: 'justification',  label: 'Justification',    type: 'text',    required: false },
      { key: 'urgency',        label: 'Urgency',          type: 'select',  required: false,
        options: ['low', 'medium', 'high'] },
    ],
  },
  {
    name:        'Incident',
    description: 'An unplanned disruption or degradation of a service that requires immediate response.',
    icon:        'alert-triangle',
    color:       '#DC2626',
    is_system_default: true,
    default_workflow_name: 'Bug Triage',
    default_fields: [
      { key: 'impact',         label: 'Impact',           type: 'select',  required: true,
        options: ['critical', 'high', 'medium', 'low'] },
      { key: 'affected_systems', label: 'Affected Systems', type: 'text', required: false },
      { key: 'detected_at',    label: 'Detected At',      type: 'datetime',required: false },
      { key: 'resolved_at',    label: 'Resolved At',      type: 'datetime',required: false },
      { key: 'root_cause',     label: 'Root Cause',       type: 'text',    required: false },
    ],
  },
]
