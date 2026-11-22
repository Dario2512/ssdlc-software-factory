// Builds one audit-log record (a single JSON line) from environment variables and,
// for agent runs, from the Claude Code execution file.
//
//   AUDIT_KIND      agent-run | pipeline | human-decision | harness
//   AUDIT_ACTOR     who acted (agent identity or GitHub login)
//   AUDIT_ROLE      writer | reviewer | deployer | gate | human
//   AUDIT_ACTION    what was done, e.g. "opened-pr", "reviewed-pr", "deployed"
//   AUDIT_TICKET    issue number the action served
//   AUDIT_PR        pull request number (optional)
//   AUDIT_RESULT    success | failure | refused | approved | changes-requested ...
//   AUDIT_DECISION  for humans: deploy-to-production | spend-above-cap | destructive-data-change
//   AUDIT_DETAILS   free text (optional)
//   AUDIT_MODEL     model id (optional)
//   AUDIT_EXECUTION_FILE  path to Claude's execution output (optional)
//
// Prints the JSON line to stdout. Never includes prompts, tool outputs or secrets: only
// tool names, file paths, counts, turns, duration and cost.
import { readFileSync, existsSync } from "node:fs";

const env = process.env;
const record = {
  ts: new Date().toISOString(),
  kind: env.AUDIT_KIND || "pipeline",
  actor: env.AUDIT_ACTOR || env.GITHUB_ACTOR || "unknown",
  role: env.AUDIT_ROLE || null,
  action: env.AUDIT_ACTION || null,
  ticket: env.AUDIT_TICKET ? Number(env.AUDIT_TICKET) : null,
  pr: env.AUDIT_PR ? Number(env.AUDIT_PR) : null,
  result: env.AUDIT_RESULT || null,
  decision: env.AUDIT_DECISION || null,
  details: env.AUDIT_DETAILS || null,
  model: env.AUDIT_MODEL || null,
  repo: env.GITHUB_REPOSITORY || null,
  workflow: env.GITHUB_WORKFLOW || null,
  run_id: env.GITHUB_RUN_ID ? Number(env.GITHUB_RUN_ID) : null,
  run_url: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
  commit: env.AUDIT_COMMIT || env.GITHUB_SHA || null,
};

function relativePath(p) {
  const ws = env.GITHUB_WORKSPACE ? env.GITHUB_WORKSPACE.replace(/\/$/, "") + "/" : null;
  if (ws && p.startsWith(ws)) return p.slice(ws.length);
  return p.replace(/^\/home\/runner\/work\/[^/]+\/[^/]+\//, "");
}

const file = env.AUDIT_EXECUTION_FILE;
if (file && existsSync(file)) {
  try {
    const raw = readFileSync(file, "utf8").trim();
    const messages = raw.startsWith("[") ? JSON.parse(raw) : raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const tools = {};
    const files = new Set();
    for (const m of messages) {
      if (m.type === "system" && m.subtype === "init" && m.model) record.model = m.model;
      if (m.type === "assistant") {
        for (const c of m.message?.content || []) {
          if (c.type !== "tool_use") continue;
          tools[c.name] = (tools[c.name] || 0) + 1;
          const p = c.input?.file_path || c.input?.path;
          if (p) files.add(relativePath(String(p)));
        }
      }
      if (m.type === "result") {
        record.turns = m.num_turns ?? null;
        record.duration_ms = m.duration_ms ?? null;
        record.cost_usd = m.total_cost_usd ?? null; // notional on a subscription token
        record.agent_error = m.is_error ?? null;
        record.agent_stop = m.subtype ?? null;
      }
    }
    record.tool_calls = tools;
    record.files_touched = [...files].sort();
  } catch (err) {
    record.execution_parse_error = String(err.message || err);
  }
}

process.stdout.write(JSON.stringify(record) + "\n");
