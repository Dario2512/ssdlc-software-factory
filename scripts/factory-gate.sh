#!/usr/bin/env bash
# The gate every agent job passes before it may spend anything.
#   usage: scripts/factory-gate.sh <write|review>
# Checks, in order:
#   1. Kill switch : repository variable FACTORY_ENABLED must be "true".
#   2. Trust       : (write only) the ticket author must be the repo owner, a collaborator,
#                    or the factory's own bot. A stranger's issue on a public repo never
#                    reaches the agent.
#   3. Cost cap    : agent runs and notional spend this month, read from the audit log,
#                    must be under AGENT_RUN_CAP and AGENT_USD_CAP. Raising a cap is a
#                    human decision ("spend above the cap").
# Writes ok=true|false and reason=... to $GITHUB_OUTPUT. Exits 0 either way; the caller decides.
set -euo pipefail

mode="${1:?usage: factory-gate.sh <write|review>}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

refuse() {
  echo "Factory gate refused: $1" >&2
  { echo "ok=false"; echo "reason=$1"; } >> "$out"
  exit 0
}

# 1. Kill switch
if [[ "${FACTORY_ENABLED:-}" != "true" ]]; then
  refuse "kill switch is on (FACTORY_ENABLED=${FACTORY_ENABLED:-unset})"
fi

# 2. Trust (who wrote the ticket)
if [[ "$mode" == "write" ]]; then
  case "${AUTHOR_ASSOC:-NONE}" in
    OWNER|MEMBER|COLLABORATOR) ;;
    *)
      if [[ -z "${BOT_LOGIN:-}" || "${AUTHOR:-}" != "$BOT_LOGIN" ]]; then
        refuse "ticket author '${AUTHOR:-?}' (${AUTHOR_ASSOC:-NONE}) is not trusted to start the factory"
      fi
      ;;
  esac
fi

# 3. Cost cap, counted from this month's audit log on the audit-log branch
month="$(date -u +%Y-%m)"
log="$(gh api -H 'Accept: application/vnd.github.raw' \
  "repos/${GITHUB_REPOSITORY}/contents/audit/${month}.jsonl?ref=audit-log" 2>/dev/null || true)"
read -r runs usd < <(printf '%s\n' "$log" | node -e '
  let runs = 0, usd = 0;
  for (const line of require("fs").readFileSync(0, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.kind === "agent-run") { runs++; usd += Number(r.cost_usd || 0); }
    } catch {}
  }
  console.log(runs, usd.toFixed(2));
')
run_cap="${AGENT_RUN_CAP:-40}"
usd_cap="${AGENT_USD_CAP:-20}"
echo "Cost so far in ${month}: ${runs} agent run(s), \$${usd} notional (caps: ${run_cap} runs, \$${usd_cap})."
if (( runs >= run_cap )); then
  refuse "cost cap reached: ${runs}/${run_cap} agent runs this month"
fi
if node -e "process.exit(Number('$usd') >= Number('$usd_cap') ? 0 : 1)"; then
  refuse "cost cap reached: \$${usd}/\$${usd_cap} notional spend this month"
fi

{ echo "ok=true"; echo "reason=passed (runs ${runs}/${run_cap}, \$${usd}/\$${usd_cap})"; } >> "$out"
echo "Factory gate passed."
