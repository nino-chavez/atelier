---
id: ADR-041
trace_id: BRD:Epic-6
category: architecture
session: m5-entry-strategic-call-2026-05-01
composer: nino-chavez
timestamp: 2026-05-01T00:00:00Z
---

# Embedding model default: OpenAI-compatible adapter, OpenAI text-embedding-3-small (1536-dim) at v1

**Summary.** `find_similar` ships with a single named adapter that speaks the OpenAI `/embeddings` API contract. The v1 default config points the adapter at OpenAI with `text-embedding-3-small` (1536-dimension output). The pgvector column type is `vector(1536)` accordingly. Adopters swap providers (Voyage, Cohere, vLLM, Ollama, LM Studio) by overriding two env vars (`embeddings.base_url`, `embeddings.model_name`); the adapter code does not change. Resolves BRD-OPEN-QUESTIONS section 3 and D24 (`PRD-COMPANION`).

**Rationale.**

The choice has three independent dimensions: which adapter shape, which provider, which model. ADR-029 (named-adapter pattern + GCP-portability) already commits to "swappable per deploy"; this ADR resolves what `atelier init` wires up by default.

**Why an OpenAI-compatible adapter (not a provider-specific adapter).** The OpenAI `/embeddings` API contract is a de-facto industry standard. Voyage, vLLM, Ollama, LM Studio, LocalAI, and most self-hosted runtimes already speak it. A single adapter that takes `base_url + api_key + model_name` covers all real-world cases at v1 with no per-provider code. Adding a provider-specific adapter only becomes necessary if a target provider speaks something incompatible (e.g. Voyage's native API, which has minor shape differences but is also exposed via an OpenAI-compatible endpoint). Defaulting to the compatible interface keeps the substrate generic; provider-specific adapters land later as needed.

**Why OpenAI text-embedding-3-small as the default provider+model.** Three lenses converged:

1. **Lowest real-world setup tax that produces non-trivial results.** "Set `OPENAI_API_KEY` in the deploy env" is the lowest setup floor that clears ADR-006's 75% precision @ 60% recall gate against a typical decisions corpus. Most adopting teams already hold an OpenAI key; the ones who don't can get one in 60 seconds. Self-hosted (Transformers.js, vLLM) is technically zero-API-cost but requires a worker home (Cloud Run, Supabase Edge Function, Vercel sidecar) -- that's more setup tax than "paste an API key", not less.

2. **AI-speed pivot lens.** Embedding models will be eclipsed in 12 months. The interface is what matters; the default is convenience, not lock-in. ADR-029's named-adapter contract handles swap. Don't over-invest in the choice -- invest in the boundary.

3. **Discipline-tax lens.** A default that requires no setup beats a default that requires an API key beats a default that requires standing up infrastructure. But the gap between "no setup at runtime, heavy setup at deploy" (self-hosted) and "one env var" (API-key) is smaller than it looks. Picking the smaller-vendor option (Voyage `voyage-3-lite`) for ~5% MTEB-retrieval lead trades more friction for marginal quality at v1.

**Why 1536 dimensions.** `text-embedding-3-small` outputs 1536-dim vectors natively. pgvector requires fixed-dim columns; 1536 is a known-good default for HNSW indexing. text-embedding-3-large (3072-dim) is overkill for the corpus sizes Atelier projects produce. Adopters who swap to a model with a different native dimension trigger the schema-migration concern documented in BRD-OPEN-QUESTIONS section 25 (filed alongside this ADR as event-triggered).

**Why hybrid (vector + BM25) is NOT pre-decided here.** The 2026-04-28 expert review recommended hybrid-as-fallback for cases where the embedding alone underperforms ADR-006's gate. That recommendation lands at M5 alongside the eval harness, because the trigger condition ("embedding alone scores under 70% precision") is empirical -- you measure first, decide hybrid second. The existing `degraded=true` semantics on the `find_similar` response already supports it as a v1.x extension if the M5 eval data warrants. This ADR scopes itself to the model+dimension; the hybrid question is M5's deliverable.

**Decision.**

The reference implementation ships:

1. **A single named embedding adapter** at `scripts/coordination/adapters/openai-compatible-embeddings.ts` (location TBD; ARCH-bound). Speaks the OpenAI `/v1/embeddings` API contract. Takes `(base_url, api_key, model_name)` at construction; exposes `embed(text: string): Promise<number[]>`. No provider-specific code.

2. **A `BroadcastService`-shaped capability interface** at `scripts/coordination/lib/embeddings.ts` (mirrors the M4 broadcast pattern): `EmbeddingService` interface with `embed`, plus `NoopEmbeddingService` fallback for tests + degraded-mode operation.

3. **Default config in `.atelier/config.yaml`:**
   ```yaml
   find_similar:
     embeddings:
       adapter: openai-compatible
       base_url: "https://api.openai.com/v1"
       model_name: "text-embedding-3-small"
       dimensions: 1536
       api_key_env: OPENAI_API_KEY
     default_threshold: 0.80
     weak_suggestion_threshold: 0.65
     eval_set_path: "atelier/eval/find_similar"
     ci_precision_gate: 0.75
     ci_recall_gate: 0.60
   ```
   The `find_similar:` block name supersedes the legacy `fit_check:` block (rename happens in this same change set; matches the project-wide `fit_check`→`find_similar` rename per commit `7713913`).

4. **pgvector schema in M5's first migration:** `embedding vector(1536)`. Migration file lands at M5 entry; this ADR commits the dimension choice for that migration.

5. **The ARCH §6.4.2 swappability procedure stands as documented** -- `embedding_model_version` per row, `atelier eval find_similar --rebuild-index` as the swap operation, 30-day grace period for old-version rows. The only addition: §6.4.2 now names the v1 default model so the rebuild procedure has a concrete starting state.

**Consequences.**

- **Adopters get a working find_similar with one env var (`OPENAI_API_KEY`).** No infrastructure provisioning, no model-download friction, no second-vendor account.
- **Adopters who can't egress data to OpenAI swap two env vars** (`embeddings.base_url`, `embeddings.api_key_env`) and point at vLLM / Ollama / LocalAI / a self-hosted Voyage proxy. The adapter code path is identical.
- **Adopters who want hybrid retrieval get it at M5+** if the eval harness data shows the vector-only path falls short of the ADR-006 gate. The decision to ship hybrid (as default or as fallback) lives outside this ADR.
- **OpenAI as a SaaS dependency is a default, not a lock-in.** ADR-007 (no multi-tenant SaaS) governs Atelier itself, not what Atelier's default integrations point at -- the same logic that lets Supabase be the default datastore (ADR-027) while ADR-029 keeps the swap path open applies here.
- **Cost:** typical Atelier project's full corpus (decisions + contributions + BRD/PRD sections + research) is ~100K-500K tokens; embedding the full corpus once costs ~$0.002-$0.010 against `text-embedding-3-small`'s $0.02/M-token rate. Per-query cost is negligible. Cost is not a load-bearing factor in this ADR.

**Trade-offs considered and rejected.**

| Option | Why rejected |
|---|---|
| **Self-hosted (Transformers.js + nomic-embed-text-v1.5) as default** | "No setup at runtime" is misleading -- requires standing up a worker (Cloud Run, Edge Function, sidecar). Cold-start latency, ~1-2 GB RAM footprint, ~250 MB model download per warm container. Higher real-world setup tax than "paste an API key". MTEB benchmarks comparable to text-embedding-3-small, so quality argument is neutral. Lands later as a peer adapter if a contributor needs it. |
| **Voyage voyage-3-lite as default** | Top of MTEB retrieval but smaller vendor (higher business-continuity risk for an OSS template default). Quality lead over text-embedding-3-small is real but small (~5% on retrieval tasks); both clear ADR-006's 75/60 gate comfortably. Picking the less-known vendor for an OSS template's default adds adopter friction without proportional gain. Adopters who want it: change two env vars, done. |
| **No default; require explicit adapter config** | Defers the call to every adopter -- discipline-tax with no proportional benefit. Makes `atelier init` produce a half-configured project. The named-adapter pattern already makes the swap easy; defaulting it doesn't constrain anyone. |
| **Provider-specific adapter (OpenAI-only, with Voyage adapter as separate file later)** | Adds per-provider code with no benefit at v1. The OpenAI-compatible interface covers OpenAI, Voyage (via their compat endpoint), vLLM, Ollama, LM Studio, LocalAI -- writing a per-provider adapter buys nothing the generic adapter can't already do. Lands later only if a target provider speaks something incompatible. |
| **Pre-decide hybrid retrieval (vector + BM25) as v1 default** | The trigger condition for hybrid (embedding alone scores under 70% precision) is empirical -- you measure first. Pre-deciding without M5 eval data is over-investment in a hedge. Existing `degraded=true` semantics already support hybrid-as-fallback; the M5 eval harness will tell us whether to elevate it to default. |

**Reverse / revisit conditions.**

- M5 eval against ADR-006's 75/60 gate scores under 70% precision -> file follow-up ADR adopting hybrid retrieval as default; this ADR remains valid for the model choice.
- A contributor lands a Transformers.js self-hosted adapter with measured setup-tax data showing it's competitive with the API-key path -> file follow-up ADR considering a different default; this ADR stays for the API-key path.
- OpenAI deprecates `text-embedding-3-small` (no current signal) -> file follow-up ADR naming the replacement model (likely `text-embedding-3-medium` or successor); 1536-dim choice may stay or migrate per BRD-OPEN-QUESTIONS section 25.
