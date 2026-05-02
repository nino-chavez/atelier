# Claude Agent SDK corpus (BRD-OPEN-QUESTIONS §26 wider eval)

**Provenance.** Snapshot fetched 2026-05-02 from:

- `https://code.claude.com/docs/en/agent-sdk/*.md` — 31 official Agent SDK doc pages (the `.md` endpoint returns markdown directly)
- `https://raw.githubusercontent.com/anthropics/claude-agent-sdk-python/main/README.md` — `github-python-README.md`
- `https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/README.md` — `github-typescript-README.md`

Two pages listed in `code.claude.com/docs/llms.txt` were 404 at fetch time (`channels.md`, `checkpointing.md`) and are not in this corpus. The `> ## Documentation Index` boilerplate header that prefixed every `code.claude.com` response was stripped from each file before commit.

**Total items: 33.**

**Why this corpus.** Selected for the §26 wider find_similar eval per Nino's 2026-05-02 corpus-selection call. Comparable size to M5's Atelier-internal 54-item corpus (ADRs + BRD + research). Different domain and authorship — agent-builder docs vs methodology-authoring discovery — so generalization questions §26 surfaced (does advisory tier hold across corpora? does blocking become reachable on smaller-but-better-discriminated corpora?) get a second data point.

**Topic coverage.**

| File | Topic |
|---|---|
| `overview.md` | Agent SDK product overview; Python + TypeScript intro; capabilities tabs (built-in tools, hooks, subagents, MCP, permissions, sessions); comparison vs Client SDK / CLI / Managed Agents |
| `quickstart.md` | Build a bug-fixing agent end-to-end; first-run walkthrough |
| `agent-loop.md` | Message lifecycle; tool execution; context window; agent architecture |
| `python.md` | Full Python SDK API reference |
| `typescript.md` | Full TypeScript SDK API reference |
| `typescript-v2-preview.md` | TypeScript SDK v2 preview shape |
| `migration-guide.md` | Migration from Claude Code SDK → Claude Agent SDK |
| `sessions.md` | Session lifecycle, resume, fork |
| `hooks.md` | PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, UserPromptSubmit hooks |
| `mcp.md` | MCP server connection, transports, tool search, auth, error handling |
| `custom-tools.md` | In-process MCP server, custom tools, function definitions |
| `subagents.md` | Spawn specialized sub-agents, AgentDefinition, parent_tool_use_id |
| `permissions.md` | allowed_tools, permission modes, denyTools, permission prompts |
| `slash-commands.md` | `.claude/commands/*.md` custom commands for the SDK |
| `skills.md` | `.claude/skills/*/SKILL.md` specialized capabilities |
| `plugins.md` | Programmatic plugins via `plugins` option |
| `claude-code-features.md` | Loading project instructions, skills, hooks, settings sources |
| `modifying-system-prompts.md` | Output styles, systemPrompt append, custom system prompts |
| `streaming-output.md` | Streaming tool output back to caller |
| `streaming-vs-single-mode.md` | Single-shot vs streaming invocation modes |
| `structured-outputs.md` | Schema-validated structured response output |
| `todo-tracking.md` | TodoWrite tool usage |
| `tool-search.md` | Searching MCP tool sets at scale |
| `cost-tracking.md` | Token usage, cost estimation, prompt caching config |
| `observability.md` | OpenTelemetry traces, metrics, events export |
| `secure-deployment.md` | Production sandboxing, isolation, deny lists |
| `hosting.md` | Production deployment shapes |
| `file-checkpointing.md` | Track + revert file changes during sessions |
| `user-input.md` | AskUserQuestion tool, interactive approval prompts |
| `github-python-README.md` | Python SDK GitHub README (install, quickstart-shape, link to docs) |
| `github-typescript-README.md` | TypeScript SDK GitHub README (install, quickstart-shape, link to docs) |

**Eval shape.** This corpus seeds a separate Atelier project (`project_id` distinct from `atelier-self`) so the embedded rows coexist with the M5 Atelier-internal corpus. Eval runner queries against the claude-agent-sdk project_id only; comparison data point against M5's Atelier-internal numbers feeds the §27 cross-encoder activation rule per ADR-043.

**Refresh cadence.** Snapshot is intentionally pinned (date in this file's "Provenance" line). The Agent SDK docs evolve; refreshing this corpus is operator-driven when the §26 eval re-runs (if/when blocking-tier is in question again, or when an adopter signals interest in re-validating).

**Hand-fetch reproduction:**

```bash
cd atelier/eval/find_similar/external-corpora/claude-agent-sdk

# 31 doc pages
for page in agent-loop claude-code-features cost-tracking custom-tools \
            file-checkpointing hooks hosting mcp migration-guide \
            modifying-system-prompts observability overview permissions \
            plugins python quickstart secure-deployment sessions skills \
            slash-commands streaming-output streaming-vs-single-mode \
            structured-outputs subagents todo-tracking tool-search typescript \
            typescript-v2-preview user-input; do
  curl -s -L "https://code.claude.com/docs/en/agent-sdk/${page}.md" -o "${page}.md"
done

# 2 GitHub READMEs
curl -s -L "https://raw.githubusercontent.com/anthropics/claude-agent-sdk-python/main/README.md" \
  -o github-python-README.md
curl -s -L "https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/README.md" \
  -o github-typescript-README.md

# Strip the boilerplate "Documentation Index" header that prefixes each code.claude.com response:
for f in *.md; do
  if head -3 "$f" | grep -q "Documentation Index"; then
    sed -i '' '1,4d' "$f"
  fi
done
```
