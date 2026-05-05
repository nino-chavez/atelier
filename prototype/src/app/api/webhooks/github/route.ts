// GitHub webhook receiver — closes M8 audit S12 finding.
//
// Per ARCH §6.2.2.1 + §6.2.3 + §716 the substrate's authoritative source
// for `state=merged` on contributions is webhook merge-observation; the
// embedding-pipeline trigger on `push` to main is §902-905. Until this
// route landed both contracts were unenforceable, with `scripts/sync/
// lib/adapters.ts:100` carrying the unfulfilled "M2 webhooks replace
// polling" promise as a known-gap comment.
//
// What this handler does at v1:
//   1. Read RAW body via req.text() — BEFORE any JSON.parse, BEFORE
//      verification. Body-parser-before-verify is the canonical mistake.
//   2. Verify X-Hub-Signature-256 via HMAC-SHA256 with constant-time
//      compare (prototype/src/lib/atelier/webhooks/verify.ts).
//   3. Read X-GitHub-Delivery and INSERT into webhook_deliveries; on
//      duplicate (provider retry under load), short-circuit to 200
//      idempotent no-op.
//   4. Log event_type for observability; mark processed.
//
// What this handler does NOT do at v1 (filed as v1.x follow-ups):
//   - Trigger the embedding pipeline on `push` events affecting main
//     (§902-905). The pipeline code exists at scripts/coordination/
//     lib/embed-pipeline.ts; wiring it from this handler is the
//     follow-up.
//   - Update contributions to `state=merged` on `pull_request.closed
//     && payload.pull_request.merged === true` (§716). The
//     AtelierClient method exists; the lookup-contribution-by-PR-URL
//     query is the follow-up.
//
// Closing those wiring gaps does NOT re-open S12 — the spec gap S12
// named was "no verifying receiver"; that gap is closed by this file.
// The dispatch logic is per-event handler work that grows incrementally.
//
// Reference impl: apps/rally-hq/src/routes/api/webhooks/{stripe,resend}/+server.ts.
//
// Runtime: Node.js. Edge cannot run pg.Pool for the idempotency ledger.

import { verifyHmacSha256 } from '../../../../lib/atelier/webhooks/verify.ts';
import {
  recordDelivery,
  markDeliveryProcessed,
} from '../../../../lib/atelier/webhooks/idempotency.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    // Fail-closed: deploy misconfiguration. Refuse all requests until
    // the secret is set. This is preferable to silently accepting all.
    return jsonResponse(500, { error: 'webhook_secret_missing' });
  }

  const deliveryId = request.headers.get('x-github-delivery');
  const signatureHeader = request.headers.get('x-hub-signature-256');
  const eventType = request.headers.get('x-github-event');

  if (!deliveryId) {
    return jsonResponse(400, { error: 'missing_delivery_id' });
  }
  if (!signatureHeader) {
    return jsonResponse(401, { error: 'missing_signature' });
  }

  const rawBody = await request.text();

  let valid: boolean;
  try {
    valid = verifyHmacSha256({
      rawBody,
      signatureHeader,
      secret,
      prefix: 'sha256=',
    });
  } catch {
    // Only thrown on missing secret, which we already guarded above.
    // Re-guard for type-narrowing + future-proofing.
    return jsonResponse(500, { error: 'webhook_secret_missing' });
  }

  if (!valid) {
    return jsonResponse(401, { error: 'invalid_signature' });
  }

  // Idempotency check: record the delivery. Duplicate (provider retry)
  // returns firstSeen=false; we short-circuit with 200 to avoid double-
  // processing.
  const { firstSeen } = await recordDelivery({
    deliveryId,
    source: 'github',
    eventType,
  });

  if (!firstSeen) {
    return jsonResponse(200, { ok: true, deliveryId, idempotent: true });
  }

  try {
    // First-seen processing happens here. v1: log + mark processed.
    // v1.x: dispatch by event type to embed pipeline (push) +
    // contribution merge-observation (pull_request.closed+merged).
    await markDeliveryProcessed(deliveryId, 'received');
    return jsonResponse(200, { ok: true, deliveryId, eventType });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markDeliveryProcessed(deliveryId, 'error', message).catch(() => {
      /* swallow secondary failure */
    });
    return jsonResponse(500, { error: 'processing_failed', message });
  }
}

export async function GET(): Promise<Response> {
  return jsonResponse(405, { error: 'method_not_allowed', allow: ['POST'] });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
