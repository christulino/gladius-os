/**
 * Export current database seed data to CSV files for editing in Excel.
 * Run: node db/seeds/export-csv.js
 * Output: db/seeds/csv/*.csv
 */

import { query } from '../../db/postgres.js'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, 'csv')
mkdirSync(outDir, { recursive: true })

function toCsv(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map(h => {
      let v = row[h]
      if (v === null || v === undefined) return ''
      if (v instanceof Date) return v.toISOString()
      if (typeof v === 'object') v = JSON.stringify(v)
      v = String(v)
      if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        return '"' + v.replace(/"/g, '""') + '"'
      }
      return v
    }).join(','))
  }
  return lines.join('\n')
}

const tables = [
  ['org_types', `
    SELECT id, name, slug, sort_order
    FROM blueprint.org_types ORDER BY sort_order
  `],
  ['organizations', `
    SELECT o.id, o.slug, o.name, o.org_type, o.parent_id,
           p.slug AS parent_slug, o.is_active
    FROM blueprint.organizations o
    LEFT JOIN blueprint.organizations p ON p.id = o.parent_id
    ORDER BY o.id
  `],
  ['roles', `
    SELECT id, name, description, is_system_default
    FROM blueprint.roles ORDER BY id
  `],
  ['permissions', `
    SELECT id, slug, name, description, scope, category
    FROM blueprint.permissions ORDER BY category, slug
  `],
  ['service_classes', `
    SELECT id, name, description, priority_order, color,
           max_concurrent, can_bypass_wip, is_date_driven, is_system_default
    FROM blueprint.service_classes ORDER BY priority_order
  `],
  ['work_item_type_classes', `
    SELECT id, name, description, is_system_default, default_workflow_id
    FROM blueprint.work_item_type_classes ORDER BY id
  `],
  ['workflows', `
    SELECT id, name, description, version, is_system_default
    FROM blueprint.workflows ORDER BY id
  `],
  ['stages', `
    SELECT s.id, s.workflow_id, w.name AS workflow_name,
           s.name, s.stage_class, s.stage_type, s.display_order,
           s.is_entry_stage, s.is_terminal, s.sla_hours, s.wip_limit,
           s.has_waiting_queue, s.requires_review, s.requires_evidence
    FROM blueprint.stages s
    JOIN blueprint.workflows w ON w.id = s.workflow_id
    WHERE s.is_active = true
    ORDER BY s.workflow_id, s.display_order
  `],
  ['transitions', `
    SELECT t.id, w.name AS workflow_name,
           fs.name AS from_stage, ts.name AS to_stage,
           t.transition_label, t.transition_kind, t.requires_reason
    FROM blueprint.stage_transitions t
    JOIN blueprint.stages fs ON fs.id = t.from_stage_id
    JOIN blueprint.stages ts ON ts.id = t.to_stage_id
    JOIN blueprint.workflows w ON w.id = fs.workflow_id
    WHERE t.is_active = true
    ORDER BY w.name, fs.display_order
  `],
  ['work_item_types', `
    SELECT wit.id, wit.name, wit.description,
           o.slug AS org_slug, c.name AS class_name,
           wit.key_prefix, wit.icon, wit.color,
           wit.request_mode, wit.is_published, wit.is_system_default
    FROM blueprint.work_item_types wit
    JOIN blueprint.organizations o ON o.id = wit.owner_org_id
    JOIN blueprint.work_item_type_classes c ON c.id = wit.class_id
    ORDER BY o.slug, wit.name
  `],
  ['wit_type_workflows', `
    SELECT wit.name AS type_name, o.slug AS org_slug,
           w.name AS workflow_name, wtw.is_current
    FROM blueprint.work_item_type_workflows wtw
    JOIN blueprint.work_item_types wit ON wit.id = wtw.work_item_type_id
    JOIN blueprint.organizations o ON o.id = wit.owner_org_id
    JOIN blueprint.workflows w ON w.id = wtw.workflow_id
    ORDER BY o.slug, wit.name
  `],
  ['users', `
    SELECT id, email, display_name
    FROM blueprint.users ORDER BY id
  `],
  ['org_memberships', `
    SELECT u.display_name, u.email,
           o.slug AS org_slug, r.name AS role_name
    FROM blueprint.org_memberships om
    JOIN blueprint.users u ON u.id = om.user_id
    JOIN blueprint.organizations o ON o.id = om.org_id
    JOIN blueprint.roles r ON r.id = om.role_id
    ORDER BY u.display_name, o.slug
  `],
  ['work_items', `
    SELECT wi.id, wi.title, wi.display_key,
           o.slug AS org_slug, wit.name AS type_name,
           s.name AS stage_name, wi.current_substate, wi.spawn_state,
           wi.due_date, wi.is_expedited, wi.work_nature, wi.priority
    FROM runtime.work_items wi
    JOIN blueprint.organizations o ON o.id = wi.owner_org_id
    JOIN blueprint.work_item_types wit ON wit.id = wi.work_item_type_id
    JOIN blueprint.stages s ON s.id = wi.current_stage_id
    ORDER BY wi.id
  `],
  ['lookup_lists', `
    SELECT ll.id, o.slug AS org_slug, ll.name, ll.description, ll.sort_mode
    FROM blueprint.lookup_lists ll
    JOIN blueprint.organizations o ON o.id = ll.org_id
    WHERE ll.is_active = true
    ORDER BY ll.id
  `],
  ['lookup_values', `
    SELECT ll.name AS list_name, lv.label, lv.sort_order, lv.is_active
    FROM blueprint.lookup_values lv
    JOIN blueprint.lookup_lists ll ON ll.id = lv.list_id
    ORDER BY lv.list_id, lv.sort_order
  `],
]

for (const [name, sql] of tables) {
  const result = await query(sql)
  const csv = toCsv(result.rows)
  const path = join(outDir, name + '.csv')
  writeFileSync(path, csv)
  console.log(`  ${name}.csv — ${result.rows.length} rows`)
}

console.log(`\nExported ${tables.length} files to db/seeds/csv/`)
process.exit(0)
