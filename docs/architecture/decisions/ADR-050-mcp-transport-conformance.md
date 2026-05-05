# ADR 050: Hand-rolled MCP Transport Conformance

**Date:** 2026-05-04
**Status:** Accepted
**Context:** The M8 Grounding Audit (S01) flagged our hand-rolled JSON-RPC adapter (`scripts/endpoint/lib/transport.ts`) for four deviations from the MCP Streamable HTTP transport spec (2025-11-25), noting that the canonical fix path was to either migrate to the official `@modelcontextprotocol/sdk` or document the disqualifier and patch the gaps.
**Decision:** We choose to retain our hand-rolled JSON-RPC adapter instead of adopting `@modelcontextprotocol/sdk`, and will patch the four conformance gaps directly.
**Because:** The 12-tool surface in Atelier is statically asserted at compile-time and strictly aligned with our architectural model (ARCH 6.x). The official SDK adds significant dependency surface area and internal abstraction layers that obscure the wire-level JSON-RPC boundaries, which we prefer to keep explicit for security auditing and edge-runtime deployability.
**Consequences:** We must implement strict Origin validation (DNS rebinding protection), MCP-Protocol-Version negotiation, Accept header enforcement, and proper JSON-RPC notification semantics (HTTP 202 No Content). This ensures we match the canonical specification without the SDK overhead.
