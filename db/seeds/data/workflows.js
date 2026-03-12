/**
 * db/seeds/data/workflows.js
 * System default workflows with their stages and transitions.
 *
 * Structure per workflow:
 *   - workflow metadata
 *   - stages (ordered, with micro-state settings)
 *   - transitions (directed edges between stages)
 *
 * Stage classes (universal vocabulary):
 *   intake | triage | queued | in-progress | blocked |
 *   review | approved | delivery | done | cancelled
 *
 * Stage types:
 *   waiting — work is sitting (drives WIP/queue metrics)
 *   working — work is active (drives cycle time)
 *
 * Transition kinds:
 *   forward | backward | sideways | cross-workflow
 */

export const workflows = [

  // =========================================================================
  // 1. SIMPLE TASK
  // For atomic work items that don't need triage or review.
  // intake → in-progress → done
  // =========================================================================
  {
    name:        'Simple Task',
    description: 'Lightweight workflow for well-defined, atomic tasks.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      {
        key:           'intake',
        name:          'Inbox',
        stage_class:   'intake',
        stage_type:    'waiting',
        display_order: 1,
        is_entry_stage:true,
        is_terminal:   false,
        sla_hours:     null,
        wip_limit:     null,
      },
      {
        key:           'in_progress',
        name:          'In Progress',
        stage_class:   'in-progress',
        stage_type:    'working',
        display_order: 2,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     null,
        wip_limit:     null,
        has_waiting_queue: true,
      },
      {
        key:           'done',
        name:          'Done',
        stage_class:   'done',
        stage_type:    'waiting',
        display_order: 3,
        is_entry_stage:false,
        is_terminal:   true,
        sla_hours:     null,
        wip_limit:     null,
      },
      {
        key:           'cancelled',
        name:          'Cancelled',
        stage_class:   'cancelled',
        stage_type:    'waiting',
        display_order: 4,
        is_entry_stage:false,
        is_terminal:   true,
        sla_hours:     null,
        wip_limit:     null,
      },
    ],
    transitions: [
      { from: 'intake',      to: 'in_progress', label: 'Start',    kind: 'forward'  },
      { from: 'in_progress', to: 'done',        label: 'Complete', kind: 'forward'  },
      { from: 'in_progress', to: 'intake',      label: 'Put Back', kind: 'backward' },
      { from: 'intake',      to: 'cancelled',   label: 'Cancel',   kind: 'forward', requires_reason: true },
      { from: 'in_progress', to: 'cancelled',   label: 'Cancel',   kind: 'forward', requires_reason: true },
    ],
  },

  // =========================================================================
  // 2. STANDARD FEATURE
  // Full lifecycle for a feature — triage, queue, build, review, done.
  // intake → triage → queued → in-progress → review → done
  // =========================================================================
  {
    name:        'Standard Feature',
    description: 'Full feature lifecycle with triage, queue, development, and review.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      {
        key:           'intake',
        name:          'Intake',
        stage_class:   'intake',
        stage_type:    'waiting',
        display_order: 1,
        is_entry_stage:true,
        is_terminal:   false,
        sla_hours:     48,
      },
      {
        key:           'triage',
        name:          'Triage',
        stage_class:   'triage',
        stage_type:    'working',
        display_order: 2,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     24,
        wip_limit:     null,
      },
      {
        key:           'queued',
        name:          'Ready',
        stage_class:   'queued',
        stage_type:    'waiting',
        display_order: 3,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     null,
        wip_limit:     null,
        has_waiting_queue: true,
      },
      {
        key:           'in_progress',
        name:          'In Development',
        stage_class:   'in-progress',
        stage_type:    'working',
        display_order: 4,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     null,
        wip_limit:     null,
        has_waiting_queue: true,
      },
      {
        key:           'blocked',
        name:          'Blocked',
        stage_class:   'blocked',
        stage_type:    'waiting',
        display_order: 5,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     24,
      },
      {
        key:           'review',
        name:          'In Review',
        stage_class:   'review',
        stage_type:    'working',
        display_order: 6,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     24,
        wip_limit:     null,
        requires_review: true,
      },
      {
        key:           'done',
        name:          'Done',
        stage_class:   'done',
        stage_type:    'waiting',
        display_order: 7,
        is_entry_stage:false,
        is_terminal:   true,
      },
      {
        key:           'cancelled',
        name:          'Cancelled',
        stage_class:   'cancelled',
        stage_type:    'waiting',
        display_order: 8,
        is_entry_stage:false,
        is_terminal:   true,
      },
    ],
    transitions: [
      { from: 'intake',      to: 'triage',      label: 'Begin Triage',   kind: 'forward'  },
      { from: 'triage',      to: 'queued',       label: 'Accept',         kind: 'forward'  },
      { from: 'triage',      to: 'intake',       label: 'Return',         kind: 'backward' },
      { from: 'queued',      to: 'in_progress',  label: 'Start',          kind: 'forward'  },
      { from: 'in_progress', to: 'review',       label: 'Submit Review',  kind: 'forward'  },
      { from: 'in_progress', to: 'blocked',      label: 'Mark Blocked',   kind: 'sideways', requires_reason: true },
      { from: 'blocked',     to: 'in_progress',  label: 'Unblock',        kind: 'sideways' },
      { from: 'review',      to: 'done',         label: 'Approve',        kind: 'forward'  },
      { from: 'review',      to: 'in_progress',  label: 'Request Changes',kind: 'backward', requires_reason: true },
      { from: 'intake',      to: 'cancelled',    label: 'Cancel',         kind: 'forward',  requires_reason: true },
      { from: 'triage',      to: 'cancelled',    label: 'Cancel',         kind: 'forward',  requires_reason: true },
      { from: 'queued',      to: 'cancelled',    label: 'Cancel',         kind: 'forward',  requires_reason: true },
      { from: 'in_progress', to: 'cancelled',    label: 'Cancel',         kind: 'forward',  requires_reason: true },
    ],
  },

  // =========================================================================
  // 3. BUG TRIAGE
  // Bug lifecycle with severity triage and deployment step.
  // intake → triage → queued → in-progress → review → delivery → done
  // =========================================================================
  {
    name:        'Bug Triage',
    description: 'Bug lifecycle from report through fix, review, and deployment.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      {
        key:           'intake',
        name:          'Reported',
        stage_class:   'intake',
        stage_type:    'waiting',
        display_order: 1,
        is_entry_stage:true,
        is_terminal:   false,
        sla_hours:     4,
      },
      {
        key:           'triage',
        name:          'Triage',
        stage_class:   'triage',
        stage_type:    'working',
        display_order: 2,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     8,
        wip_limit:     null,
      },
      {
        key:           'queued',
        name:          'Fix Queue',
        stage_class:   'queued',
        stage_type:    'waiting',
        display_order: 3,
        is_entry_stage:false,
        is_terminal:   false,
      },
      {
        key:           'in_progress',
        name:          'In Fix',
        stage_class:   'in-progress',
        stage_type:    'working',
        display_order: 4,
        is_entry_stage:false,
        is_terminal:   false,
        wip_limit:     null,
        has_waiting_queue: true,
      },
      {
        key:           'review',
        name:          'Code Review',
        stage_class:   'review',
        stage_type:    'working',
        display_order: 5,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     8,
        requires_review: true,
      },
      {
        key:           'delivery',
        name:          'Deploying',
        stage_class:   'delivery',
        stage_type:    'working',
        display_order: 6,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     4,
      },
      {
        key:           'done',
        name:          'Resolved',
        stage_class:   'done',
        stage_type:    'waiting',
        display_order: 7,
        is_entry_stage:false,
        is_terminal:   true,
      },
      {
        key:           'cancelled',
        name:          'Won\'t Fix',
        stage_class:   'cancelled',
        stage_type:    'waiting',
        display_order: 8,
        is_entry_stage:false,
        is_terminal:   true,
      },
    ],
    transitions: [
      { from: 'intake',      to: 'triage',      label: 'Begin Triage',  kind: 'forward'  },
      { from: 'triage',      to: 'queued',       label: 'Confirm Bug',   kind: 'forward'  },
      { from: 'triage',      to: 'cancelled',    label: 'Won\'t Fix',    kind: 'forward',  requires_reason: true },
      { from: 'triage',      to: 'intake',       label: 'Need More Info',kind: 'backward', requires_reason: true },
      { from: 'queued',      to: 'in_progress',  label: 'Start Fix',     kind: 'forward'  },
      { from: 'in_progress', to: 'review',       label: 'Submit Review', kind: 'forward'  },
      { from: 'review',      to: 'delivery',     label: 'Approve',       kind: 'forward'  },
      { from: 'review',      to: 'in_progress',  label: 'Rework',        kind: 'backward', requires_reason: true },
      { from: 'delivery',    to: 'done',         label: 'Deployed',      kind: 'forward'  },
      { from: 'delivery',    to: 'in_progress',  label: 'Rollback',      kind: 'backward', requires_reason: true },
      { from: 'intake',      to: 'cancelled',    label: 'Won\'t Fix',    kind: 'forward',  requires_reason: true },
      { from: 'in_progress', to: 'cancelled',    label: 'Won\'t Fix',    kind: 'forward',  requires_reason: true },
    ],
  },

  // =========================================================================
  // 4. SERVICE REQUEST
  // For catalog-initiated requests — intake, fulfillment, done.
  // intake → triage → in-progress → done
  // =========================================================================
  {
    name:        'Service Request',
    description: 'Fulfillment workflow for service catalog requests.',
    is_system_default: true,
    version:     '1.0.0',
    stages: [
      {
        key:           'intake',
        name:          'Submitted',
        stage_class:   'intake',
        stage_type:    'waiting',
        display_order: 1,
        is_entry_stage:true,
        is_terminal:   false,
        sla_hours:     24,
      },
      {
        key:           'triage',
        name:          'Under Review',
        stage_class:   'triage',
        stage_type:    'working',
        display_order: 2,
        is_entry_stage:false,
        is_terminal:   false,
        sla_hours:     48,
        wip_limit:     null,
      },
      {
        key:           'approved',
        name:          'Approved',
        stage_class:   'approved',
        stage_type:    'waiting',
        display_order: 3,
        is_entry_stage:false,
        is_terminal:   false,
      },
      {
        key:           'in_progress',
        name:          'Fulfilling',
        stage_class:   'in-progress',
        stage_type:    'working',
        display_order: 4,
        is_entry_stage:false,
        is_terminal:   false,
        wip_limit:     null,
        has_waiting_queue: true,
      },
      {
        key:           'done',
        name:          'Fulfilled',
        stage_class:   'done',
        stage_type:    'waiting',
        display_order: 5,
        is_entry_stage:false,
        is_terminal:   true,
      },
      {
        key:           'cancelled',
        name:          'Rejected',
        stage_class:   'cancelled',
        stage_type:    'waiting',
        display_order: 6,
        is_entry_stage:false,
        is_terminal:   true,
      },
    ],
    transitions: [
      { from: 'intake',      to: 'triage',      label: 'Begin Review',  kind: 'forward'  },
      { from: 'triage',      to: 'approved',    label: 'Approve',       kind: 'forward'  },
      { from: 'triage',      to: 'cancelled',   label: 'Reject',        kind: 'forward',  requires_reason: true },
      { from: 'triage',      to: 'intake',      label: 'Need More Info',kind: 'backward', requires_reason: true },
      { from: 'approved',    to: 'in_progress', label: 'Start',         kind: 'forward'  },
      { from: 'in_progress', to: 'done',        label: 'Fulfill',       kind: 'forward'  },
      { from: 'in_progress', to: 'cancelled',   label: 'Cancel',        kind: 'forward',  requires_reason: true },
      { from: 'approved',    to: 'cancelled',   label: 'Cancel',        kind: 'forward',  requires_reason: true },
    ],
  },

  // =========================================================================
  // 5. PERSONAL KANBAN
  // Lightweight personal workflow for individual task management.
  // Used by personal work items (owner_user_id set, no org).
  // =========================================================================
  {
    name:        'Personal Kanban',
    description: 'Simple personal task board. Inbox → Doing → Done.',
    version:     '1.0.0',
    is_system_default: true,
    stages: [
      {
        key:           'inbox',
        name:          'Inbox',
        stage_class:   'intake',
        stage_type:    'waiting',
        display_order: 1,
        is_entry_stage: true,
        is_terminal:   false,
      },
      {
        key:           'doing',
        name:          'Doing',
        stage_class:   'in-progress',
        stage_type:    'working',
        display_order: 2,
        is_entry_stage: false,
        is_terminal:   false,
      },
      {
        key:           'done',
        name:          'Done',
        stage_class:   'done',
        stage_type:    'waiting',
        display_order: 3,
        is_entry_stage: false,
        is_terminal:   true,
      },
    ],
    transitions: [
      { from: 'inbox', to: 'doing', label: 'Start',   kind: 'forward'  },
      { from: 'doing', to: 'done',  label: 'Complete', kind: 'forward'  },
      { from: 'doing', to: 'inbox', label: 'Pause',    kind: 'backward' },
      { from: 'done',  to: 'doing', label: 'Reopen',   kind: 'backward' },
    ],
  },

]
