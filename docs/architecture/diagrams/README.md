# Diagrams

**Audience question:** Can I see the architecture visually?

**Primary tier served:** Tier 2 (Reference Implementation extenders) — visual aids supplementing `../ARCHITECTURE.md`.

## Status

**Pre-M2.** Empty placeholder. Diagrams land as needed during M2–M7 implementation:

| Diagram type | Lands at | Source format |
|---|---|---|
| Component diagram (capability-level) | M2 | Mermaid in `.md` |
| Schema ER diagram | M2 | Mermaid |
| Sequence diagrams (claim flow, log_decision flow, find_similar flow) | M2–M5 | Mermaid |
| Triage pipeline diagram | M6 | Mermaid |
| Two-substrate orthogonality diagram | M2 | Mermaid |

Diagrams are committed as text-source (Mermaid) for repo-canonical authorship. SVG renders will be CI-generated (post-M2 when CI exists), not committed.
