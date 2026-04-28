# Connectors

**Audience question:** What clients can connect to my Atelier endpoint, and what is the setup runbook for each?

**Status:** Pre-implementation. The endpoint goes live at M2 per `../../strategic/BUILD-SEQUENCE.md`. This compatibility matrix and the per-client runbooks below are design-time drafts. Verified-status entries become real when M2 ships and each client is exercised against a deployed staging endpoint.

---

## Compatibility matrix

Every client that connects to an Atelier project speaks **MCP over Streamable HTTP** with **OAuth 2.1 bearer tokens** issued by the project's configured identity provider (Supabase Auth by default per ADR-028). The differences across clients are about how the bearer token is obtained and how the MCP server URL is configured.

| Client | Surface | MCP transport | Auth modes | Verified status | Last tested | Setup runbook | Notes |
|---|---|---|---|---|---|---|---|
| claude.ai (Connectors) | web | Streamable HTTP | OAuth 2.1; static bearer fallback | DESIGN ONLY | -- | [claude-ai.md](claude-ai.md) | Primary tier-1 web client per ADR-009 + 7.9 |
| ChatGPT (Connectors / Apps) | web | Streamable HTTP | OAuth 2.1; static bearer fallback | DESIGN ONLY | -- | (not yet authored) | Tier-1 web client; verify before public release |
| Claude Code (CLI/IDE MCP) | ide | Streamable HTTP | static bearer (workspace config) | DESIGN ONLY | -- | (not yet authored) | Primary tier-1 IDE client per dev-week-1 walk |
| Cursor (IDE MCP) | ide | Streamable HTTP | static bearer (workspace config) | DESIGN ONLY | -- | (not yet authored) | Tier-2 IDE client; community-supported |
| Windsurf (IDE MCP) | ide | Streamable HTTP | static bearer (workspace config) | DESIGN ONLY | -- | (not yet authored) | Tier-2 IDE client |
| Codex CLI (terminal MCP) | terminal | Streamable HTTP | static bearer (env var) | DESIGN ONLY | -- | (not yet authored) | Tier-2 terminal client |
| Custom web/CLI agents (AI SDK) | web/terminal | Streamable HTTP | static bearer or OAuth | DESIGN ONLY | -- | (not yet authored) | Anything that speaks remote MCP with bearer auth |

### Verified-status meaning

| Status | Meaning |
|---|---|
| `DESIGN ONLY` | Compatible per spec analysis; not yet smoke-tested against a deployed endpoint |
| `SMOKE TESTED <date>` | The smoke-test sequence per ARCH section 6.1.1 ran end-to-end against this client + a staging endpoint on the named date |
| `PRODUCTION VERIFIED <date>` | Smoke tested, plus real composer work has flowed through this client against a production endpoint |
| `KNOWN ISSUE: <description>` | Smoke test or real-world use surfaced a defect; status reverts to this until resolved |
| `UNSUPPORTED` | The client cannot speak Streamable HTTP MCP, or its auth model conflicts with the spec, or the maintainer has declined compatibility |

Status entries are updated by PR. The PR must include either smoke-test output (for upgrades) or the failing-symptom report (for downgrades).

---

## What "Atelier-compatible" means

A client is Atelier-compatible if it can:

1. Connect to a remote MCP server URL (the project's `ATELIER_ENDPOINT_URL`) over Streamable HTTP.
2. Present an `Authorization: Bearer <jwt>` header on every request, where the JWT comes from the project's identity provider.
3. Discover the 12 tools per ADR-013 via the MCP `tools/list` call.
4. Invoke the smoke-test sequence (ARCH section 6.1.1) and parse its responses.

That's the minimum. Clients that go further (real-time presence, broadcast subscription, transcript capture) light up the experience but are not required for compatibility.

---

## Adding a new client

To add a client to this matrix:

1. Verify it speaks Streamable HTTP MCP and supports `Authorization: Bearer` headers (most do as of MCP spec late 2025).
2. Author a per-client runbook in this directory (`<client>.md`) covering: prerequisites, token acquisition via `atelier invite`, MCP server URL configuration in the client, smoke test invocation, common issues.
3. Run the smoke test against a staging endpoint; capture the output.
4. Open a PR adding the matrix row + runbook + smoke-test evidence. Architect role + PM role co-approve (this is a tier-1 reference-deployment artifact).

---

## Cross-references

- ARCH section 7.9 -- Web-surface auth flow (OAuth 2.1, AS metadata, JWT validation, dynamic vs static paths)
- ARCH section 6.1.1 -- Self-verification flow (smoke test sequence)
- ADR-009 -- Remote-principal actor class (web agents as first-class composers)
- ADR-013 -- 12-tool agent endpoint surface
- ADR-027 -- Reference implementation stack (GitHub + Supabase + Vercel + MCP)
- ADR-028 -- Identity service default Supabase Auth
- analyst-week-1.md, designer-week-1.md -- Two web-surface walks that depend on this connector setup
- dev-week-1.md -- IDE-surface walk that depends on local-config bearer token presentation
