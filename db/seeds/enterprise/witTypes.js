/**
 * Org-specific work item types for the enterprise seed.
 *
 * Each org gets 3-5 types that represent the services it offers.
 * Types reference a WIT class (by name) and a workflow (by name).
 * The seed runner resolves these to IDs.
 *
 * org_slug determines the owning org (resolved to ID at seed time).
 * key_prefix is used for display keys (e.g. PAY-TSK.42).
 */

export const orgWorkItemTypes = [

  // ─── Product Engineering ART ─────────────────────────────────────────────

  {
    org_slug:      'product-engineering',
    name:          'Product Feature',
    description:   'A product feature requiring design, development, and release across teams in the ART.',
    class_name:    'Feature',
    workflow_name: 'Standard Feature',
    icon:          '⭐',
    color:         '#8B5CF6',
    key_prefix:    'FEAT',
  },
  {
    org_slug:      'product-engineering',
    name:          'Product Epic',
    description:   'A large product initiative spanning multiple PIs, broken into features.',
    class_name:    'Epic',
    workflow_name: 'Standard Feature',
    icon:          '🎯',
    color:         '#EC4899',
    key_prefix:    'EPIC',
  },
  {
    org_slug:      'product-engineering',
    name:          'Feature Feasibility',
    description:   'Technical or market feasibility study before committing to a product feature.',
    class_name:    'Feasibility Study',
    workflow_name: 'Review & Approval',
    icon:          '🔬',
    color:         '#14B8A6',
    key_prefix:    'FEAS',
  },
  {
    org_slug:      'product-engineering',
    name:          'Sizing Request',
    description:   'Request capacity estimation for a proposed feature or initiative.',
    class_name:    'Sizing Request',
    workflow_name: 'Review & Approval',
    icon:          '📐',
    color:         '#8B5CF6',
    key_prefix:    'SIZE',
  },

  // ─── Payments Team ───────────────────────────────────────────────────────

  {
    org_slug:      'payments',
    name:          'Payment Feature',
    description:   'Feature work specific to the payments domain — checkout, refunds, subscriptions.',
    class_name:    'Feature',
    workflow_name: 'Standard Feature',
    icon:          '💳',
    color:         '#8B5CF6',
    key_prefix:    'PAY',
  },
  {
    org_slug:      'payments',
    name:          'Payment Bug',
    description:   'Defect in payment processing, reconciliation, or transaction flows.',
    class_name:    'Bug',
    workflow_name: 'Bug Triage',
    icon:          '🐛',
    color:         '#EF4444',
    key_prefix:    'PBUG',
  },
  {
    org_slug:      'payments',
    name:          'Payment Task',
    description:   'Discrete unit of work in the payments domain.',
    class_name:    'Task',
    workflow_name: 'Simple Task',
    icon:          '✅',
    color:         '#3B82F6',
    key_prefix:    'PTSK',
  },

  // ─── Mobile Experience Team ──────────────────────────────────────────────

  {
    org_slug:      'mobile-experience',
    name:          'Mobile Feature',
    description:   'Feature for the iOS or Android mobile application.',
    class_name:    'Feature',
    workflow_name: 'Standard Feature',
    icon:          '📱',
    color:         '#8B5CF6',
    key_prefix:    'MOB',
  },
  {
    org_slug:      'mobile-experience',
    name:          'Mobile Bug',
    description:   'Defect specific to the mobile application.',
    class_name:    'Bug',
    workflow_name: 'Bug Triage',
    icon:          '🪲',
    color:         '#EF4444',
    key_prefix:    'MBUG',
  },
  {
    org_slug:      'mobile-experience',
    name:          'Design Request',
    description:   'Request UX/UI design work from the design studio for mobile screens.',
    class_name:    'Design Request',
    workflow_name: 'Design Sprint',
    icon:          '🎨',
    color:         '#EC4899',
    key_prefix:    'MDES',
  },
  {
    org_slug:      'mobile-experience',
    name:          'Mobile Task',
    description:   'Discrete development task for the mobile team.',
    class_name:    'Task',
    workflow_name: 'Simple Task',
    icon:          '✅',
    color:         '#3B82F6',
    key_prefix:    'MTSK',
  },

  // ─── Cloud Infrastructure ────────────────────────────────────────────────

  {
    org_slug:      'cloud-infra',
    name:          'Environment Setup',
    description:   'Provision, modify, or decommission a cloud environment (dev, staging, prod).',
    class_name:    'Environment Request',
    workflow_name: 'Provisioning',
    icon:          '☁️',
    color:         '#0EA5E9',
    key_prefix:    'ENV',
  },
  {
    org_slug:      'cloud-infra',
    name:          'Infrastructure Task',
    description:   'General infrastructure work — automation, monitoring, capacity management.',
    class_name:    'Task',
    workflow_name: 'Simple Task',
    icon:          '🔧',
    color:         '#3B82F6',
    key_prefix:    'ITSK',
  },
  {
    org_slug:      'cloud-infra',
    name:          'Infrastructure Incident',
    description:   'Unplanned outage or degradation of cloud infrastructure services.',
    class_name:    'Incident',
    workflow_name: 'Bug Triage',
    icon:          '🚨',
    color:         '#DC2626',
    key_prefix:    'IINC',
  },
  {
    org_slug:      'cloud-infra',
    name:          'Acquisition Request',
    description:   'Request to acquire cloud services, licenses, or infrastructure components.',
    class_name:    'Acquisition Request',
    workflow_name: 'Requisition',
    icon:          '🛒',
    color:         '#059669',
    key_prefix:    'IACQ',
  },

  // ─── Data Platform ───────────────────────────────────────────────────────

  {
    org_slug:      'data-platform',
    name:          'Database Change Request',
    description:   'Schema migration, data fix, access provisioning, or performance tuning for databases.',
    class_name:    'Database Change',
    workflow_name: 'Provisioning',
    icon:          '🗄️',
    color:         '#F97316',
    key_prefix:    'DBCR',
  },
  {
    org_slug:      'data-platform',
    name:          'Data Pipeline Task',
    description:   'Work on ETL pipelines, data quality, or analytics infrastructure.',
    class_name:    'Task',
    workflow_name: 'Simple Task',
    icon:          '📊',
    color:         '#3B82F6',
    key_prefix:    'DTSK',
  },
  {
    org_slug:      'data-platform',
    name:          'Data Platform Bug',
    description:   'Defect in data pipelines, reporting, or data services.',
    class_name:    'Bug',
    workflow_name: 'Bug Triage',
    icon:          '🐛',
    color:         '#EF4444',
    key_prefix:    'DBUG',
  },

  // ─── Enterprise Architecture ─────────────────────────────────────────────

  {
    org_slug:      'enterprise-architecture',
    name:          'Architecture Review',
    description:   'Request for architectural review — new systems, integrations, or technology decisions.',
    class_name:    'Architecture Review',
    workflow_name: 'Review & Approval',
    icon:          '🏗️',
    color:         '#6366F1',
    key_prefix:    'ARCH',
  },
  {
    org_slug:      'enterprise-architecture',
    name:          'Technology Assessment',
    description:   'Feasibility study for adopting a new technology, framework, or vendor.',
    class_name:    'Feasibility Study',
    workflow_name: 'Review & Approval',
    icon:          '🔬',
    color:         '#14B8A6',
    key_prefix:    'TECH',
  },
  {
    org_slug:      'enterprise-architecture',
    name:          'Standards Exception',
    description:   'Request for an exception to established architecture standards.',
    class_name:    'Service Request',
    workflow_name: 'Review & Approval',
    icon:          '⚠️',
    color:         '#F59E0B',
    key_prefix:    'STDX',
  },

  // ─── UX Design Studio ───────────────────────────────────────────────────

  {
    org_slug:      'ux-design',
    name:          'Design Request',
    description:   'Request for UX research, wireframes, prototypes, or visual design.',
    class_name:    'Design Request',
    workflow_name: 'Design Sprint',
    icon:          '🎨',
    color:         '#EC4899',
    key_prefix:    'DSGN',
  },
  {
    org_slug:      'ux-design',
    name:          'Design System Update',
    description:   'Changes to shared design system components, tokens, or patterns.',
    class_name:    'Task',
    workflow_name: 'Standard Feature',
    icon:          '🎨',
    color:         '#A855F7',
    key_prefix:    'DSYS',
  },
  {
    org_slug:      'ux-design',
    name:          'Accessibility Audit',
    description:   'Audit a feature or product for WCAG compliance and accessibility standards.',
    class_name:    'Design Request',
    workflow_name: 'Review & Approval',
    icon:          '♿',
    color:         '#0EA5E9',
    key_prefix:    'A11Y',
  },

  // ─── PMO ─────────────────────────────────────────────────────────────────

  {
    org_slug:      'pmo',
    name:          'Project Intake',
    description:   'New project proposal requiring business case review and prioritization.',
    class_name:    'Project',
    workflow_name: 'Review & Approval',
    icon:          '📋',
    color:         '#10B981',
    key_prefix:    'PROJ',
  },
  {
    org_slug:      'pmo',
    name:          'Sizing Request',
    description:   'Request for capacity or effort estimation from delivery teams.',
    class_name:    'Sizing Request',
    workflow_name: 'Review & Approval',
    icon:          '📐',
    color:         '#8B5CF6',
    key_prefix:    'PSIZE',
  },
  {
    org_slug:      'pmo',
    name:          'Status Report',
    description:   'Periodic project health report — auto-generated or manually submitted.',
    class_name:    'Task',
    workflow_name: 'Simple Task',
    icon:          '📊',
    color:         '#6366F1',
    key_prefix:    'RPT',
  },

  // ─── IT Service Desk ─────────────────────────────────────────────────────

  {
    org_slug:      'it-service-desk',
    name:          'IT Service Request',
    description:   'General IT service request — access, software, equipment, accounts.',
    class_name:    'Service Request',
    workflow_name: 'Service Request',
    icon:          '📩',
    color:         '#F59E0B',
    key_prefix:    'ITSR',
  },
  {
    org_slug:      'it-service-desk',
    name:          'IT Incident',
    description:   'Service disruption reported by a user or detected by monitoring.',
    class_name:    'Incident',
    workflow_name: 'Bug Triage',
    icon:          '🚨',
    color:         '#DC2626',
    key_prefix:    'INC',
  },
  {
    org_slug:      'it-service-desk',
    name:          'Access Request',
    description:   'Request for system access, permissions, or VPN/network access.',
    class_name:    'Service Request',
    workflow_name: 'Service Request',
    icon:          '🔑',
    color:         '#0D9488',
    key_prefix:    'ACC',
  },
  {
    org_slug:      'it-service-desk',
    name:          'Equipment Request',
    description:   'Request for laptop, monitor, peripherals, or other hardware.',
    class_name:    'Acquisition Request',
    workflow_name: 'Requisition',
    icon:          '💻',
    color:         '#059669',
    key_prefix:    'EQUIP',
  },

  // ─── People Operations ───────────────────────────────────────────────────

  {
    org_slug:      'people-ops',
    name:          'Headcount Requisition',
    description:   'Request to hire or backfill a team member with role definition and approval.',
    class_name:    'Team Member Requisition',
    workflow_name: 'Requisition',
    icon:          '👤',
    color:         '#7C3AED',
    key_prefix:    'HIRE',
  },
  {
    org_slug:      'people-ops',
    name:          'Contractor Request',
    description:   'Request to engage a contractor or consulting resource.',
    class_name:    'Team Member Requisition',
    workflow_name: 'Requisition',
    icon:          '🤝',
    color:         '#6366F1',
    key_prefix:    'CNTR',
  },
  {
    org_slug:      'people-ops',
    name:          'People Service Request',
    description:   'General HR request — onboarding, offboarding, transfers, policy questions.',
    class_name:    'Service Request',
    workflow_name: 'Service Request',
    icon:          '📋',
    color:         '#F59E0B',
    key_prefix:    'PEOP',
  },
]
