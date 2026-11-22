# SSDLC Field Notes: a site kept alive by a software factory

Track: **keep a site alive**. A static site on GitHub Pages where every change is a commit
an agent made. Humans decide three things only: deploy to production, spend above the
cap, and destructive changes to data.

```
ticket ──▶ writing agent opens a PR ──▶ ci green ──▶ reviewing agent (fresh context) ──▶ auto-merge ──▶ a person approves ──▶ production
 issue      agent-write.yml               ci.yml       agent-review.yml                     ruleset        github-pages env      Pages
```

- **Agents:** Claude Code via `anthropics/claude-code-action`, model `claude-sonnet-5-5`,
  on a Claude Pro subscription token. Planned spend: €0 beyond the existing subscription.
- **Factory:** GitHub (issues, Actions, rulesets, environments, Pages), public repository.
- **Team:** one person, Dario (all roles).

## The harness

| Requirement | How | Where |
|---|---|---|
| Least privilege | The writing agent has a read-only token and only Read/Write/Edit tools: no shell, no web. A deterministic step pushes with a one-hour GitHub App token that cannot push to `main`, change workflows or deploy. The reviewer is read-only. The default `GITHUB_TOKEN` is read-only. | `agent-write.yml`, `agent-review.yml`, [ARCHITECTURE](docs/ARCHITECTURE.md) |
| Protected branch | Ruleset `protect-main`: PR only, squash or rebase merges, linear history, required checks `ci` and `agent-review`, no force push or deletion, **no bypass actors**. | `scripts/setup-repo.sh` |
| Human gate | Environment `github-pages` with a required reviewer (Dario2512), deploy branch `main` only. The approver is written to the audit log. | `deploy.yml`, `scripts/setup-repo.sh` |
| Pinned dependencies | Exact npm versions, a lockfile with integrity hashes, `npm ci`. Every action is pinned to a commit SHA, and gitleaks is checksum-verified. CI fails otherwise. | `scripts/check-pinned.mjs`, `ci.yml` |
| Secrets handling | gitleaks on the agent's changes before push and on the full history in CI. GitHub push protection, a pre-commit hook, no secrets in the agent's reach, and execution logs that keep no secrets. | `ci.yml`, `agent-write.yml`, `.githooks/pre-commit` |
| Audit log | One JSON line per agent run, gate refusal and human decision (who, what, when, ticket, PR, run, model, tools, files, cost) on the append-only `audit-log` branch. | `.github/actions/audit-log`, `scripts/audit-report.mjs` |
| Cost cap | Every agent job passes a gate that counts this month's agent runs and notional USD from the audit log against `AGENT_RUN_CAP` and `AGENT_USD_CAP`, plus `--max-turns` and job timeouts. Raising the cap is a recorded human decision. | `scripts/factory-gate.sh`, `scripts/raise-cap.sh` |
| Kill switch | `scripts/kill-switch.sh`: sets `FACTORY_ENABLED=false`, disables the agent workflows, cancels every running job and prints how long it took. | `scripts/kill-switch.sh` |

Guardrails beyond the list: a scope guard (agents may only touch content), a ticket trust
check (strangers cannot start agents on this public repo), the review brief read from
`main`, markdown with raw HTML escaped, and a strict CSP with no JavaScript.
See the [threat model](docs/THREAT-MODEL.md).

## Commands

```bash
npm ci && npm test                              # build and test the site locally
node scripts/audit-report.mjs --ticket 1        # audit log for one ticket
node scripts/audit-report.mjs --humans          # the human log
scripts/kill-switch.sh                          # stop every agent
scripts/kill-switch.sh --resume
scripts/raise-cap.sh 60 30 "demo week"          # human decision: spend above the cap
```

Setup: [docs/SETUP.md](docs/SETUP.md).
