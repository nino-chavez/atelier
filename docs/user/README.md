# User

**Audience question:** How do I use Atelier as an end-user (composer, principal, stakeholder)?

**Primary tier served:** Tier 1 — Reference Deployment users (deployed an instance, now want to use it).

This layer follows the [Diátaxis framework](https://diataxis.fr/): four quadrants serving four distinct learning intents.

| Quadrant | Audience need | Examples |
|---|---|---|
| **Tutorials** | Learning (newcomer) | "Getting started with Atelier", "Your first multi-composer session" |
| **Guides** | Doing (practitioner) | "How to claim a contribution", "How to recover from a stuck lock" |
| **Reference** | Information (lookup) | CLI commands, MCP tools, config schema |
| **Explanation** | Understanding (context) | "Why fencing tokens?", "Why repo-canonical?", "Why no SaaS?" |

## Status

**Pre-v1 launch.** Empty placeholder. End-user docs land here at v1 per [`../strategic/BUILD-SEQUENCE.md`](../strategic/BUILD-SEQUENCE.md).

## Contents (planned at v1)

```
user/
├── tutorials/
│   ├── getting-started.md          # atelier init → first deploy → first session
│   ├── first-multi-composer.md     # Two principals working concurrently
│   └── first-remote-agent.md       # Connect a web-based agent (claude.ai with MCP)
├── guides/
│   ├── claim-contribution.md
│   ├── log-decision.md
│   ├── run-find-similar.md
│   ├── recover-from-stuck-lock.md
│   └── add-a-composer.md
├── reference/
│   ├── cli/                        # One file per CLI command
│   ├── mcp-tools/                  # One file per MCP tool (the 12)
│   ├── config/                     # `.atelier/config.yaml` reference
│   └── schema/                     # Datastore schema reference
└── explanation/
    ├── why-fencing-tokens.md
    ├── why-repo-canonical.md
    ├── why-no-saas.md
    ├── why-find-similar.md
    └── why-three-tiers.md
```

## Related layers

- For tier-2 users contributing back: [`../developer/`](../developer/)
- For tier-3 users implementing the protocol elsewhere: [`../architecture/protocol/`](../architecture/protocol/)
