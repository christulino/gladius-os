#!/usr/bin/env bash
#
# run-discovery.sh — Feature-factory build step 1: one stage, one feature, manual.
#
# Spawns a single headless Claude Code session that claims a real feature, walks it
# from its current stage to Discovery via the Gladius MCP, and performs a code-blind
# Discovery pass — writing the journal entries that satisfy the Discovery exit gate
# (>=1 `discovery` + >=1 `acceptance` context entry).
#
# Model (b): Claude drives the loop. Gladius is system-of-record + playbook provider.
# No worktree, no cron — that comes later. This is the inside-out first lap.
#
# Usage:  scripts/dogfood/run-discovery.sh [DISPLAY_KEY]    (default: FEAT.25346)
#
set -euo pipefail

REPO="/Users/chris/Documents/ai/gladius-os"
cd "$REPO"

DISPLAY_KEY="${1:-FEAT.25346}"
ORG_ID=109
DISCOVERY_STAGE=638          # workflow 138 "Feature Development"
PLAYBOOK="$REPO/scripts/dogfood/playbooks/discovery.md"

export PGPASSWORD=flowos_dev
PSQL=(psql -h localhost -p 5432 -U flowos -d flowos -t -A)

# --- Resolve the work item from its display key ---------------------------------
read -r WORK_ITEM_ID CUR_STAGE CUR_STAGE_NAME < <(
  "${PSQL[@]}" -F' ' -c "
    SELECT wi.id, wi.current_stage_id, s.name
    FROM runtime.work_items wi JOIN blueprint.stages s ON s.id = wi.current_stage_id
    WHERE wi.display_key = '${DISPLAY_KEY}' AND wi.owner_org_id = ${ORG_ID};"
)
if [[ -z "${WORK_ITEM_ID:-}" ]]; then
  echo "ERROR: ${DISPLAY_KEY} not found in org ${ORG_ID}." >&2; exit 1
fi
echo ">> ${DISPLAY_KEY} = work_item_id ${WORK_ITEM_ID}, currently in '${CUR_STAGE_NAME}' (stage ${CUR_STAGE})"

# --- Strip YAML frontmatter from the playbook; keep only the instruction body ----
PLAYBOOK_BODY="$(awk 'flag {print} /^---[[:space:]]*$/ {c++; if (c==2) flag=1}' "$PLAYBOOK")"

# --- The task prompt handed to the session ---------------------------------------
TASK="$(cat <<EOF
You are advancing work item ${DISPLAY_KEY} (work_item_id=${WORK_ITEM_ID}) in org_id ${ORG_ID}
through the Gladius "Feature Development" workflow into the Discovery stage, then performing
the Discovery pass described in your system prompt.

Stage IDs in order: Backlog=636, Todo=637, Discovery=638, Planning=639. Do NOT skip stages.

Do this:
1. get_work_item(work_item_id=${WORK_ITEM_ID}, org_id=${ORG_ID}) — read the title, description, current stage.
2. get_assembled_context(work_item_id=${WORK_ITEM_ID}, org_id=${ORG_ID}) — pull existing journal + org context.
3. Transition forward ONE hop at a time with transition_work_item(..., org_id=${ORG_ID}, target_stage_id=NEXT)
   until the current stage is Discovery (638). If a transition is rejected by exit criteria, report why and stop.
4. Once in Discovery, perform the Discovery pass and write entries with
   write_context_entry(work_item_id=${WORK_ITEM_ID}, org_id=${ORG_ID}, entry_type=..., content=...).
   The Discovery exit gate REQUIRES at least one entry of entry_type "discovery" AND at least one of
   entry_type "acceptance". Put the title of each entry as a markdown heading at the top of its content.
5. Report: stages traversed, and every entry you wrote (entry_type + its title).

Use ONLY the gladius MCP tools. You cannot read the codebase — defer all code-level claims to the worker.
EOF
)"

echo ">> launching headless session (sonnet, gladius MCP only)..."
echo "----------------------------------------------------------------"

claude -p \
  --mcp-config "$REPO/.mcp.json" \
  --strict-mcp-config \
  --allowedTools "mcp__gladius__get_work_item,mcp__gladius__search_work_items,mcp__gladius__get_assembled_context,mcp__gladius__list_context_entries,mcp__gladius__list_org_context,mcp__gladius__transition_work_item,mcp__gladius__write_context_entry,mcp__gladius__add_comment" \
  --append-system-prompt "$PLAYBOOK_BODY" \
  --model sonnet \
  --output-format json \
  "$TASK" | tee /tmp/run-discovery-out.json | (jq -r '.result' 2>/dev/null || cat)

echo "----------------------------------------------------------------"
echo ">> VERIFY — current stage + Discovery-gate entries:"
"${PSQL[@]}" -F'|' -c "
  SELECT 'stage' AS k, s.name AS v
    FROM runtime.work_items wi JOIN blueprint.stages s ON s.id = wi.current_stage_id
    WHERE wi.id = ${WORK_ITEM_ID}
  UNION ALL
  SELECT 'entry:' || type || (CASE WHEN is_agent THEN ' (agent)' ELSE ' (human)' END),
         left(coalesce(title, regexp_replace(content, E'\\\\n', ' ', 'g')), 60)
    FROM runtime.context_entries
    WHERE work_item_id = ${WORK_ITEM_ID}
    ORDER BY 1;"
