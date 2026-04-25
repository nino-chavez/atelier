---
id: ADR-015
trace_id: BRD:Epic-1
category: architecture
session: design-session-2026-04-24
composer: nino-chavez
timestamp: 2026-04-24T15:15:00Z
---

# One hive, many projects

**Summary.** A "hive" is one team's deployed infrastructure (one datastore + one endpoint + one set of deploys). A hive hosts multiple projects. Schema includes `projects` table from v1.

**Rationale.** Hackathon-hive treats the hive as a singleton implicitly. Breaks as teams add projects. Plural-projects at v1 is cheap; retrofit is expensive.

**Consequences.** `atelier init` registers a project in an existing hive or creates a new hive. `projects` table is first-class. RLS scopes everything to project_id. Single hive can host dev, analyst, design projects independently.
