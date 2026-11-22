#!/usr/bin/env bash
# Human decision "spend above the cap": raise the monthly agent budget, on the record.
#   scripts/raise-cap.sh <runs> <usd> "<reason>"
set -euo pipefail
runs="${1:?usage: raise-cap.sh <runs> <usd> \"<reason>\"}"
usd="${2:?usage: raise-cap.sh <runs> <usd> \"<reason>\"}"
reason="${3:?a reason is required: it goes into the human log}"
REPO="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

old_runs="$(gh variable get AGENT_RUN_CAP --repo "$REPO" 2>/dev/null || echo unset)"
old_usd="$(gh variable get AGENT_USD_CAP --repo "$REPO" 2>/dev/null || echo unset)"
gh variable set AGENT_RUN_CAP --repo "$REPO" --body "$runs"
gh variable set AGENT_USD_CAP --repo "$REPO" --body "$usd"
echo "Cost cap: runs ${old_runs} -> ${runs}, notional USD ${old_usd} -> ${usd}."

month="$(date -u +%Y-%m)"
path="audit/${month}.jsonl"
record="$(AUDIT_KIND=human-decision AUDIT_ACTOR="$(gh api user --jq .login)" AUDIT_ROLE=human \
  AUDIT_ACTION=raise-cost-cap AUDIT_DECISION=spend-above-cap AUDIT_RESULT=done \
  AUDIT_DETAILS="runs ${old_runs}->${runs}, usd ${old_usd}->${usd}: ${reason}" GITHUB_REPOSITORY="$REPO" \
  node "$(dirname "$0")/audit-record.mjs")"
sha="$(gh api "repos/${REPO}/contents/${path}?ref=audit-log" --jq .sha 2>/dev/null || true)"
content="$( { gh api -H 'Accept: application/vnd.github.raw' "repos/${REPO}/contents/${path}?ref=audit-log" 2>/dev/null || true; printf '%s\n' "$record"; } | base64 | tr -d '\n')"
gh api -X PUT "repos/${REPO}/contents/${path}" -f message="audit: human raise-cost-cap" -f branch=audit-log \
  -f content="$content" ${sha:+-f sha="$sha"} >/dev/null
echo "Recorded in the audit log as decision spend-above-cap."
