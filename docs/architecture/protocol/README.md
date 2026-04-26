# Protocol

**Audience question:** What is the open Atelier protocol, and how do I implement it?

**Primary tier served:** Tier 3 — Specification (protocol implementers)

The Atelier protocol is the 12-tool agent-facing surface defined in ADR-013. It is **stack-agnostic** — MCP is the v1 reference transport, but the protocol itself is implementable on any RPC binding.

## Contents

| Doc | Purpose |
|---|---|
| `tools/` | Per-tool reference (one file per tool). Populated as part of M2. |
| `transport/` | Transport bindings. MCP is the reference; alternatives documented. Populated at M2/M6. |
| `implementing-on-other-stacks.md` | Guide for protocol implementers who are not using the reference impl. Populated alongside M2. |

## Related layers

- For the schema the protocol relies on: [`../schema/`](../schema/)
- For the architecture that hosts the protocol: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- For why the protocol has 12 tools and not 18: [`../decisions/ADR-013-12-tool-agent-endpoint-surface.md`](../decisions/ADR-013-12-tool-agent-endpoint-surface.md) (per ADR-030)

## Status

**Pre-M2.** This directory is a placeholder. Per-tool reference docs and transport binding docs land at M2 when the endpoint stub ships.
