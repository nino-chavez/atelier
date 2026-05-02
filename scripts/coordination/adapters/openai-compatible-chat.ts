// OpenAI-compatible chat-completions adapter.
//
// Sibling to openai-compatible-embeddings.ts (ADR-029 + ADR-041). The
// embeddings adapter handles the find_similar substrate's vector path;
// this adapter handles structured-output classification for the M6
// triage substrate (per ADR-018).
//
// Per ADR-029 the reference impl preserves provider-portability and
// provider-specific code stays in NAMED ADAPTER MODULES. This file is
// the only place the triage substrate issues HTTP against a chat-
// completion provider. Swapping providers (Anthropic Messages API,
// Cohere, custom) means writing a sibling adapter, not editing
// llm-classifier.ts.
//
// Per ADR-041 the OpenAI-compatible adapter shape covers the realistic
// v1 surface: OpenAI itself, vLLM, Ollama, LocalAI, Together, etc.
// Adopters using a non-compat provider (e.g., Anthropic Messages
// directly) write a new adapter file; this one stays untouched.
//
// Implementation notes:
//   - Minimal wire shape: messages + model + optional response_format.
//     Streaming is NOT supported at v1 (triage classification needs
//     the full response before deciding routing); add when a streaming
//     consumer surfaces.
//   - No retry / backoff at v1. The classifier is invoked from the
//     route-proposal flow which already has its own retry semantics
//     (manual re-run on failure). v1.x can add adapter-level retry
//     behind a measurable trigger.
//   - Fail-closed on missing API key. Same pattern as embeddings:
//     AdapterUnavailableError. The route-proposal handler decides
//     whether to fall back to the heuristic classifier or surface the
//     error to the operator.

import {
  AdapterUnavailableError,
} from '../lib/embeddings.ts';

// ===========================================================================
// Public types
// ===========================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  /**
   * When set, the provider returns JSON parseable as the supplied
   * shape. OpenAI supports `{ type: 'json_object' }` and
   * `{ type: 'json_schema', json_schema: {...} }`. For local-bootstrap
   * v1 we use the simpler `json_object` and parse + validate the body
   * client-side; structured-output schemas can come at v1.x.
   */
  responseFormat?: 'json_object' | undefined;
  /** Provider-specific: 0..2 typically; default model dependent. */
  temperature?: number;
  /** Optional ceiling on output tokens. */
  maxTokens?: number;
}

export interface ChatCompletionResponse {
  /** The assistant message content (the only field downstream cares about at v1). */
  content: string;
  /** Model that produced the response (echoed back from the API). */
  model: string;
  /** Token usage (when the provider reports it; some self-hosted don't). */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ChatService {
  readonly name: string;
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  close(): Promise<void>;
}

// ===========================================================================
// Configuration
// ===========================================================================

export interface OpenAICompatibleChatOptions {
  /**
   * Base URL for the provider's `/v1/chat/completions` endpoint, WITHOUT
   * the `/chat/completions` suffix. Per .atelier/config.yaml:
   *   "https://api.openai.com/v1"      (default)
   *   "http://localhost:11434/v1"      (Ollama)
   *   "http://localhost:1234/v1"       (LM Studio)
   *   "https://api.together.xyz/v1"    (Together)
   */
  baseUrl: string;
  /** Bearer token. Self-hosted providers may accept any non-empty value. */
  apiKey: string;
  /** e.g. "gpt-4o-mini" (OpenAI), "llama3.3" (Ollama). */
  modelName: string;
  /** Provider tag for tracing + logging. e.g. "openai", "ollama". */
  provider: string;
  fetchImpl?: typeof globalThis.fetch;
  /** Default 30s. Per-call ceiling prevents hung requests. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function openAICompatibleChatOptionsFromConfig(
  config: {
    baseUrl: string;
    modelName: string;
    apiKeyEnv: string;
    provider?: string;
    fetchImpl?: typeof globalThis.fetch;
    timeoutMs?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
): OpenAICompatibleChatOptions {
  if (!config.baseUrl || !/^https?:\/\//.test(config.baseUrl)) {
    throw new Error(
      `openAICompatibleChatOptionsFromConfig: baseUrl must be an http(s) URL: ${config.baseUrl}`,
    );
  }
  if (!config.modelName) {
    throw new Error('openAICompatibleChatOptionsFromConfig: modelName is required');
  }
  if (!config.apiKeyEnv) {
    throw new Error('openAICompatibleChatOptionsFromConfig: apiKeyEnv is required');
  }
  const apiKey = env[config.apiKeyEnv];
  if (!apiKey) {
    throw new AdapterUnavailableError(
      `${config.apiKeyEnv} not set; OpenAI-compatible chat adapter requires an API key. Set ${config.apiKeyEnv}=<key> in the deploy env, or fall back to the heuristic classifier.`,
    );
  }
  return {
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
    apiKey,
    modelName: config.modelName,
    provider: config.provider ?? inferProviderFromBaseUrl(config.baseUrl),
    ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  };
}

function inferProviderFromBaseUrl(baseUrl: string): string {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('api.openai.com')) return 'openai';
  if (lower.includes('localhost:11434')) return 'ollama';
  if (lower.includes('localhost:1234')) return 'lmstudio';
  if (lower.includes('api.together.xyz')) return 'together';
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) return 'self-hosted';
  return 'openai-compatible';
}

// ===========================================================================
// Adapter
// ===========================================================================

interface OpenAIChatCompletionResponse {
  choices: Array<{
    message: { role: 'assistant'; content: string };
    finish_reason: string;
  }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class OpenAICompatibleChatService implements ChatService {
  readonly name: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatibleChatOptions) {
    this.name = `${options.provider}/${options.modelName}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (req.messages.length === 0) {
      throw new Error('OpenAICompatibleChatService.complete: messages must be non-empty');
    }

    const url = `${this.options.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const body: Record<string, unknown> = {
      model: this.options.modelName,
      messages: req.messages,
    };
    if (req.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AdapterUnavailableError(
        `OpenAI-compatible chat request failed (${this.options.provider} @ ${url}): ${reason}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errBody = await safeReadBody(response);
      throw new AdapterUnavailableError(
        `OpenAI-compatible chat returned ${response.status} ${response.statusText} from ${url}: ${errBody}`,
      );
    }

    let payload: OpenAIChatCompletionResponse;
    try {
      payload = (await response.json()) as OpenAIChatCompletionResponse;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AdapterUnavailableError(
        `OpenAI-compatible chat returned non-JSON body from ${url}: ${reason}`,
      );
    }

    const first = payload.choices?.[0];
    if (!first?.message?.content) {
      throw new AdapterUnavailableError(
        `OpenAI-compatible chat response missing choices[0].message.content from ${url}`,
      );
    }

    return {
      content: first.message.content,
      model: payload.model,
      ...(payload.usage !== undefined ? { usage: payload.usage } : {}),
    };
  }

  async close(): Promise<void> {
    // No-op; no pooled state.
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return '<unreadable body>';
  }
}

export function createOpenAICompatibleChatService(
  config: {
    baseUrl: string;
    modelName: string;
    apiKeyEnv: string;
    provider?: string;
    fetchImpl?: typeof globalThis.fetch;
    timeoutMs?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
): ChatService {
  const opts = openAICompatibleChatOptionsFromConfig(config, env);
  return new OpenAICompatibleChatService(opts);
}
