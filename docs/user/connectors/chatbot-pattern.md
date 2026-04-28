# Chat-app bot pattern (Slack / Discord / Teams)

**Status:** Pattern doc 2026-04-28. This is not a runbook for a single client; it is the architectural pattern that any chat-app bot follows when integrating a chat platform (Slack, Discord, Microsoft Teams, custom) with an Atelier project. A reference Slack/Discord bot is filed for v1.x M6 per `../../strategic/BUILD-SEQUENCE.md`; until then, this doc is the spec a team can implement against today using the v1 protocol primitives.

---

## What problem this solves

Atelier coordinates work between humans and agents through 12 MCP tools (per ADR-013). Today, those tools are reachable from IDE clients (Claude Code, Cursor), web clients (claude.ai, ChatGPT), and terminal clients (Codex). Humans who live primarily in chat (Slack, Discord, Teams) currently have no first-class path to participate in coordination without leaving chat.

In an AI-speed coordination reality (per `../../strategic/addenda/2026-04-28-ai-speed-coordination-and-ace.md`), agents implement work in minutes but humans approve in hours -- the chat surface is where humans ARE in those hours. Pulling them into a separate web tool to approve, claim, or annotate adds latency that defeats the AI-speed gain.

The chatbot pattern lets coordination flow through the chat surface without Atelier becoming a chat app (which ADR-010 explicitly excludes). The chat platform stays canonical for ephemeral conversation; Atelier stays canonical for the artifact + decision + coordination state.

---

## The pattern

```
[ Human in Slack/Discord/Teams ]
            |
            | (chat message: "@atelier-bot claim US-3.2 review territory")
            v
[ Bot service (your code, hosted anywhere) ]
            |
            | (parses intent, calls MCP tools)
            v
[ Atelier MCP endpoint ]   <-- exact same endpoint used by claude.ai, Claude Code, etc.
            |
            v
[ Atelier datastore + repo ]
```

The bot service is the MCP client. The human in chat is the composer (their `composers.discipline + access_level` per ADR-038 still governs what they can do). The bot translates chat-surface intents into MCP tool calls and renders responses back into chat-native formatting (cards, threads, mentions).

---

## Why this fits ADR-010

ADR-010 says "Atelier is not a chat app." That excludes BUILDING chat (we don't author message threads, presence indicators, channel UX, or notification routing). It does NOT exclude INTEGRATING with chat where chat already exists.

The chatbot pattern is integration:
- Chat content (the human's messages, the bot's responses) lives in Slack/Discord/Teams. Atelier never stores chat messages.
- Coordination state (claims, decisions, contributions, locks) lives in Atelier. Chat is the input/output surface, not the system of record.
- The bot service is your code (a few hundred lines wrapping the chat platform's bot SDK + an MCP client SDK). Atelier ships no chat-platform-specific code at v1.

Per the existing-primitives check, this pattern requires zero new spec on the Atelier side: MCP is client-agnostic; identity flows through ADR-028 Supabase Auth (the bot service holds a long-lived bearer token issued via `atelier invite`); ADR-009 already classifies remote-principal composers as first-class.

---

## Composer identity

Two valid models, pick per team policy:

### Model A: bot-as-composer (single shared identity)

The bot service holds one bearer token issued for a synthetic composer (e.g., `slack-bot@atelier`) with `access_level: member` and a chosen `discipline`. Every action attributes to the bot. The chat message author is recorded informally in the contribution body or transcript_ref but not as the canonical `author_composer_id`.

- Pro: one token to manage, one composer record to audit.
- Con: weak attribution. If `bob@team.com` claims a contribution via chat and `alice@team.com` rejects it via chat, both attribute to `slack-bot@atelier` in the canonical state. PR review and audit trail must dig into chat history to recover real authorship.
- Use case: solo or small teams where cross-attribution is not load-bearing, or for read-only bot operations (`get_context`, `find_similar`).

### Model B: per-human-composer tokens (the real model)

The bot service maintains a token-per-human mapping (e.g., from Slack user ID -> Atelier composer + bearer). Each chat user authenticates once via OAuth or via an `atelier invite` link DM'd to them; the bot stores their token (encrypted at rest) and presents it on MCP calls made on their behalf.

- Pro: full canonical attribution. Every action records the real `author_composer_id`. RLS rules per ARCH 5.3 work as designed. Audit trail is intact.
- Con: token storage + rotation become the bot service's responsibility. Treat that storage as a credential vault; per-team OAuth re-authentication on token expiry.
- Use case: teams using chat as a primary surface for coordination (not just read-only or single-actor flows).

For the v1.x M6 reference bot, Model B is the recommended baseline.

---

## What flows through chat vs. canonical state

| Flow | Where it happens | Why |
|---|---|---|
| Conversation about a contribution | Chat platform (ephemeral) | Chat is good at conversation; Atelier never tries to be |
| `claim`, `update`, `release` actions | MCP tools via the bot | These are coordination state changes; canonical lives in Atelier |
| `log_decision` | MCP tool via the bot, with `transcript_ref` pointing at the chat thread | Decision rationale captured both as the decision body AND linked to the chat conversation per ADR-024 |
| Notification of new contributions in your territory | Chat (bot subscribes to broadcast per ARCH 6.8, posts into chat) | Chat is good at notifications; pulling humans into a separate /atelier tab for routine awareness adds friction |
| Reviewing a PR diff | Chat (bot posts diff summary), then GitHub for actual review | Chat is good at "is this worth my attention now"; GitHub remains canonical for diff review |
| Lightweight rationale annotation on a contribution | Chat thread captured into `log_decision` rationale + `transcript_ref` | Removes most of the BRD-OPEN-QUESTIONS section 23 motivation; see that section for the residual non-chat use case |

The pattern's design contract: anything that needs to survive the team adopting a different chat platform tomorrow MUST flow through `log_decision` or `update`. Anything ephemeral can stay in chat.

---

## Implementation sketch

The bot service is your code. Approximate shape:

```
bot service (e.g., Node.js / Deno / Python)
├── chat platform SDK    (Slack Bolt, discord.js, Bot Framework SDK)
├── MCP client SDK       (any client speaking Streamable HTTP per ARCH 7.9)
├── identity store       (per-human Slack-user-id -> Atelier-bearer mapping if Model B)
├── intent parser        (chat command -> MCP tool call)
└── response renderer    (MCP response -> chat-native message)
```

Component sizing (ballpark for a competent team):
- Slack/Discord/Teams bot scaffold: ~1 day (use the platform's SDK).
- MCP client integration: ~1 day (SDK exists; auth is a bearer header).
- Intent parser: ~2 days for the first 5 commands (claim, update, release, log_decision, get_context); more depending on command surface ambition.
- Identity flow (Model B): ~2 days (OAuth handshake routed through the chat platform's deep-link to the project's identity provider).

A v1 chatbot does NOT need to support all 12 tools. A useful starter set:
- `register` / `deregister` (implicit on bot startup / shutdown)
- `get_context` (the human asks "what's my project state?")
- `find_similar` (the human asks "is anyone else working on this?")
- `claim` / `update` / `release` (the human acts on contributions)
- `log_decision` (the human captures a chat-rationale into canonical state)

Other tools (`acquire_lock`, `release_lock`, `propose_contract_change`, etc.) can stay in IDE/web surfaces where they're more naturally expressed.

---

## Identity flow detail (Model B with OAuth)

1. Human types `/atelier login` in chat (or messages the bot DM).
2. Bot responds with a one-time deep link: `https://<your-bot-host>/oauth/start?slack_user=<id>`.
3. The deep link redirects through the project's identity provider (Supabase Auth by default per ADR-028) using the project's standard OAuth flow per ARCH 7.9.
4. On successful auth, the bot stores the resulting bearer token keyed by Slack user ID (encrypted; rotate on `policy.token_ttl_seconds` expiry per `.atelier/config.yaml`).
5. Subsequent chat actions from that user attach the user's bearer to the MCP call.

This is exactly the OAuth flow already specified in ARCH 7.9 -- no new spec on Atelier's side. The bot is just another OAuth consumer of the project's identity provider.

---

## What this pattern does NOT do

- It does NOT make Atelier a chat app. No message storage, no presence, no channel UX, no notification routing -- all of that lives in the chat platform.
- It does NOT add a `chat` value to `sessions.composer_surface`. The session surface is determined by the MCP client (the bot is a service; surface = `passive` per ARCH 5.1 enum). The "chat" experience is captured in this connector matrix row, not in the session schema. (The discipline-tax check rejected adding a new enum value here: it would create ambiguity -- same MCP client could be `web` or `chat` depending on which human entry-point sits in front of it -- without unlocking new behavior.)
- It does NOT change MCP tool semantics. Every tool behaves identically whether called from claude.ai, Claude Code, or a Slack bot.
- It does NOT require a new ADR. Existing ADR-009 (remote-principal composers) + ADR-013 (12 MCP tools) + ADR-024 (transcript sidecar) + ADR-027 (reference stack) already cover the architectural surface.

---

## When to NOT use this pattern

- Single-developer projects with no chat coordination need: just use Claude Code + claude.ai. Don't run a bot.
- Teams whose chat platform is locked down (no bot installs, no outbound webhooks): use the IDE + web clients instead. Atelier doesn't require a chat surface.
- Compliance environments where chat content cannot leave the chat platform's tenant: keep coordination in IDE + web; the bot pattern would require relaying chat content through your bot host, which may violate your data-residency policy.

---

## Reference implementation status

- v1: pattern doc only (this file). Teams can implement their own bot today against the M2 endpoint.
- v1.x M6: reference Slack and Discord bots ship under `apps/reference-bots/` with smoke tests + per-platform runbooks. Until then, the rows in `README.md` for specific chat platforms remain `(not yet authored)` for runbook column.

If you implement a chat bot against the v1 endpoint before M6, the runbook you write to operate it is exactly the kind of community contribution that becomes a per-platform doc (`slack-bot.md`, `discord-bot.md`) in this directory. Open a PR with the runbook + smoke-test evidence per the connectors README "Adding a new client" section.

---

## Cross-references

- ADR-009 -- Remote-principal actor class (the bot service is a remote principal)
- ADR-010 -- Atelier is not a chat app (this pattern integrates; does not build)
- ADR-013 -- 12-tool agent endpoint surface (the protocol the bot speaks)
- ADR-024 -- Agent-session transcripts (`transcript_ref` for chat-thread rationale)
- ADR-027 -- Reference implementation stack
- ADR-028 -- Identity service default Supabase Auth (the bot's OAuth consumer target)
- ADR-038 -- Composer role split into discipline + access_level (the bot's per-human composers)
- ARCH section 7.9 -- Web-surface auth flow (the OAuth flow the bot reuses)
- ARCH section 5.1 -- Sessions schema (`composer_surface = passive` for the bot service)
- ARCH section 6.8 -- Broadcast topology (how the bot subscribes to project events for chat notifications)
- BRD-OPEN-QUESTIONS section 23 -- Lightweight annotations (this pattern subsumes much of the motivation)
- BUILD-SEQUENCE M6 -- where the reference Slack/Discord bot lands
- Strategy addendum 2026-04-28 AI-speed coordination + ACE -- the analysis that motivated this pattern
- [README.md](README.md) -- Connector compatibility matrix (this pattern listed there)
