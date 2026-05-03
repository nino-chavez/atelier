// Smoke for reranker interface + cohere-compatible adapter (C3 — ADR-047).
//
// Exercises:
//   1. Interface contract: RerankRequest / RerankResult shape; empty
//      input returns empty output.
//   2. Cohere-compatible adapter: factory validates URL/model/key; throws
//      RerankerUnavailableError on missing key.
//   3. End-to-end against a mock HTTP server: provider returns sorted
//      results, adapter maps indices back to caller IDs, includes
//      priorScore in output when provided.
//   4. Failure modes: non-200 response → RerankerUnavailableError;
//      malformed response → RerankerUnavailableError.
//
// Run: `npm run smoke:reranker`

import { createServer } from 'node:http';
import {
  createCohereCompatibleRerankService,
  cohereCompatibleRerankOptionsFromConfig,
  createCohereCompatibleRerankServiceFromConfig,
} from '../adapters/cohere-compatible-rerank.ts';
import { RerankerUnavailableError } from '../lib/reranker.ts';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const status = ok ? 'PASS' : 'FAIL';
  const suffix = detail ? `  -- ${detail}` : '';
  console.log(`  ${status}  ${label}${suffix}`);
  if (!ok) failures += 1;
}

async function testEmptyInput(): Promise<void> {
  console.log('# 1. Interface contract: empty input');
  const svc = createCohereCompatibleRerankService({
    baseUrl: 'http://127.0.0.1:1', // never reached for empty input
    apiKey: 'fake',
    modelName: 'fake-model',
  });
  const out = await svc.rerank({ query: 'test', documents: [] });
  check('empty documents → empty results', out.length === 0, `got ${out.length}`);
  await svc.close();
}

async function testFactoryValidation(): Promise<void> {
  console.log('# 2. Factory validation');

  // Missing key → RerankerUnavailableError
  const oldKey = process.env.COHERE_API_KEY;
  delete process.env.COHERE_API_KEY;
  try {
    let threw = false;
    let errKind = 'none';
    try {
      cohereCompatibleRerankOptionsFromConfig({
        baseUrl: 'https://api.cohere.ai/v1',
        modelName: 'rerank-english-v3.0',
        apiKeyEnv: 'COHERE_API_KEY',
      });
    } catch (err) {
      threw = true;
      errKind = err instanceof RerankerUnavailableError ? 'RerankerUnavailableError' : 'other';
    }
    check(
      'missing key → throws RerankerUnavailableError',
      threw && errKind === 'RerankerUnavailableError',
      `threw=${threw} kind=${errKind}`,
    );
  } finally {
    if (oldKey !== undefined) process.env.COHERE_API_KEY = oldKey;
  }

  // Invalid URL → throws plain Error (not RerankerUnavailableError; that's
  // for runtime adapter unavailability, not config-time validation)
  let threw = false;
  try {
    cohereCompatibleRerankOptionsFromConfig({
      baseUrl: 'not-a-url',
      modelName: 'rerank-english-v3.0',
      apiKeyEnv: 'COHERE_API_KEY',
    });
  } catch {
    threw = true;
  }
  check('invalid URL → throws', threw);

  // Missing model → throws
  threw = false;
  try {
    cohereCompatibleRerankOptionsFromConfig({
      baseUrl: 'https://api.cohere.ai/v1',
      modelName: '',
      apiKeyEnv: 'COHERE_API_KEY',
    });
  } catch {
    threw = true;
  }
  check('missing modelName → throws', threw);
}

async function testEndToEndMockServer(): Promise<void> {
  console.log('# 3. End-to-end against mock provider');

  // Mock provider that returns Cohere-shaped results
  let captured: {
    method: string | undefined;
    body: { model?: string; query?: string; documents?: string[]; top_n?: number } | undefined;
  } = { method: undefined, body: undefined };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        captured = { method: req.method, body: JSON.parse(body) };
      } catch {
        captured = { method: req.method, body: undefined };
      }
      // Return Cohere-shaped response: documents at indices 2, 0, 1 in
      // descending relevance.
      const responseBody = {
        results: [
          { index: 2, relevance_score: 0.92 },
          { index: 0, relevance_score: 0.71 },
          { index: 1, relevance_score: 0.34 },
        ],
        meta: { billed_units: { rerank_units: 1 } },
      };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(responseBody));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const svc = createCohereCompatibleRerankService({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test-key',
      modelName: 'test-rerank-model',
    });

    const results = await svc.rerank({
      query: 'authentication',
      documents: [
        { id: 'doc-A', text: 'an unrelated document' },
        { id: 'doc-B', text: 'something about caching', priorScore: 0.5 },
        { id: 'doc-C', text: 'a document about authentication' },
      ],
    });

    check('captured request was POST', captured.method === 'POST');
    check(
      'captured query in body',
      captured.body?.query === 'authentication',
      `got ${captured.body?.query}`,
    );
    check(
      'captured 3 documents in body',
      captured.body?.documents?.length === 3,
      `got ${captured.body?.documents?.length}`,
    );
    check(
      'returned 3 results in provider order (most relevant first)',
      results.length === 3 && results[0]?.id === 'doc-C' && results[1]?.id === 'doc-A' && results[2]?.id === 'doc-B',
      `got ${results.map((r) => r.id).join(',')}`,
    );
    check(
      'top result has score 0.92',
      results[0]?.score === 0.92,
      `got ${results[0]?.score}`,
    );
    check(
      'priorScore preserved on doc-B (now in position 3)',
      results[2]?.priorScore === 0.5,
      `got ${results[2]?.priorScore}`,
    );

    await svc.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testFailureModes(): Promise<void> {
  console.log('# 4. Failure modes');

  // 500 response
  const errorServer = createServer((_req, res) => {
    res.statusCode = 500;
    res.end('upstream error');
  });
  await new Promise<void>((resolve) => errorServer.listen(0, '127.0.0.1', resolve));
  const errorPort = (errorServer.address() as { port: number }).port;
  try {
    const svc = createCohereCompatibleRerankService({
      baseUrl: `http://127.0.0.1:${errorPort}`,
      apiKey: 'fake',
      modelName: 'rerank-test',
    });
    let threw = false;
    let errKind = 'none';
    try {
      await svc.rerank({
        query: 'x',
        documents: [{ id: 'a', text: 'test' }],
      });
    } catch (err) {
      threw = true;
      errKind = err instanceof RerankerUnavailableError ? 'RerankerUnavailableError' : 'other';
    }
    check(
      '500 response → RerankerUnavailableError',
      threw && errKind === 'RerankerUnavailableError',
      `threw=${threw} kind=${errKind}`,
    );
    await svc.close();
  } finally {
    await new Promise<void>((resolve) => errorServer.close(() => resolve()));
  }

  // Malformed JSON response
  const badServer = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end('not json at all');
  });
  await new Promise<void>((resolve) => badServer.listen(0, '127.0.0.1', resolve));
  const badPort = (badServer.address() as { port: number }).port;
  try {
    const svc = createCohereCompatibleRerankService({
      baseUrl: `http://127.0.0.1:${badPort}`,
      apiKey: 'fake',
      modelName: 'rerank-test',
    });
    let threw = false;
    try {
      await svc.rerank({
        query: 'x',
        documents: [{ id: 'a', text: 'test' }],
      });
    } catch (err) {
      threw = err instanceof RerankerUnavailableError;
    }
    check('malformed JSON → RerankerUnavailableError', threw);
    await svc.close();
  } finally {
    await new Promise<void>((resolve) => badServer.close(() => resolve()));
  }

  // Test the from-config factory propagates RerankerUnavailableError
  const oldKey = process.env.COHERE_API_KEY;
  delete process.env.COHERE_API_KEY;
  try {
    let threw = false;
    try {
      createCohereCompatibleRerankServiceFromConfig({
        baseUrl: 'https://api.cohere.ai/v1',
        modelName: 'rerank-english-v3.0',
        apiKeyEnv: 'COHERE_API_KEY',
      });
    } catch (err) {
      threw = err instanceof RerankerUnavailableError;
    }
    check('factory with missing key → RerankerUnavailableError', threw);
  } finally {
    if (oldKey !== undefined) process.env.COHERE_API_KEY = oldKey;
  }
}

async function main(): Promise<void> {
  await testEmptyInput();
  await testFactoryValidation();
  await testEndToEndMockServer();
  await testFailureModes();

  console.log('');
  if (failures === 0) {
    console.log('reranker smoke: PASS');
    process.exit(0);
  }
  console.log(`reranker smoke: FAIL (${failures} failures)`);
  process.exit(1);
}

main().catch((err) => {
  console.error('reranker smoke: fatal:', err);
  process.exit(1);
});
