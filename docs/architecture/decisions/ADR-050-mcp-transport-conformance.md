---
id: ADR-050
trace_id: BRD:Epic-1
category: architecture
session: m8-grounding-audit-s01
composer: nino-chavez
timestamp: 2026-05-04T00:00:00Z
---

# Hand-rolled MCP Transport: patch the four spec gaps; do not migrate to `@modelcontextprotocol/sdk`

**Summary.** The M8 grounding audit's S01 finding flagged the hand-rolled JSON-RPC adapter at `scripts/endpoint/lib/transport.ts` for four deviations from the MCP Streamable HTTP transport spec (2025-11-25): no Origin validation (DNS-rebinding exposure); `notifications/initialized` returning a JSON-RPC envelope instead of HTTP 202 with no body; `MCP-Protocol-Version` header ignored on subsequent requests; `Accept` header not enforced. The canonical fix path was either (a) migrate to `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport` (used in `tools/hackathon-hive/mcp-server/api/mcp.ts` by the same author), or (b) patch the four conformance points and document the disqualifier for the canonical SDK. We choose (b).

## Decision

Retain the hand-rolled JSON-RPC adapter. Patch the four conformance gaps directly in `scripts/endpoint/lib/transport.ts`.

## Rationale

The 12-tool surface in `scripts/endpoint/lib/dispatch.ts:30-50` carries a compile-time `_twelveCheck: 12` length assertion that locks the surface against drift per ADR-040. The official SDK's tool-registration shape (`server.tool(name, schema, handler)`) is more dynamic — it would require either runtime length-check or a parallel ADR-040-tracking layer. The hand-rolled transport keeps the wire-level JSON-RPC boundaries explicit, which is load-bearing for the per-call JWKS bearer-validation path and for the security review surface (Origin, signature, replay protection live where the wire format does).

The disqualifier-side considerations: `@modelcontextprotocol/sdk` is well-maintained and we acknowledge the alternative is also defensible. The choice between (a) and (b) is closer than the original audit framing implied; the deciding factor is the compile-time-locked tool surface contract.

## Consequences

The four patches land in `scripts/endpoint/lib/transport.ts`:

- **Origin validation** — reject requests whose `Origin` header is not in an allowlist (default: localhost + `NEXT_PUBLIC_SITE_URL` host); HTTP 403 on rejection. Closes the DNS-rebinding exposure.
- **MCP-Protocol-Version negotiation** — return HTTP 400 when the client's `MCP-Protocol-Version` header is not in the supported set; pass through `Mcp-Protocol-Version` on InitializeResult.
- **Accept header enforcement** — require `application/json` and `text/event-stream` per spec; HTTP 406 when missing.
- **Notification semantics** — `notifications/initialized` returns HTTP 202 with no body; JSON-RPC §4.1 explicitly forbids responding to notifications.

Smokes (`scripts/endpoint/__smoke__/transport.smoke.ts`, `scripts/endpoint/__smoke__/real-client.smoke.ts`) extend with assertions for each conformance point so the smoke-vs-real-client divergence pattern (per Nino's memory-pattern note) is closed at this surface.

The decision does NOT preclude future migration to `@modelcontextprotocol/sdk`; if the SDK's tool-registration shape grows compile-time-locked surface enforcement, the disqualifier dissolves and the migration becomes a maintenance simplification.
