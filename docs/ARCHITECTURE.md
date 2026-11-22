# Architecture

C4 level 2 (containers). Every arrow that crosses a trust boundary has a check, and every
box names the file that implements it.

```mermaid
flowchart LR
  subgraph untrusted["Untrusted"]
    T["Ticket text<br/>(GitHub issue body)"]
    V["Site visitors"]
  end

  subgraph gh["GitHub: Dario2512/ssdlc-software-factory"]
    G["gate job<br/>scripts/factory-gate.sh<br/>kill switch · trust · cost cap"]
    W["writing agent<br/>agent-write.yml<br/>token: GITHUB_TOKEN read-only<br/>tools: Read/Write/Edit only"]
    P["push + PR step<br/>GitHub App token, 1 h<br/>contents/PR/issues write<br/>no workflows, no admin"]
    CI["ci job (required)<br/>ci.yml<br/>pins · audit · gitleaks · scope · tests"]
    R["reviewing agent (required)<br/>agent-review.yml<br/>fresh runner · read-only tools<br/>brief from main"]
    M["main<br/>ruleset protect-main<br/>PR only · no bypass"]
    D["deploy job<br/>deploy.yml<br/>env github-pages<br/>required reviewer"]
    A[("audit-log branch<br/>audit/YYYY-MM.jsonl<br/>append-only ruleset")]
  end

  H(["Named human<br/>approves deploys"])
  C["Claude (Pro subscription)<br/>CLAUDE_CODE_OAUTH_TOKEN"]
  PG["GitHub Pages<br/>production"]

  T -- "opened, label ticket" --> G
  G -- "ok" --> W
  W -- "prompt + ticket as data" --> C
  W -- "changed files" --> P
  P -- "branch agent/issue-N + PR" --> CI
  P --> R
  R -- "diff + brief" --> C
  CI -- "green" --> M
  R -- "approve" --> M
  M -- "push" --> D
  H -- "Approve and deploy" --> D
  D -- "OIDC, pages:write" --> PG
  V --> PG
  W & R & D & G -.-> A
```

## Where each agent holds a token

| Where | Token | Can | Cannot |
|---|---|---|---|
| Writing agent step | `GITHUB_TOKEN` (contents: read, issues: read) + Claude OAuth token | read the repo, call the model | push, comment, merge, deploy, read other secrets |
| Push + PR step (deterministic, not the model) | GitHub App installation token, 1 hour | push `agent/*` branches, open the PR, enable auto-merge, comment | push to `main` (ruleset, no bypass), change workflows (no `workflows` permission), deploy, administer the repo |
| Reviewing agent step | `GITHUB_TOKEN` (contents: read, pull-requests: write) + Claude OAuth token | read, post one review comment | push, approve, merge, deploy |
| Deploy job | OIDC + `pages: write` | publish the built site | run before a named person approves |
| Audit step | GitHub App token, contents: write only | append to `audit-log` | rewrite or delete history (ruleset) |
