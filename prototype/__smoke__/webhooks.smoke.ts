// S12 webhook receiver smoke — covers the four conformance points the
// audit's S12 finding named: malformed-signature rejection, missing-
// secret fail-closed, valid-signature acceptance, double-delivery
// idempotency.
//
// Exercises the GitHub handler shape directly (Figma uses the identical
// pattern with a different signature prefix; one shape covered = both
// shapes covered for the verifier + idempotency dimensions).
//
// Prerequisites:
//   - Local Supabase running (supabase start) so webhook_deliveries exists
//   - POSTGRES_URL set to the local pooler URL
//   - GITHUB_WEBHOOK_SECRET set to a known test value
//
// Run: `npx tsx prototype/__smoke__/webhooks.smoke.ts`
//
// The smoke does NOT spin up Next.js; it imports the route handler's
// POST function directly and exercises it with synthetic Request objects.
// This is the smoke equivalent of "test the function pure-style" — the
// route adapter is a one-line export, so testing the function gets the
// load-bearing logic without the Next.js cold-compile cost.

import { createHmac, randomUUID } from 'node:crypto';

import { POST as githubPOST } from '../src/app/api/webhooks/github/route.ts';
import { __closePoolForTesting } from '../src/lib/atelier/webhooks/idempotency.ts';

const TEST_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? 'smoke-test-secret-do-not-use-in-prod';
process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function signGithub(body: string): string {
  return 'sha256=' + createHmac('sha256', TEST_SECRET).update(body, 'utf8').digest('hex');
}

function makeRequest(opts: {
  body: string;
  signature?: string | null;
  deliveryId?: string | null;
  eventType?: string;
}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.signature !== null && opts.signature !== undefined) {
    headers.set('x-hub-signature-256', opts.signature);
  }
  if (opts.deliveryId !== null && opts.deliveryId !== undefined) {
    headers.set('x-github-delivery', opts.deliveryId);
  }
  if (opts.eventType) {
    headers.set('x-github-event', opts.eventType);
  }
  return new Request('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers,
    body: opts.body,
  });
}

async function run() {
  // ---- 1. Missing X-Hub-Signature-256 -> 401 ----
  {
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const res = await githubPOST(
      makeRequest({ body, signature: null, deliveryId: randomUUID(), eventType: 'push' }),
    );
    check('missing_signature returns 401', res.status === 401, `got ${res.status}`);
  }

  // ---- 2. Missing X-GitHub-Delivery -> 400 ----
  {
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const res = await githubPOST(
      makeRequest({ body, signature: signGithub(body), deliveryId: null, eventType: 'push' }),
    );
    check('missing_delivery_id returns 400', res.status === 400, `got ${res.status}`);
  }

  // ---- 3. Malformed signature (wrong hex) -> 401 ----
  {
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const res = await githubPOST(
      makeRequest({
        body,
        signature: 'sha256=' + 'f'.repeat(64),
        deliveryId: randomUUID(),
        eventType: 'push',
      }),
    );
    check('invalid_signature returns 401', res.status === 401, `got ${res.status}`);
  }

  // ---- 4. Wrong-prefix signature -> 401 ----
  {
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const sig = signGithub(body).replace('sha256=', 'sha1=');
    const res = await githubPOST(
      makeRequest({ body, signature: sig, deliveryId: randomUUID(), eventType: 'push' }),
    );
    check('wrong_prefix_signature returns 401', res.status === 401, `got ${res.status}`);
  }

  // ---- 5. Valid signature, first delivery -> 200 + ok=true (NOT idempotent) ----
  const idempotencyDeliveryId = `smoke-${randomUUID()}`;
  {
    const body = JSON.stringify({ ref: 'refs/heads/main', smoke: idempotencyDeliveryId });
    const res = await githubPOST(
      makeRequest({
        body,
        signature: signGithub(body),
        deliveryId: idempotencyDeliveryId,
        eventType: 'push',
      }),
    );
    const data = (await res.json()) as { ok?: boolean; idempotent?: boolean; deliveryId?: string };
    check('valid_first_delivery returns 200', res.status === 200, `got ${res.status}`);
    check('valid_first_delivery ok=true', data.ok === true);
    check('valid_first_delivery NOT idempotent', data.idempotent !== true);
  }

  // ---- 6. Same delivery_id again -> 200 + idempotent=true ----
  {
    const body = JSON.stringify({ ref: 'refs/heads/main', smoke: idempotencyDeliveryId });
    const res = await githubPOST(
      makeRequest({
        body,
        signature: signGithub(body),
        deliveryId: idempotencyDeliveryId,
        eventType: 'push',
      }),
    );
    const data = (await res.json()) as { ok?: boolean; idempotent?: boolean };
    check('duplicate_delivery returns 200', res.status === 200, `got ${res.status}`);
    check('duplicate_delivery idempotent=true', data.idempotent === true);
  }

  // ---- 7. Missing secret env -> fail-closed 500 ----
  {
    const savedSecret = process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    try {
      const body = JSON.stringify({ ref: 'refs/heads/main' });
      const res = await githubPOST(
        makeRequest({
          body,
          signature: signGithub(body),
          deliveryId: randomUUID(),
          eventType: 'push',
        }),
      );
      check('missing_secret returns 500', res.status === 500, `got ${res.status}`);
    } finally {
      process.env.GITHUB_WEBHOOK_SECRET = savedSecret;
    }
  }

  // ---- 8. GET -> 405 ----
  {
    const { GET } = await import('../src/app/api/webhooks/github/route.ts');
    const res = await GET();
    check('get_method returns 405', res.status === 405, `got ${res.status}`);
  }

  await __closePoolForTesting();

  if (failures > 0) {
    console.error(`\n${failures} smoke check(s) FAILED`);
    process.exit(1);
  } else {
    console.log('\nAll webhook smoke checks PASSED');
  }
}

run().catch((err) => {
  console.error('smoke run threw:', err);
  process.exit(1);
});
