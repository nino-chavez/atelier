# research/

Research artifacts authored by analyst composers. Per ADR-003 and ADR-009, research is a first-class territory with `scope_kind=research_artifact`.

## Structure

Each research artifact is a markdown file named `<trace-id>-<slug>.md` with a sidecar transcript file when the research was conducted via a web-based agent session.

```
research/
├── README.md                      # This file
├── <trace-id>-<slug>.md           # Distilled research artifact
└── <trace-id>-<slug>.transcript.json  # (optional) full agent-session transcript
```

## Example filename convention

- `US-1.3-competitive-analysis.md` — research on US-1.3
- `US-1.3-competitive-analysis.transcript.json` — the agent session that produced it
- `BRD:Epic-7-redlock-fencing-lit-review.md` — epic-level research

## Artifact frontmatter

Each research artifact starts with YAML frontmatter:

```yaml
---
trace_id: US-1.3
author: <composer-id>
session: <session-id>
created: 2026-04-24
kind: research
summary: One-sentence summary for fit_check indexing
transcript: US-1.3-competitive-analysis.transcript.json  # optional
---
```

## Lifecycle

1. Analyst composer claims a `kind=research` contribution via web agent.
2. Agent authors content, committed to `research/<trace-id>-<slug>.md`.
3. Session transcript (if preserved) stored as sidecar `.transcript.json`.
4. `log_decision` captures conclusions into `decisions.md`.
5. Contribution transitions to `review`.
6. PM or architect reviews and merges (or sends back with feedback).

## Seed content

This directory is initially empty. It populates as analyst composers work.

## Why research is in the repo

Per ADR-005 and the "repo is canonical" principle: durable knowledge-work artifacts belong in the repo so they survive datastore outages, so they flow through normal git workflows (review, blame, history), and so they are indexable by fit_check alongside decisions and contributions.
