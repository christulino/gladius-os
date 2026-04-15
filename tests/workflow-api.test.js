import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from './helpers/auth.js'

const api = createAuthApi()

// ─── Workflow CRUD ──────────────────────────────────────────────────────────

describe('Workflow API', () => {
  let createdWorkflowId
  let createdStageId
  let orgId

  before(async () => {
    // Get an org to use for creating workflows
    const { data } = await api('/organizations')
    assert.ok(data.rows.length > 0, 'Need at least one org to run tests')
    orgId = data.rows[0].id
  })

  // ── Create ──

  it('should create a workflow with default stages', async () => {
    const { status, data } = await api('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Workflow ' + Date.now(), owner_org_id: orgId }),
    })
    assert.equal(status, 201)
    assert.ok(data.id, 'Should return workflow id')
    assert.ok(data.uri, 'Should return workflow uri')
    createdWorkflowId = data.id
  })

  it('should have 4 default stages after creation', async () => {
    const { status, data } = await api(`/workflows/${createdWorkflowId}`)
    assert.equal(status, 200)
    assert.ok(data.stages, 'Should have stages array')
    assert.equal(data.stages.length, 4, 'Should have 4 default stages (Intake, In Progress, Done, Cancelled)')

    const names = data.stages.map(s => s.name).sort()
    assert.deepEqual(names, ['Cancelled', 'Done', 'In Progress', 'Intake'])
  })

  it('should have default transitions after creation', async () => {
    const { status, data } = await api(`/workflows/${createdWorkflowId}`)
    assert.equal(status, 200)
    assert.ok(data.transitions.length >= 4, 'Should have at least 4 default transitions')
  })

  // ── Create for specific org ──

  it('should create a workflow for a specific org', async () => {
    const { status, data } = await api('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: 'Org-Specific Workflow ' + Date.now(), owner_org_id: orgId }),
    })
    assert.equal(status, 201)
    assert.ok(data.id)
    // Clean up: we just verify creation worked
  })

  it('should reject workflow creation without org', async () => {
    const { status } = await api('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: 'No Org Workflow' }),
    })
    assert.ok(status >= 400, 'Should fail without owner_org_id')
  })

  it('should reject workflow creation without name', async () => {
    const { status } = await api('/workflows', {
      method: 'POST',
      body: JSON.stringify({ owner_org_id: orgId }),
    })
    assert.ok(status >= 400, 'Should fail without name')
  })

  // ── List ──

  it('should list all workflows', async () => {
    const { status, data } = await api('/workflows')
    assert.equal(status, 200)
    assert.ok(data.rows.length > 0, 'Should return at least the created workflow')
    const found = data.rows.find(w => w.id === createdWorkflowId)
    assert.ok(found, 'Should include the created workflow')
  })

  // ── Update Workflow ──

  it('should update workflow name', async () => {
    const newName = 'Updated Workflow ' + Date.now()
    const { status, data } = await api(`/workflows/${createdWorkflowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName }),
    })
    assert.equal(status, 200)
    assert.equal(data.name, newName)
  })

  // ── Add Stage ──

  it('should add a new stage to the workflow', async () => {
    const { status, data } = await api('/stages', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: createdWorkflowId,
        name: 'Code Review',
        stage_class: 'review',
        stage_type: 'waiting',
        display_order: 5,
      }),
    })
    assert.equal(status, 201)
    assert.ok(data.id, 'Should return stage id')
    assert.equal(data.name, 'Code Review')
    createdStageId = data.id
  })

  it('should show the new stage in workflow detail', async () => {
    const { data } = await api(`/workflows/${createdWorkflowId}`)
    const found = data.stages.find(s => s.id === createdStageId)
    assert.ok(found, 'New stage should appear in workflow')
    assert.equal(found.name, 'Code Review')
    assert.equal(found.stage_class, 'review')
  })

  // ── Update Stage ──

  it('should update a stage name and class', async () => {
    const { status, data } = await api(`/stages/${createdStageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Peer Review',
        stage_class: 'review',
        stage_function: 'review',
        from_stage_ids: [],
      }),
    })
    assert.equal(status, 200)
    assert.equal(data.name, 'Peer Review')
  })

  it('should update stage connections (from_stage_ids)', async () => {
    // Get workflow to find stage IDs
    const { data: wf } = await api(`/workflows/${createdWorkflowId}`)
    const inProgressStage = wf.stages.find(s => s.name === 'In Progress')
    assert.ok(inProgressStage, 'Should find In Progress stage')

    const { status } = await api(`/stages/${createdStageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Peer Review',
        from_stage_ids: [inProgressStage.id],
      }),
    })
    assert.equal(status, 200)

    // Verify transition was created
    const { data: wf2 } = await api(`/workflows/${createdWorkflowId}`)
    const transition = wf2.transitions.find(
      t => t.from_stage_id === inProgressStage.id && t.to_stage_id === createdStageId
    )
    assert.ok(transition, 'Should have transition from In Progress to Peer Review')
  })

  it('should update stage connections — remove connection', async () => {
    const { status } = await api(`/stages/${createdStageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Peer Review',
        from_stage_ids: [],
      }),
    })
    assert.equal(status, 200)

    // Verify transition was removed
    const { data: wf } = await api(`/workflows/${createdWorkflowId}`)
    const transitions = wf.transitions.filter(t => t.to_stage_id === createdStageId)
    assert.equal(transitions.length, 0, 'Should have no incoming transitions')
  })

  it('should update WIP limit on a stage', async () => {
    const { status, data } = await api(`/stages/${createdStageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Peer Review',
        wip_limit: 5,
        from_stage_ids: [],
      }),
    })
    assert.equal(status, 200)
    assert.equal(data.wip_limit, 5)
  })

  it('should clear WIP limit by setting null', async () => {
    const { status, data } = await api(`/stages/${createdStageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Peer Review',
        wip_limit: null,
        from_stage_ids: [],
      }),
    })
    assert.equal(status, 200)
    assert.ok(!data.wip_limit, 'WIP limit should be null/cleared')
  })

  // ── Delete Stage ──

  it('should delete a non-protected stage', async () => {
    const { status } = await api(`/stages/${createdStageId}`, {
      method: 'DELETE',
    })
    assert.equal(status, 200)

    // Verify removed from workflow
    const { data: wf } = await api(`/workflows/${createdWorkflowId}`)
    const found = wf.stages.find(s => s.id === createdStageId)
    assert.ok(!found, 'Deleted stage should not appear in workflow')
  })

  // ── Deactivate Workflow ──

  it('should deactivate a workflow', async () => {
    const { status, data } = await api(`/workflows/${createdWorkflowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
    })
    assert.equal(status, 200)
    assert.equal(data.is_active, false)
  })
})

// ─── Generic vs Org-Specific Workflows ──────────────────────────────────────

describe('Workflow — generic vs org-specific', () => {
  it('should list system default workflows', async () => {
    const { data } = await api('/workflows')
    const systemDefault = data.rows.filter(w => w.is_system_default)
    assert.ok(systemDefault.length > 0, 'Should have at least one system default workflow')
  })

  it('should create org-specific workflow with unique name', async () => {
    const { data: orgs } = await api('/organizations')
    const orgId = orgs.rows[0].id

    const { status, data } = await api('/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: 'Org-Only Workflow ' + Date.now(), owner_org_id: orgId }),
    })
    assert.equal(status, 201)
    assert.equal(data.owner_org_id, orgId)
    assert.equal(data.is_system_default, false)
  })
})

// ─── Auth protection ────────────────────────────────────────────────────────

describe('Auth — unauthenticated access', () => {
  it('should reject unauthenticated requests with 401', async () => {
    const res = await fetch((process.env.API_URL || 'http://localhost:3000/admin/api') + '/workflows')
    assert.equal(res.status, 401, 'Unauthenticated request should get 401')
  })
})
