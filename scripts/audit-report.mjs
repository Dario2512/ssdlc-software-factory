#!/usr/bin/env node
// Prints the audit log as a readable table, straight from the audit-log branch.
//   node scripts/audit-report.mjs                  everything this month
//   node scripts/audit-report.mjs --ticket 3       everything that served ticket #3
//   node scripts/audit-report.mjs --humans         the human log: every human action and its decision
//   node scripts/audit-report.mjs --month 2026-12
// Requires gh (logged in) and must run inside the repository.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const month = opt("--month") || new Date().toISOString().slice(0, 7);
const ticket = opt("--ticket");
const humans = args.includes("--humans");

const gh = (...a) => execFileSync("gh", a, { encoding: "utf8" }).trim();
const repo = process.env.REPO || gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner");

let raw = "";
try {
  raw = gh("api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/audit/${month}.jsonl?ref=audit-log`);
} catch {
  console.error(`No audit log for ${month} on the audit-log branch of ${repo}.`);
  process.exit(1);
}

let records = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (ticket) records = records.filter((r) => String(r.ticket) === String(ticket));
if (humans) records = records.filter((r) => r.role === "human");

const title = humans ? "Human log" : ticket ? `Audit log for ticket #${ticket}` : "Audit log";
console.log(`${title} · ${repo} · ${month} · ${records.length} record(s)\n`);
for (const r of records) {
  const when = r.ts.replace("T", " ").slice(0, 19) + "Z";
  const who = `${r.actor}${r.role ? ` (${r.role})` : ""}`;
  const what = [r.action, r.decision ? `decision=${r.decision}` : null, r.result ? `result=${r.result}` : null].filter(Boolean).join(" ");
  const refs = [r.ticket ? `ticket #${r.ticket}` : null, r.pr ? `PR #${r.pr}` : null].filter(Boolean).join(", ");
  console.log(`${when}  ${who}`);
  console.log(`    ${what}${refs ? `  [${refs}]` : ""}`);
  if (r.model || r.turns != null) {
    const tools = r.tool_calls ? Object.entries(r.tool_calls).map(([k, v]) => `${k}×${v}`).join(" ") : "";
    console.log(`    model=${r.model ?? "?"} turns=${r.turns ?? "?"} cost≈$${r.cost_usd ?? 0} ${tools}`);
  }
  if (r.files_touched?.length) console.log(`    files: ${r.files_touched.join(", ")}`);
  if (r.details) console.log(`    ${r.details}`);
  if (r.run_url) console.log(`    ${r.run_url}`);
  console.log();
}
