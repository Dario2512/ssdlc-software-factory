// Turns the reviewing agent's structured output (env OUTPUT, JSON) into a PR review comment.
// The agent's text is untrusted: it is escaped so it cannot inject markup or mentions.
const raw = process.env.OUTPUT || "";
let data;
try {
  data = JSON.parse(raw);
} catch {
  data = null;
}

const clean = (s) =>
  String(s ?? "")
    .replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))
    .replace(/@/g, "@​") // no accidental @mentions
    .replace(/\r?\n/g, " ")
    .slice(0, 2000);

const lines = ["### 🔍 Reviewing agent (fresh context)", ""];
if (!data || !data.verdict) {
  lines.push("**Verdict: no verdict.** The reviewing agent returned no structured output, so the check fails.");
} else {
  const ok = data.verdict === "approve";
  lines.push(`**Verdict: ${ok ? "✅ approve" : "❌ request changes"}**`, "", clean(data.summary), "");
  const findings = Array.isArray(data.findings) ? data.findings : [];
  if (findings.length) {
    lines.push("| Check | File | Line | Problem |", "|---|---|---|---|");
    for (const f of findings) {
      lines.push(`| ${Number(f.check) || "?"} | \`${clean(f.file).replace(/`/g, "")}\` | ${Number(f.line) || ""} | ${clean(f.problem).replace(/\|/g, "\\|")} |`);
    }
  } else {
    lines.push("No findings.");
  }
}
lines.push("", "<sub>Checked against docs/SECURITY-REVIEW.md from main. Read-only tools, no shell, no web.</sub>");
process.stdout.write(lines.join("\n") + "\n");
