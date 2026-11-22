// Harness item: pinned dependencies.
// Fails if any npm dependency is not an exact version, if the lockfile is missing or
// out of sync, or if any GitHub Action is referenced by a tag instead of a full commit SHA.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
  for (const [name, version] of Object.entries(pkg[field] || {})) {
    if (!EXACT.test(version)) problems.push(`package.json ${field}.${name} = "${version}" is not an exact version`);
  }
}

const lockPath = join(ROOT, "package-lock.json");
if (!existsSync(lockPath)) {
  problems.push("package-lock.json is missing");
} else {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const rootDeps = lock.packages?.[""]?.dependencies || {};
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    if (rootDeps[name] !== version) problems.push(`package-lock.json is out of sync for ${name}`);
    const resolved = lock.packages?.[`node_modules/${name}`];
    if (!resolved?.integrity) problems.push(`package-lock.json has no integrity hash for ${name}`);
  }
}

function workflowFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return workflowFiles(p);
    return /\.ya?ml$/.test(e.name) ? [p] : [];
  });
}

for (const file of workflowFiles(join(ROOT, ".github"))) {
  const text = readFileSync(file, "utf8");
  for (const [, ref] of text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    if (ref.startsWith("./")) continue; // local action, versioned with this repo
    if (ref.startsWith("docker://")) {
      if (!/@sha256:[0-9a-f]{64}$/.test(ref)) problems.push(`${file}: ${ref} is not pinned to a digest`);
      continue;
    }
    if (!/@[0-9a-f]{40}$/.test(ref)) problems.push(`${file.replace(ROOT + "/", "")}: ${ref} is not pinned to a commit SHA`);
  }
}

if (problems.length) {
  console.error("Pinned dependency check failed:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("Pinned dependency check passed: exact npm versions, lockfile in sync, actions pinned to SHAs.");
