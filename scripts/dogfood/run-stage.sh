#!/usr/bin/env bash
#
# run-stage.sh — Feature-factory step 2: chain the stages.
#
# Generalises run-discovery.sh. Advances one work item to a TARGET stage (one hop at a
# time, no skips), injecting that stage's playbook as the session's system prompt, and
# lets a single headless Claude session do that stage's workflow-layer work + satisfy the
# stage's exit gate via the Gladius MCP. The wrapper owns the in-server executor toggle
# (disable on entry, restore on exit) so the agent is the sole writer for the stage it owns
# — implementing the "one execution owner per stage" rule (Decision: Gladius serves; consumers orchestrate).
#
# MCP-only / code-blind. Real code work + worktree isolation come in step 3.
#
# Usage:  scripts/dogfood/run-stage.sh DISPLAY_KEY TARGET_STAGE_ID
#         e.g. run-stage.sh FEAT.25352 639      # advance to Planning
#
set -euo pipefail
REPO="/Users/chris/Documents/ai/gladius-os"; cd "$REPO"
PB="$REPO/scripts/dogfood/playbooks"
ORG_ID=109
export PGPASSWORD=flowos_dev
PSQL=(psql -h localhost -p 5432 -U flowos -d flowos -t -A)

DISPLAY_KEY="${1:?usage: run-stage.sh DISPLAY_KEY TARGET_STAGE_ID}"
TARGET="${2:?usage: run-stage.sh DISPLAY_KEY TARGET_STAGE_ID}"

# --- Stage map for workflow 138 "Feature Development" ---------------------------------
stage_name() { case "$1" in
  636) echo Backlog;; 637) echo Todo;; 638) echo Discovery;; 639) echo Planning;;
  640) echo "Dev/Test";; 641) echo Review;; 642) echo Deployment;; 643) echo Done;;
  *) echo "stage$1";; esac; }
playbook_for() { case "$1" in
  638) echo "$PB/discovery.md";; 639) echo "$PB/planning.md";; 640) echo "$PB/dev-test.md";;
  641) echo "$PB/review.md";; 642) echo "$PB/deployment.md";; *) echo "";; esac; }
gate_for() { case "$1" in   # human-readable description of the stage's blocking exit gate
  638) echo "at least one entry of type 'discovery' AND at least one of type 'acceptance'";;
  639) echo "at least one entry of type 'note' (the Planning Brief)";;
  640) echo "no codified exit gate (transition is free); produce the Dev/Test Brief note";;
  641) echo "fields pr_url (exists) and pr_status (=merged) — these are EVIDENCE the MCP cannot set; record the Review Brief note and STOP, reporting that the gate needs field evidence";;
  642) echo "field deployed_version (exists) — EVIDENCE the MCP cannot set; record the Deployment Brief and STOP";;
  *) echo "unknown";; esac; }

# --- Resolve item -------------------------------------------------------------------
read -r WID CUR < <("${PSQL[@]}" -F' ' -c "SELECT id, current_stage_id FROM runtime.work_items WHERE display_key='${DISPLAY_KEY}' AND owner_org_id=${ORG_ID};")
[[ -n "${WID:-}" ]] || { echo "ERROR: ${DISPLAY_KEY} not found in org ${ORG_ID}" >&2; exit 1; }
PLAYBOOK="$(playbook_for "$TARGET")"
[[ -n "$PLAYBOOK" && -f "$PLAYBOOK" ]] || { echo "ERROR: no playbook for stage ${TARGET}" >&2; exit 1; }
echo ">> ${DISPLAY_KEY} (id ${WID}) in '$(stage_name "$CUR")' (${CUR}) -> target '$(stage_name "$TARGET")' (${TARGET})"

# --- Wrapper owns the executor toggle: disable in-server playbook(s) on the target ----
DEACTIVATED="$("${PSQL[@]}" -q -c "UPDATE blueprint.stage_playbooks SET is_active=false WHERE stage_id=${TARGET} AND is_active=true RETURNING id;" | grep -E '^[0-9]+$' | paste -sd, -)"
restore() { [[ -n "$DEACTIVATED" ]] && "${PSQL[@]}" -q -c "UPDATE blueprint.stage_playbooks SET is_active=true WHERE id IN (${DEACTIVATED});" && echo ">> restored in-server playbook(s): ${DEACTIVATED}"; }
trap restore EXIT
[[ -n "$DEACTIVATED" ]] && echo ">> disabled in-server executor for target stage: ${DEACTIVATED}"

# --- Build the path of stage ids from current+1 .. target ---------------------------
PATH_IDS=""; for ((s=CUR+1; s<=TARGET; s++)); do PATH_IDS+="${s} "; done

PLAYBOOK_BODY="$(awk 'flag {print} /^---[[:space:]]*$/ {c++; if (c==2) flag=1}' "$PLAYBOOK")"
TASK="$(cat <<EOF
Advance work item ${DISPLAY_KEY} (work_item_id=${WID}) in org_id ${ORG_ID} to the
'$(stage_name "$TARGET")' stage (stage_id ${TARGET}), then do that stage's work.

Steps:
1. get_work_item(work_item_id=${WID}, org_id=${ORG_ID}) and get_assembled_context(...) to read current state + journal.
2. Transition forward ONE hop at a time with transition_work_item(..., org_id=${ORG_ID}, target_stage_id=NEXT),
   in this exact order of target_stage_id: ${PATH_IDS}. Do not skip. If any transition is rejected by an exit
   criterion, report the criterion and STOP.
3. On reaching '$(stage_name "$TARGET")', perform that stage's pass per your system-prompt playbook and write the
   resulting entries with write_context_entry(work_item_id=${WID}, org_id=${ORG_ID}, entry_type=..., content=...).
   This stage's exit gate requires: $(gate_for "$TARGET").
4. Report: stages traversed, entries written (type + title), and whether the stage's exit gate is now satisfiable.

Use ONLY the gladius MCP tools. You cannot read the codebase; defer code-level claims to the worker.
EOF
)"

echo ">> launching headless session (sonnet, gladius MCP only)..."; echo "----------------------------------------------------------------"
claude -p \
  --mcp-config "$REPO/.mcp.json" --strict-mcp-config \
  --allowedTools "mcp__gladius__get_work_item,mcp__gladius__search_work_items,mcp__gladius__get_assembled_context,mcp__gladius__list_context_entries,mcp__gladius__list_org_context,mcp__gladius__transition_work_item,mcp__gladius__write_context_entry,mcp__gladius__add_comment" \
  --append-system-prompt "$PLAYBOOK_BODY" \
  --model sonnet --output-format json \
  "$TASK" | tee "/tmp/run-stage-${TARGET}.json" | (jq -r '.result' 2>/dev/null || cat)

echo "----------------------------------------------------------------"
echo ">> VERIFY — current stage + journal:"
"${PSQL[@]}" -F'|' -c "
  SELECT 'stage' AS k, s.name AS v FROM runtime.work_items wi JOIN blueprint.stages s ON s.id=wi.current_stage_id WHERE wi.id=${WID}
  UNION ALL
  SELECT 'entry:'||type||(CASE WHEN is_agent THEN ' (agent)' ELSE ' (human)' END),
         left(coalesce(title, regexp_replace(content, E'\\\\n',' ','g')),58)
    FROM runtime.context_entries WHERE work_item_id=${WID} ORDER BY 1;"
