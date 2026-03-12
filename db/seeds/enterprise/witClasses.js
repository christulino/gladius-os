/**
 * Additional work item type classes for enterprise scenarios.
 * These supplement the 7 system defaults (Task, Feature, Bug, Epic,
 * Project, Service Request, Incident).
 *
 * Each class is an abstract template. Concrete org-specific types
 * are created from these classes in witTypes.js.
 */

export const additionalClasses = [
  {
    name:        'Architecture Review',
    description: 'Request for architectural assessment, technology decision, or standards review. Includes ADR creation and compliance evaluation.',
    icon:        '🏗️',
    color:       '#6366F1',
    is_system_default: true,
    default_fields: [
      { key: 'review_type',       label: 'Review Type',       type: 'select', required: true,
        options: ['new_system', 'integration', 'technology_choice', 'security', 'performance', 'compliance'] },
      { key: 'systems_affected',  label: 'Systems Affected',  type: 'text',   required: false },
      { key: 'decision_record',   label: 'Decision Record',   type: 'url',    required: false },
      { key: 'risk_level',        label: 'Risk Level',        type: 'select', required: false,
        options: ['low', 'medium', 'high', 'critical'] },
    ],
  },
  {
    name:        'Design Request',
    description: 'Request for UX/UI design work — research, wireframes, prototypes, or visual design for a feature or product.',
    icon:        '🎨',
    color:       '#EC4899',
    is_system_default: true,
    default_fields: [
      { key: 'design_type',      label: 'Design Type',       type: 'select', required: true,
        options: ['research', 'wireframe', 'prototype', 'visual_design', 'design_system', 'accessibility_audit'] },
      { key: 'target_platform',  label: 'Target Platform',   type: 'select', required: false,
        options: ['web', 'ios', 'android', 'cross_platform', 'internal_tool'] },
      { key: 'figma_link',       label: 'Figma Link',        type: 'url',    required: false },
      { key: 'user_segment',     label: 'User Segment',      type: 'text',   required: false },
    ],
  },
  {
    name:        'Environment Request',
    description: 'Request for provisioning, modifying, or decommissioning a development, staging, or production environment.',
    icon:        '☁️',
    color:       '#0EA5E9',
    is_system_default: true,
    default_fields: [
      { key: 'env_type',         label: 'Environment Type',  type: 'select', required: true,
        options: ['development', 'staging', 'production', 'sandbox', 'performance_test', 'dr'] },
      { key: 'action',           label: 'Action',            type: 'select', required: true,
        options: ['provision', 'modify', 'scale', 'decommission', 'refresh'] },
      { key: 'cloud_provider',   label: 'Cloud Provider',    type: 'select', required: false,
        options: ['aws', 'azure', 'gcp', 'on_prem'] },
      { key: 'estimated_cost',   label: 'Estimated Monthly Cost', type: 'currency', required: false },
    ],
  },
  {
    name:        'Database Change',
    description: 'Request for database schema changes, migrations, data fixes, or access provisioning. Requires DBA review.',
    icon:        '🗄️',
    color:       '#F97316',
    is_system_default: true,
    default_fields: [
      { key: 'change_type',      label: 'Change Type',       type: 'select', required: true,
        options: ['schema_change', 'migration', 'data_fix', 'access_grant', 'performance_tuning', 'backup_restore'] },
      { key: 'database_name',    label: 'Database Name',     type: 'text',   required: true },
      { key: 'migration_script', label: 'Migration Script',  type: 'url',    required: false },
      { key: 'rollback_plan',    label: 'Rollback Plan',     type: 'text',   required: false },
      { key: 'downtime_required',label: 'Downtime Required', type: 'boolean',required: false },
    ],
  },
  {
    name:        'Sizing Request',
    description: 'Request for effort estimation or capacity sizing for a proposed initiative, feature, or project.',
    icon:        '📐',
    color:       '#8B5CF6',
    is_system_default: true,
    default_fields: [
      { key: 'sizing_type',      label: 'Sizing Type',       type: 'select', required: true,
        options: ['t_shirt', 'story_points', 'capacity_hours', 'team_sprints', 'rough_order_magnitude'] },
      { key: 'scope_document',   label: 'Scope Document',    type: 'url',    required: false },
      { key: 'estimate_range',   label: 'Estimate Range',    type: 'text',   required: false },
      { key: 'confidence_level', label: 'Confidence Level',  type: 'select', required: false,
        options: ['low', 'medium', 'high'] },
    ],
  },
  {
    name:        'Feasibility Study',
    description: 'Request for technical or product feasibility assessment before committing to a feature or initiative.',
    icon:        '🔬',
    color:       '#14B8A6',
    is_system_default: true,
    default_fields: [
      { key: 'hypothesis',       label: 'Hypothesis',        type: 'text',   required: true },
      { key: 'success_criteria', label: 'Success Criteria',  type: 'text',   required: false },
      { key: 'timebox_days',     label: 'Timebox (days)',     type: 'number', required: false },
      { key: 'recommendation',   label: 'Recommendation',    type: 'select', required: false,
        options: ['proceed', 'proceed_with_changes', 'not_feasible', 'needs_more_research'] },
    ],
  },
  {
    name:        'Acquisition Request',
    description: 'Request to acquire software, hardware, licenses, or services. Requires budget approval and procurement.',
    icon:        '🛒',
    color:       '#059669',
    is_system_default: true,
    default_fields: [
      { key: 'acquisition_type', label: 'Acquisition Type',  type: 'select', required: true,
        options: ['software_license', 'hardware', 'saas_subscription', 'professional_services', 'training', 'contractor'] },
      { key: 'vendor',           label: 'Vendor',            type: 'text',   required: false },
      { key: 'cost',             label: 'Cost',              type: 'currency',required: false },
      { key: 'budget_code',      label: 'Budget Code',       type: 'text',   required: false },
      { key: 'renewal_date',     label: 'Renewal Date',      type: 'date',   required: false },
    ],
  },
  {
    name:        'Team Member Requisition',
    description: 'Request to hire or backfill a team member. Includes role definition, JD creation, and approval workflow.',
    icon:        '👤',
    color:       '#7C3AED',
    is_system_default: true,
    default_fields: [
      { key: 'role_title',       label: 'Role Title',        type: 'text',   required: true },
      { key: 'employment_type',  label: 'Employment Type',   type: 'select', required: true,
        options: ['full_time', 'part_time', 'contractor', 'intern'] },
      { key: 'level',            label: 'Level',             type: 'select', required: false,
        options: ['junior', 'mid', 'senior', 'staff', 'principal', 'director'] },
      { key: 'job_description',  label: 'Job Description',   type: 'url',    required: false },
      { key: 'target_start_date',label: 'Target Start Date', type: 'date',   required: false },
      { key: 'budget_approved',  label: 'Budget Approved',   type: 'boolean',required: false },
    ],
  },
]
