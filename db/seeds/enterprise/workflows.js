/**
 * Additional workflows for enterprise service-oriented work types.
 * These complement the 5 system defaults (Simple Task, Standard Feature,
 * Bug Triage, Service Request, Personal Kanban).
 */

export const additionalWorkflows = [

  // ─── Review & Approval Workflow ──────────────────────────────────────────
  // For architecture reviews, design reviews, feasibility studies
  // Submitted → Under Review → Decision → Done/Declined
  {
    name:        'Review & Approval',
    description: 'Structured review workflow with decision gate. Used for architecture reviews, design approvals, and feasibility assessments.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      { key: 'intake',      name: 'Submitted',     stage_class: 'intake',      stage_type: 'waiting',  display_order: 1, is_entry_stage: true,  sla_hours: 24 },
      { key: 'triage',      name: 'Assigned',       stage_class: 'triage',      stage_type: 'working',  display_order: 2 },
      { key: 'in_progress', name: 'Under Review',   stage_class: 'in-progress', stage_type: 'working',  display_order: 3 },
      { key: 'review',      name: 'Decision',       stage_class: 'review',      stage_type: 'working',  display_order: 4, requires_review: true },
      { key: 'done',        name: 'Completed',      stage_class: 'done',        stage_type: 'waiting',  display_order: 5, is_terminal: true },
      { key: 'cancelled',   name: 'Declined',       stage_class: 'cancelled',   stage_type: 'waiting',  display_order: 6, is_terminal: true },
    ],
    transitions: [
      { from: 'intake',      to: 'triage',      label: 'Assign',           kind: 'forward' },
      { from: 'triage',      to: 'in_progress', label: 'Begin Review',     kind: 'forward' },
      { from: 'triage',      to: 'intake',      label: 'Need More Info',   kind: 'backward', requires_reason: true },
      { from: 'in_progress', to: 'review',      label: 'Submit Decision',  kind: 'forward' },
      { from: 'in_progress', to: 'triage',      label: 'Reassign',        kind: 'backward' },
      { from: 'review',      to: 'done',        label: 'Approve',         kind: 'forward' },
      { from: 'review',      to: 'cancelled',   label: 'Decline',         kind: 'forward', requires_reason: true },
      { from: 'review',      to: 'in_progress', label: 'Revise',          kind: 'backward', requires_reason: true },
      { from: 'intake',      to: 'cancelled',   label: 'Cancel',          kind: 'forward', requires_reason: true },
    ],
  },

  // ─── Provisioning Workflow ───────────────────────────────────────────────
  // For environment setup, database changes, access provisioning
  // Submitted → Approval → Provisioning → Validation → Done
  {
    name:        'Provisioning',
    description: 'Infrastructure and access provisioning with approval gate and validation step.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      { key: 'intake',      name: 'Submitted',     stage_class: 'intake',      stage_type: 'waiting',  display_order: 1, is_entry_stage: true, sla_hours: 8 },
      { key: 'approval',    name: 'Pending Approval', stage_class: 'review',   stage_type: 'working',  display_order: 2, sla_hours: 24, requires_review: true },
      { key: 'queued',      name: 'Approved',       stage_class: 'approved',   stage_type: 'waiting',  display_order: 3 },
      { key: 'in_progress', name: 'Provisioning',   stage_class: 'in-progress', stage_type: 'working', display_order: 4 },
      { key: 'validation',  name: 'Validation',     stage_class: 'review',     stage_type: 'working',  display_order: 5, sla_hours: 8 },
      { key: 'done',        name: 'Completed',      stage_class: 'done',       stage_type: 'waiting',  display_order: 6, is_terminal: true },
      { key: 'cancelled',   name: 'Rejected',       stage_class: 'cancelled',  stage_type: 'waiting',  display_order: 7, is_terminal: true },
    ],
    transitions: [
      { from: 'intake',      to: 'approval',    label: 'Submit for Approval', kind: 'forward' },
      { from: 'approval',    to: 'queued',       label: 'Approve',             kind: 'forward' },
      { from: 'approval',    to: 'cancelled',   label: 'Reject',              kind: 'forward', requires_reason: true },
      { from: 'approval',    to: 'intake',      label: 'Need More Info',      kind: 'backward', requires_reason: true },
      { from: 'queued',      to: 'in_progress', label: 'Start Provisioning',  kind: 'forward' },
      { from: 'in_progress', to: 'validation',  label: 'Ready for Validation', kind: 'forward' },
      { from: 'validation',  to: 'done',        label: 'Validated',           kind: 'forward' },
      { from: 'validation',  to: 'in_progress', label: 'Failed Validation',   kind: 'backward', requires_reason: true },
      { from: 'in_progress', to: 'cancelled',   label: 'Cancel',              kind: 'forward', requires_reason: true },
    ],
  },

  // ─── Requisition Workflow ────────────────────────────────────────────────
  // For hiring, procurement, budget requests
  // Submitted → Manager Review → HR/Finance Approval → Procurement → Done
  {
    name:        'Requisition',
    description: 'Multi-stage approval workflow for hiring, procurement, and budget requests.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      { key: 'intake',         name: 'Submitted',         stage_class: 'intake',      stage_type: 'waiting',  display_order: 1, is_entry_stage: true, sla_hours: 24 },
      { key: 'manager_review', name: 'Manager Review',    stage_class: 'review',      stage_type: 'working',  display_order: 2, sla_hours: 48, requires_review: true },
      { key: 'approval',       name: 'Finance Approval',  stage_class: 'approved',    stage_type: 'working',  display_order: 3, sla_hours: 72 },
      { key: 'in_progress',    name: 'In Procurement',    stage_class: 'in-progress', stage_type: 'working',  display_order: 4 },
      { key: 'done',           name: 'Fulfilled',         stage_class: 'done',        stage_type: 'waiting',  display_order: 5, is_terminal: true },
      { key: 'cancelled',      name: 'Denied',            stage_class: 'cancelled',   stage_type: 'waiting',  display_order: 6, is_terminal: true },
    ],
    transitions: [
      { from: 'intake',         to: 'manager_review', label: 'Submit',            kind: 'forward' },
      { from: 'manager_review', to: 'approval',       label: 'Endorse',           kind: 'forward' },
      { from: 'manager_review', to: 'cancelled',      label: 'Deny',              kind: 'forward', requires_reason: true },
      { from: 'manager_review', to: 'intake',         label: 'Return',            kind: 'backward', requires_reason: true },
      { from: 'approval',       to: 'in_progress',    label: 'Approve & Proceed', kind: 'forward' },
      { from: 'approval',       to: 'cancelled',      label: 'Deny',              kind: 'forward', requires_reason: true },
      { from: 'in_progress',    to: 'done',           label: 'Fulfilled',         kind: 'forward' },
      { from: 'in_progress',    to: 'cancelled',      label: 'Cancel',            kind: 'forward', requires_reason: true },
    ],
  },

  // ─── Design Sprint ───────────────────────────────────────────────────────
  // For UX design work with research, design, and handoff stages
  {
    name:        'Design Sprint',
    description: 'Design workflow from research through prototyping to handoff.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      { key: 'intake',      name: 'Requested',     stage_class: 'intake',      stage_type: 'waiting',  display_order: 1, is_entry_stage: true, sla_hours: 24 },
      { key: 'triage',      name: 'Scoping',       stage_class: 'triage',      stage_type: 'working',  display_order: 2 },
      { key: 'research',    name: 'Research',       stage_class: 'in-progress', stage_type: 'working',  display_order: 3 },
      { key: 'design',      name: 'Designing',      stage_class: 'in-progress', stage_type: 'working',  display_order: 4 },
      { key: 'review',      name: 'Design Review', stage_class: 'review',      stage_type: 'working',  display_order: 5, requires_review: true },
      { key: 'handoff',     name: 'Handoff',        stage_class: 'delivery',    stage_type: 'working',  display_order: 6 },
      { key: 'done',        name: 'Delivered',      stage_class: 'done',        stage_type: 'waiting',  display_order: 7, is_terminal: true },
      { key: 'cancelled',   name: 'Cancelled',      stage_class: 'cancelled',   stage_type: 'waiting',  display_order: 8, is_terminal: true },
    ],
    transitions: [
      { from: 'intake',    to: 'triage',    label: 'Scope',           kind: 'forward' },
      { from: 'triage',    to: 'research',  label: 'Start Research',  kind: 'forward' },
      { from: 'triage',    to: 'design',    label: 'Skip to Design',  kind: 'forward' },
      { from: 'research',  to: 'design',    label: 'Begin Design',    kind: 'forward' },
      { from: 'design',    to: 'review',    label: 'Submit for Review', kind: 'forward' },
      { from: 'review',    to: 'handoff',   label: 'Approve',         kind: 'forward' },
      { from: 'review',    to: 'design',    label: 'Revise',          kind: 'backward', requires_reason: true },
      { from: 'handoff',   to: 'done',      label: 'Delivered',       kind: 'forward' },
      { from: 'intake',    to: 'cancelled', label: 'Cancel',          kind: 'forward', requires_reason: true },
      { from: 'triage',    to: 'cancelled', label: 'Cancel',          kind: 'forward', requires_reason: true },
    ],
  },
]
