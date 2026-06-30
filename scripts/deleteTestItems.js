/**
 * Delete test artifact work items from the Gladius dev/dogfood org.
 *
 * Targets items whose titles match known integration-test patterns:
 *   - "Field writes test <epoch>"
 *   - "Attribution test <epoch>"
 *   - "transitions test <epoch>"
 *   - "Playbook read test <epoch>"
 *   - "bulk-ops test <anything> <epoch>"
 *   - "Event system e2e ..."
 *   - "assembler test parent/child <epoch>"
 *   - "context_entry_exists test <epoch>"
 *   - "waiver / api-tier / no-decisions test <epoch>"
 *   - "executor test <epoch>"
 *   - "__staleness test item / endpoint test <epoch>"
 *   - "History Test <epoch>"
 *   - "Link test A/B <epoch>"
 *   - "Decision Resolution Test <epoch>"
 *
 * Usage:
 *   node scripts/deleteTestItems.js              # dry run — list matches, no deletes
 *   node scripts/deleteTestItems.js --confirm    # actually delete
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency required)
try {
  const envPath = join(__dirname, '..', '.env');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] ??= m[2].trim();
  }
} catch {}

const TARGET_ORG_ID = 109;

const TEST_TITLE_PATTERNS = [
  /^Field writes test \d+$/i,
  /^Attribution test \d+$/i,
  /^transitions test \d+$/i,
  /^Playbook read test \d+$/i,
  /^bulk-ops test .+ \d+$/i,
  /^Event system e2e/i,
  // Additional patterns from tests that still hardcode org 109 (safety net for
  // cases where their after() teardown hooks did not run cleanly):
  /^assembler test (parent|child) \d+$/i,
  /^context_entry_exists test \d+$/i,
  /^(waiver|api-tier|no-decisions) test \d+$/i,
  /^executor test \d+$/i,
  /^__staleness (test item|endpoint test) \d+$/i,
  /^History Test \d+$/i,
  /^Link test [AB] \d+$/i,
  /^Decision Resolution Test \d+$/i,
];

const pool = new pg.Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB       || 'flowos',
  user:     process.env.POSTGRES_USER     || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
});

async function main() {
  const confirm = process.argv.includes('--confirm');
  const client = await pool.connect();

  try {
    // Find all matching items in the target org
    const { rows } = await client.query(
      `SELECT wi.id, wi.title, wi.display_key, s.name AS stage
       FROM runtime.work_items wi
       JOIN blueprint.stages s ON s.id = wi.current_stage_id
       WHERE wi.owner_org_id = $1
       ORDER BY wi.id`,
      [TARGET_ORG_ID],
    );

    const targets = rows.filter(r =>
      TEST_TITLE_PATTERNS.some(p => p.test(r.title))
    );

    if (targets.length === 0) {
      console.log('No test artifacts found — nothing to delete.');
      return;
    }

    console.log(`\nFound ${targets.length} test artifact(s):\n`);
    for (const r of targets) {
      console.log(`  [${r.id}] ${r.display_key.padEnd(12)} ${r.stage.padEnd(12)} ${r.title}`);
    }

    if (!confirm) {
      console.log(`\nDRY RUN — no changes made.`);
      console.log(`Re-run with --confirm to delete these ${targets.length} item(s).`);
      return;
    }

    const ids = targets.map(r => r.id);

    await client.query('BEGIN');

    // 1. Null out parent_id on any children that point to these items
    const reparented = await client.query(
      `UPDATE runtime.work_items SET parent_id = NULL
       WHERE parent_id = ANY($1::int[])`,
      [ids],
    );
    if (reparented.rowCount > 0) {
      console.log(`\nCleared parent_id on ${reparented.rowCount} child item(s).`);
    }

    // 2. Remove work_item_links (no cascade)
    const links = await client.query(
      `DELETE FROM runtime.work_item_links
       WHERE source_work_item_id = ANY($1::int[])
          OR target_work_item_id = ANY($1::int[])`,
      [ids],
    );

    // 3. Remove events (entity_id has no FK, filter by work_item.* event types)
    const events = await client.query(
      `DELETE FROM runtime.events
       WHERE entity_id = ANY($1::int[])
         AND event_type LIKE 'work_item.%'`,
      [ids],
    );

    // 4. Remove tables without ON DELETE CASCADE
    await client.query(`DELETE FROM runtime.work_item_user_relationships WHERE work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.work_item_comments          WHERE work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.stage_transition_history    WHERE work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.substate_history            WHERE work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.checklist_completions       WHERE work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.evidence                    WHERE work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.exit_criteria_status        WHERE work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.flow_metrics_snapshots      WHERE work_item_id = ANY($1::int[])`, [ids]);
    // transition_action_log has two nullable FKs — clear spawned_work_item_id refs, then delete direct refs
    await client.query(`UPDATE runtime.transition_action_log SET spawned_work_item_id = NULL WHERE spawned_work_item_id = ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM runtime.transition_action_log       WHERE work_item_id = ANY($1::int[])`, [ids]);

    // 5. Delete the work items — CASCADE handles:
    //    work_item_edits, work_item_search, attachments, context_entries,
    //    notifications, notification_deliveries, playbook_runs
    const deleted = await client.query(
      `DELETE FROM runtime.work_items WHERE id = ANY($1::int[]) RETURNING id, display_key, title`,
      [ids],
    );

    await client.query('COMMIT');

    console.log(`\nDeleted ${deleted.rowCount} work item(s):`);
    for (const r of deleted.rows) {
      console.log(`  [${r.id}] ${r.display_key}  ${r.title}`);
    }
    console.log(`\nAlso removed: ${links.rowCount} link(s), ${events.rowCount} event(s).`);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
