#!/usr/bin/env bash
# Configures the GitHub repository as code, so every harness setting is reviewable.
#   scripts/setup-repo.sh <owner/repo> [approver-login]
# Idempotent: safe to run again. Requires gh logged in as the repo owner.
set -euo pipefail

REPO="${1:?usage: setup-repo.sh <owner/repo> [approver-login]}"
APPROVER="${2:-${REPO%%/*}}"
api() { gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }
step() { printf '\n== %s\n' "$*"; }

step "Repository settings: squash (agent PRs) or rebase (human PRs, keeps each commit) merges, auto-merge, delete merged branches"
api -X PATCH "repos/${REPO}" \
  -F allow_auto_merge=true -F delete_branch_on_merge=true \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=true \
  -F has_wiki=false -F has_projects=false >/dev/null

step "Secret scanning and push protection"
api -X PATCH "repos/${REPO}" --input - >/dev/null <<'JSON' || echo "  (could not enable; check Settings > Code security)"
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON

step "Least privilege: GITHUB_TOKEN read-only by default; Actions may not approve PRs"
api -X PUT "repos/${REPO}/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

step "Audit log branch (append-only)"
if ! api "repos/${REPO}/branches/audit-log" >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  git -C "$tmp" init -q -b audit-log
  mkdir -p "$tmp/audit"
  cat > "$tmp/README.md" <<'MD'
# Audit log

One JSON line per action, in `audit/YYYY-MM.jsonl`: who, what, when, and the ticket it
served. Written by the factory's workflows; human decisions are recorded here too.
This branch is protected: no force pushes, no deletion. Read it with
`node scripts/audit-report.mjs` on main.
MD
  touch "$tmp/audit/.keep"
  git -C "$tmp" add -A
  git -C "$tmp" -c user.name="factory-setup" -c user.email="factory-setup@users.noreply.github.com" commit -q -m "audit: start the audit log"
  git -C "$tmp" push -q "https://github.com/${REPO}.git" audit-log
  echo "  created"
else
  echo "  exists"
fi

step "Ruleset: main accepts merges only through a PR (linear history) with ci and agent-review green (no bypass)"
ruleset_main='{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "required_linear_history"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false,
      "allowed_merge_methods": ["squash", "rebase"]}},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "do_not_enforce_on_create": false,
      "required_status_checks": [
        {"context": "ci", "integration_id": 15368},
        {"context": "agent-review", "integration_id": 15368}]}}
  ]
}'
ruleset_audit='{
  "name": "append-only-audit-log",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {"ref_name": {"include": ["refs/heads/audit-log"], "exclude": []}},
  "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]
}'
upsert_ruleset() { # $1 name, $2 json
  local id
  id="$(api "repos/${REPO}/rulesets" --jq ".[] | select(.name==\"$1\") | .id" || true)"
  if [[ -n "$id" ]]; then
    api -X PUT "repos/${REPO}/rulesets/${id}" --input - <<<"$2" >/dev/null && echo "  updated $1"
  else
    api -X POST "repos/${REPO}/rulesets" --input - <<<"$2" >/dev/null && echo "  created $1"
  fi
}
upsert_ruleset protect-main "$ruleset_main"
upsert_ruleset append-only-audit-log "$ruleset_audit"

step "GitHub Pages, deployed by the workflow"
api -X POST "repos/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
  || api -X PUT "repos/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 || true
echo "  $(api "repos/${REPO}/pages" --jq .html_url 2>/dev/null || echo 'check Settings > Pages')"

step "Human gate: github-pages environment requires ${APPROVER} to approve; main only"
approver_id="$(api "users/${APPROVER}" --jq .id)"
api -X PUT "repos/${REPO}/environments/github-pages" --input - >/dev/null <<JSON
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{"type": "User", "id": ${approver_id}}],
  "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}
}
JSON
existing="$(api "repos/${REPO}/environments/github-pages/deployment-branch-policies" --jq '.branch_policies[].name' 2>/dev/null || true)"
if ! grep -qx main <<<"$existing"; then
  api -X POST "repos/${REPO}/environments/github-pages/deployment-branch-policies" -f name=main -f type=branch >/dev/null
fi
echo "  required reviewer: ${APPROVER} (id ${approver_id}); deploy branches: main"

step "Labels"
gh label create ticket --repo "$REPO" --color 1f5fbf --description "A ticket for the factory" --force >/dev/null
gh label create agent --repo "$REPO" --color 6f42c1 --description "Opened by an agent" --force >/dev/null
echo "  ticket, agent"

step "Factory variables (kill switch, cost cap, model)"
set_default() { gh variable get "$1" --repo "$REPO" >/dev/null 2>&1 || gh variable set "$1" --repo "$REPO" --body "$2"; echo "  $1=$(gh variable get "$1" --repo "$REPO")"; }
set_default FACTORY_ENABLED true
set_default AGENT_RUN_CAP 40
set_default AGENT_USD_CAP 20
set_default AGENT_MODEL claude-sonnet-5-5

step "Still needed (by you, in the browser / terminal): see docs/SETUP.md"
for s in CLAUDE_CODE_OAUTH_TOKEN FACTORY_APP_PRIVATE_KEY; do
  gh secret list --repo "$REPO" --json name --jq '.[].name' | grep -qx "$s" && echo "  [x] secret $s" || echo "  [ ] secret $s"
done
for v in FACTORY_APP_CLIENT_ID FACTORY_BOT_LOGIN; do
  gh variable get "$v" --repo "$REPO" >/dev/null 2>&1 && echo "  [x] variable $v" || echo "  [ ] variable $v"
done
