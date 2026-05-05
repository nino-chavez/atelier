---
title: "ADR-048: v1 Infrastructure Reset and Comprehensive Grounding Audit"
date: 2026-05-04
status: accepted
reverses: ADR-027, ADR-046
suspends: ADR-028, ADR-041
---

# ADR-048: v1 Infrastructure Reset and Comprehensive Grounding Audit

## Context
During the transition to the v1.x lifecycle, empirical evidence demonstrated severe architectural divergence in the deployed reference implementation. Four critical infrastructure surfaces (auth, environment variables, DB connection patterns, and deployment config) were found to be misaligned with vendor canonical standards, causing breakage in the Vercel/Supabase production environment. 

The existing `§11.5b` audit discipline failed to catch these divergences because it was:
1. **A spec-reading exercise**, not an empirical test (e.g., the spec claimed the Supabase JS client was used, but the code used raw `pg.Pool`).
2. **Pre-scoped**, rendering unscoped surfaces invisible to the auditors.
3. **Overly permissive**, allowing "justified divergence" verdicts based on theoretical deferrals rather than hardened proofs.

Because these core assumptions were tested only against internal consistency and not against industry-standard baselines, the current "v1 substrate" is methodologically a v0.

## Decision
We are enforcing a methodological **"Soft Reset"** of the reference infrastructure. 

1. **Reversals:** This ADR formally reverses `ADR-027` (Reference implementation stack) and `ADR-046` (Deploy strategy) in their current forms, and suspends `ADR-028` (Identity default) and `ADR-041` (Embedding default). The capabilities they describe remain the target, but their specific implementation details in the current codebase are declared **ungrounded and untrusted**.
2. **The Grounding Audit:** Before any further v1.x features are developed, the entire infrastructure surface must pass a new **Comprehensive Canonical-Grounding Audit** (to be executed as milestone M8).
3. **Empirical Protocol:** The M8 audit replaces the `§11.5b` methodology with a strict 5-step, empirical protocol:
    *   **Discovery First:** A flat list of all architectural seams is generated with no pre-scoping.
    *   **Parallel, Isolated Audits:** Each surface is audited in an isolated worktree.
    *   **Strict Verdicts:** Surfaces must return either `matches-canonical` (with evidence), `diverges-with-documented-reason` (ADR-level justification), or `diverges-silently` (unjustified, flagged for fix).
    *   **Empirical Verification:** Auditors must *run* the surface (e.g., actually rotate a bearer token, actually subscribe to Realtime) rather than reading the spec.
    *   **Single Matrix:** Results aggregate into a living matrix artifact.

## Consequences
*   The project halts advancement on `BUILD-SEQUENCE` v1.x features until the M8 Grounding milestone is completed.
*   The forensic history of our infrastructural missteps is preserved in the reversed ADRs, serving as a permanent guardrail (Chesterton's fence) against future AI-agents or humans hallucinating the same flawed custom patterns.
*   The newly generated `v1-comprehensive-grounding-audit.md` matrix becomes the definitive gatekeeper for the reference implementation's trustworthiness.
