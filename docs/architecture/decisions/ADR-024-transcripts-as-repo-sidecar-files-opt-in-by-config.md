---
id: ADR-024
trace_id: BRD:Epic-4
category: architecture
session: walk-analyst-week-1-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T16:15:00Z
---

# Transcripts as repo-sidecar files, opt-in by config

**Summary.** Agent-session transcripts are stored as sidecar files in the repo (e.g., `research/US-1.3-deploy-research.transcript.jsonl`). Schema gains `contributions.transcript_ref text` (nullable). Capture is opt-in via `.atelier/config.yaml: transcripts.capture: false` (default). Sidecars are gitignored by default; opt-in commits them under a documented PII review.

**Rationale.** Surfaced by the analyst-week-1 walk (`walks/analyst-week-1.md` Gap #3). Transcripts carry provenance, eval-feedback, and audit value but also size and PII risk. Repo-sidecar with config opt-in keeps repo-first semantics (ADR-005), lets teams choose, and avoids forcing an external blob-store dependency on every Atelier deploy.

**Consequences.** ARCH §5.1 contributions table gains `transcript_ref text`. `.atelier/config.yaml` gains a `transcripts:` section. METHODOLOGY documents size + PII implications and the opt-in review flow. Captured transcripts contribute to fit_check eval feedback only when explicitly tagged for inclusion.
