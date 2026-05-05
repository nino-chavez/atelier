// Figma webhook receiver — closes M8 audit S12 finding (Figma half).
//
// Per ARCH §6.5.2 the Figma comment-driven triage flow depends on
// FILE_COMMENT webhooks. ADR-019 framed Figma as the feedback surface
// (not design source-of-truth) — comment events feeding the triage
// pipeline are the load-bearing surface for that role.
//
// Figma's signature shape is `X-Figma-Signature: <hex>` with NO algorithm
// prefix (contrast with GitHub's `sha256=` prefix). The verify helper
// handles both via the optional `prefix` parameter.
//
// What this handler does at v1:
//   1. Read raw body, verify X-Figma-Signature, idempotency-check via
//      X-Figma-Webhook-Id (or fall back to a payload-derived hash if
//      Figma's headers do not carry a delivery ID).
//   2. Mark processed; return 200 (or 200-idempotent on duplicate).
//
// What this handler does NOT do at v1:
//   - Dispatch FILE_COMMENT events to scripts/sync/triage/route-proposal.ts.
//     The triage pipeline exists; wiring is a v1.x follow-up.
//
// Reference impl pattern: same shape as GitHub handler.

import { verifyHmacSha256 } from '../../../../lib/atelier/webhooks/verify.ts';
import {
  recordDelivery,
  markDeliveryProcessed,
} from '../../../../lib/atelier/webhooks/idempotency.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.FIGMA_WEBHOOK_SECRET;
  if (!secret) {
    return jsonResponse(500, { error: 'webhook_secret_missing' });
  }

  // Figma's webhook headers as of 2026: X-Figma-Signature and a delivery
  // ID via X-Figma-Webhook-Id. If the delivery ID header is absent
  // (older Figma webhook spec or a misconfigured forwarder), derive a
  // stable ID from the payload's `event_type:webhook_id:passcode` triple
  // — adopters can override by configuring the newer header.
  const signatureHeader = request.headers.get('x-figma-signature');
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
    });
  } catch {
    return jsonResponse(500, { error: 'webhook_secret_missing' });
  }

  if (!valid) {
    return jsonResponse(401, { error: 'invalid_signature' });
  }

  // Parse payload after verification. Figma payloads have `event_type`
  // and `webhook_id`; combine into a stable delivery ID if no header.
  let payload: { event_type?: string; webhook_id?: string; passcode?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const headerDeliveryId = request.headers.get('x-figma-webhook-id');
  const fallbackDeliveryId =
    payload.webhook_id && payload.event_type
      ? `figma:${payload.webhook_id}:${payload.event_type}:${rawBody.length}`
      : null;
  const deliveryId = headerDeliveryId ?? fallbackDeliveryId;

  if (!deliveryId) {
    return jsonResponse(400, { error: 'missing_delivery_id' });
  }

  const { firstSeen } = await recordDelivery({
    deliveryId,
    source: 'figma',
    eventType: payload.event_type ?? null,
  });

  if (!firstSeen) {
    return jsonResponse(200, { ok: true, deliveryId, idempotent: true });
  }

  try {
    await markDeliveryProcessed(deliveryId, 'received');
    return jsonResponse(200, { ok: true, deliveryId, eventType: payload.event_type });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markDeliveryProcessed(deliveryId, 'error', message).catch(() => {});
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
