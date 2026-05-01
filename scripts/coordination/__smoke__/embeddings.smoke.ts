#!/usr/bin/env -S npx tsx
//
// Embedding adapter smoke (M5 / ADR-041).
//
// Validates the EmbeddingService surface contract end-to-end:
//   1. NoopEmbeddingService throws AdapterUnavailableError on embed().
//   2. OpenAICompatibleEmbeddingsService rejects non-positive dimensions
//      via formatModelVersion at construction.
//   3. The adapter speaks the OpenAI /v1/embeddings wire shape against a
//      mocked fetch implementation -- request body, headers, response
//      parsing, dim assertion.
//   4. Adapter fail-closed paths: missing API key throws
//      AdapterUnavailableError at factory time; non-200 responses throw
//      AdapterUnavailableError at embed time.
//   5. Optional live OpenAI call when OPENAI_API_KEY is set in the env
//      (validates ADR-041 default config end-to-end without DB).
//
// Run:
//   npx tsx scripts/coordination/__smoke__/embeddings.smoke.ts
//   # Or, with real OpenAI:
//   OPENAI_API_KEY=sk-... npx tsx scripts/coordination/__smoke__/embeddings.smoke.ts

import {
  AdapterUnavailableError,
  NoopEmbeddingService,
  formatModelVersion,
} from '../lib/embeddings.ts';
import {
  OpenAICompatibleEmbeddingsService,
  createOpenAICompatibleEmbeddingsService,
  openAICompatibleOptionsFromConfig,
} from '../adapters/openai-compatible-embeddings.ts';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

async function expectThrowsAsync<T>(
  fn: () => Promise<T>,
  matcher: (err: unknown) => boolean,
): Promise<{ caught: boolean; err: unknown }> {
  try {
    await fn();
  } catch (err) {
    return { caught: matcher(err), err };
  }
  return { caught: false, err: undefined };
}

function expectThrowsSync(fn: () => void, matcher: (err: unknown) => boolean): { caught: boolean; err: unknown } {
  try {
    fn();
  } catch (err) {
    return { caught: matcher(err), err };
  }
  return { caught: false, err: undefined };
}

async function main(): Promise<void> {
  console.log('\n[1] formatModelVersion + NoopEmbeddingService');
  check(
    'formatModelVersion produces canonical "<provider>/<model>@<dim>"',
    formatModelVersion('openai', 'text-embedding-3-small', 1536) ===
      'openai/text-embedding-3-small@1536',
  );
  const noop = new NoopEmbeddingService({
    dimensions: 1536,
    modelVersion: 'openai/text-embedding-3-small@1536',
  });
  check('Noop modelVersion echoes config', noop.modelVersion() === 'openai/text-embedding-3-small@1536');
  check('Noop dimensions echoes config', noop.dimensions === 1536);
  const noopThrow = await expectThrowsAsync(
    () => noop.embed({ text: 'whatever' }),
    (err) => err instanceof AdapterUnavailableError,
  );
  check('Noop.embed throws AdapterUnavailableError', noopThrow.caught);

  console.log('\n[2] formatModelVersion validation');
  check(
    'formatModelVersion rejects negative dimensions',
    expectThrowsSync(() => formatModelVersion('openai', 'm', -1), (e) => e instanceof Error).caught,
  );
  check(
    'formatModelVersion rejects "/" in provider',
    expectThrowsSync(
      () => formatModelVersion('open/ai', 'm', 1536),
      (e) => e instanceof Error,
    ).caught,
  );

  console.log('\n[3] openAICompatibleOptionsFromConfig fail-closed paths');
  const missingKeyThrow = expectThrowsSync(
    () =>
      openAICompatibleOptionsFromConfig(
        {
          baseUrl: 'https://api.openai.com/v1',
          modelName: 'text-embedding-3-small',
          dimensions: 1536,
          apiKeyEnv: '__ATELIER_DEFINITELY_UNSET_KEY__',
        },
        {} as NodeJS.ProcessEnv,
      ),
    (err) => err instanceof AdapterUnavailableError,
  );
  check('missing API key throws AdapterUnavailableError', missingKeyThrow.caught);

  const badUrlThrow = expectThrowsSync(
    () =>
      openAICompatibleOptionsFromConfig(
        {
          baseUrl: 'not-a-url',
          modelName: 'm',
          dimensions: 1536,
          apiKeyEnv: 'OPENAI_API_KEY',
        },
        { OPENAI_API_KEY: 'key' } as NodeJS.ProcessEnv,
      ),
    (err) => err instanceof Error && /baseUrl/.test((err as Error).message),
  );
  check('non-http baseUrl throws Error', badUrlThrow.caught);

  console.log('\n[4] Adapter wire shape against mocked fetch');
  let capturedRequest: { url?: string; init?: RequestInit } = {};
  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    capturedRequest = { url: typeof input === 'string' ? input : input.toString(), init: init as RequestInit };
    const fakeEmbedding = new Array(1536).fill(0).map((_, i) => (i % 2 === 0 ? 0.001 : -0.001));
    return new Response(
      JSON.stringify({ data: [{ embedding: fakeEmbedding, index: 0 }], model: 'text-embedding-3-small' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const mockedAdapter = new OpenAICompatibleEmbeddingsService({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    modelName: 'text-embedding-3-small',
    dimensions: 1536,
    provider: 'openai',
    fetchImpl: mockFetch,
  });
  const result = await mockedAdapter.embed({ text: 'hello world' });
  check('mocked adapter returned 1536-dim embedding', result.embedding.length === 1536);
  check(
    'mocked adapter stamped modelVersion',
    result.modelVersion === 'openai/text-embedding-3-small@1536',
  );
  check('mocked adapter POSTed', capturedRequest.init?.method === 'POST');
  check(
    'mocked adapter Authorization header set',
    typeof capturedRequest.init?.headers === 'object'
      && (capturedRequest.init.headers as Record<string, string>)['Authorization'] === 'Bearer sk-test',
  );
  check(
    'mocked adapter body carries input + model',
    typeof capturedRequest.init?.body === 'string'
      && capturedRequest.init.body.includes('"input":"hello world"')
      && capturedRequest.init.body.includes('"model":"text-embedding-3-small"'),
  );
  check(
    'mocked adapter URL appended /embeddings',
    capturedRequest.url === 'https://api.openai.com/v1/embeddings',
  );

  console.log('\n[5] Adapter dim mismatch fails closed');
  const dimMismatchFetch: typeof globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ data: [{ embedding: new Array(768).fill(0.1), index: 0 }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  const dimMismatchAdapter = new OpenAICompatibleEmbeddingsService({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    modelName: 'text-embedding-3-small',
    dimensions: 1536,
    provider: 'openai',
    fetchImpl: dimMismatchFetch,
  });
  const dimMismatchThrow = await expectThrowsAsync(
    () => dimMismatchAdapter.embed({ text: 'x' }),
    (err) => err instanceof Error && /dimension mismatch/i.test((err as Error).message),
  );
  check('dim mismatch throws (fails closed; not a silent zero-match)', dimMismatchThrow.caught);

  console.log('\n[6] Adapter HTTP non-200 fails closed');
  const errorFetch: typeof globalThis.fetch = async () =>
    new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });
  const erroringAdapter = new OpenAICompatibleEmbeddingsService({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    modelName: 'text-embedding-3-small',
    dimensions: 1536,
    provider: 'openai',
    fetchImpl: errorFetch,
  });
  const errorThrow = await expectThrowsAsync(
    () => erroringAdapter.embed({ text: 'x' }),
    (err) => err instanceof AdapterUnavailableError,
  );
  check('429 maps to AdapterUnavailableError', errorThrow.caught);

  console.log('\n[7] createOpenAICompatibleEmbeddingsService factory');
  const factoryThrow = expectThrowsSync(
    () =>
      createOpenAICompatibleEmbeddingsService(
        {
          baseUrl: 'https://api.openai.com/v1',
          modelName: 'text-embedding-3-small',
          dimensions: 1536,
          apiKeyEnv: '__ATELIER_DEFINITELY_UNSET_KEY__',
        },
        {} as NodeJS.ProcessEnv,
      ),
    (err) => err instanceof AdapterUnavailableError,
  );
  check('factory propagates AdapterUnavailableError on missing key', factoryThrow.caught);

  console.log('\n[8] Optional live OpenAI call (gated on OPENAI_API_KEY)');
  if (process.env['OPENAI_API_KEY']) {
    try {
      const liveAdapter = createOpenAICompatibleEmbeddingsService({
        baseUrl: 'https://api.openai.com/v1',
        modelName: 'text-embedding-3-small',
        dimensions: 1536,
        apiKeyEnv: 'OPENAI_API_KEY',
      });
      const liveResult = await liveAdapter.embed({
        text: 'Atelier find_similar M5 smoke check.',
      });
      check(
        'live OpenAI returned 1536-dim embedding',
        liveResult.embedding.length === 1536,
      );
      check(
        'live OpenAI stamped modelVersion',
        liveResult.modelVersion === 'openai/text-embedding-3-small@1536',
      );
    } catch (err) {
      check(
        'live OpenAI call succeeded',
        false,
        `${(err as Error).message}`,
      );
    }
  } else {
    console.log('  SKIP  live OpenAI call (set OPENAI_API_KEY to enable)');
  }

  if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
