// Guardrail: what a writing agent is allowed to change.
// Usage: node scripts/check-scope.mjs <file-with-changed-paths>   (one path per line)
// An agent pull request may only touch site content and tests. Anything else (workflows,
// harness scripts, dependencies, agent rules) needs a human, so the change is refused.
import { readFileSync } from "node:fs";

const ALLOWED = [/^content\/posts\/[a-z0-9-]+\.md$/, /^content\/pages\/[a-z0-9-]+\.md$/, /^content\/site\.json$/, /^src\/style\.css$/, /^test\/[a-z0-9-]+\.test\.mjs$/];

const listFile = process.argv[2];
if (!listFile) {
  console.error("usage: check-scope.mjs <changed-files.txt>");
  process.exit(2);
}
const changed = readFileSync(listFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const outside = changed.filter((p) => !ALLOWED.some((re) => re.test(p)));

if (changed.length === 0) {
  console.error("Scope check: the agent changed no files.");
  process.exit(1);
}
if (outside.length) {
  console.error("Scope check failed. An agent may not change:\n - " + outside.join("\n - "));
  process.exit(1);
}
console.log(`Scope check passed (${changed.length} file(s)):\n - ` + changed.join("\n - "));
