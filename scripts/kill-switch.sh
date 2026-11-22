#!/usr/bin/env bash
# Kill switch: one command stops every agent within a minute.
#   scripts/kill-switch.sh            stop everything, report how long it took
#   scripts/kill-switch.sh --resume   turn the factory back on
# Requires: gh, logged in as a repo admin. Run from inside the repository.
#
# What "stop" does, in order:
#   1. FACTORY_ENABLED=false  -> every agent job's gate refuses from now on
#   2. disables the agent workflows -> no new runs are even queued
#   3. cancels every queued / in-progress run of every workflow (force-cancel if needed)
#   4. polls until nothing is running, and prints the elapsed time
set -euo pipefail

REPO="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
AGENT_WORKFLOWS=(agent-write.yml agent-review.yml)

log_human_action() { # $1 action, $2 details
  local month record dir
  month="$(date -u +%Y-%m)"
  record="$(AUDIT_KIND=human-action AUDIT_ACTOR="$(gh api user --jq .login)" AUDIT_ROLE=human \
    AUDIT_ACTION="$1" AUDIT_RESULT=done AUDIT_DETAILS="$2" GITHUB_REPOSITORY="$REPO" \
    node "$(dirname "$0")/audit-record.mjs")"
  local path="audit/${month}.jsonl" sha content
  sha="$(gh api "repos/${REPO}/contents/${path}?ref=audit-log" --jq .sha 2>/dev/null || true)"
  content="$( { gh api -H 'Accept: application/vnd.github.raw' "repos/${REPO}/contents/${path}?ref=audit-log" 2>/dev/null || true; printf '%s\n' "$record"; } | base64 | tr -d '\n')"
  gh api -X PUT "repos/${REPO}/contents/${path}" -f message="audit: human $1" -f branch=audit-log \
    -f content="$content" ${sha:+-f sha="$sha"} >/dev/null && echo "Recorded in the audit log."
}

if [[ "${1:-}" == "--resume" ]]; then
  for wf in "${AGENT_WORKFLOWS[@]}"; do gh workflow enable "$wf" --repo "$REPO"; done
  gh variable set FACTORY_ENABLED --repo "$REPO" --body true
  echo "Factory resumed: FACTORY_ENABLED=true, agent workflows enabled."
  log_human_action "factory-resumed" "kill switch released"
  exit 0
fi

start=$(date +%s)
echo "KILL SWITCH on ${REPO} at $(date -u +%H:%M:%SZ)"

gh variable set FACTORY_ENABLED --repo "$REPO" --body false
echo "  [$(( $(date +%s) - start ))s] FACTORY_ENABLED=false"

for wf in "${AGENT_WORKFLOWS[@]}"; do
  gh workflow disable "$wf" --repo "$REPO" 2>/dev/null || true
done
echo "  [$(( $(date +%s) - start ))s] agent workflows disabled"

active_runs() {
  for status in queued in_progress waiting requested pending; do
    gh run list --repo "$REPO" --status "$status" --limit 100 --json databaseId,workflowName \
      --jq '.[] | "\(.databaseId) \(.workflowName)"'
  done
}

round=0
while :; do
  runs="$(active_runs)"
  if [[ -z "$runs" ]]; then break; fi
  round=$((round + 1))
  while read -r id name; do
    [[ -z "$id" ]] && continue
    if (( round <= 3 )); then
      gh run cancel "$id" --repo "$REPO" >/dev/null 2>&1 || true
      echo "  [$(( $(date +%s) - start ))s] cancel run ${id} (${name})"
    else
      gh api -X POST "repos/${REPO}/actions/runs/${id}/force-cancel" >/dev/null 2>&1 || true
      echo "  [$(( $(date +%s) - start ))s] force-cancel run ${id} (${name})"
    fi
  done <<<"$runs"
  if (( $(date +%s) - start > 90 )); then
    echo "Still running after 90s:"; echo "$runs"; exit 1
  fi
  sleep 3
done

elapsed=$(( $(date +%s) - start ))
echo "All agents stopped in ${elapsed}s. Nothing is queued or running."
echo "Resume with: scripts/kill-switch.sh --resume"
log_human_action "kill-switch" "all agents stopped in ${elapsed}s"
