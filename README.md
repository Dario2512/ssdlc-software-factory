# Audit log

One JSON line per action, in `audit/YYYY-MM.jsonl`: who, what, when, and the ticket it
served. Written by the factory's workflows; human decisions are recorded here too.
This branch is protected: no force pushes, no deletion. Read it with
`node scripts/audit-report.mjs` on main.
