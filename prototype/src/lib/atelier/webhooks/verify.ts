// HMAC-SHA256 signature verification for inbound webhooks.
//
// Canonical pattern per:
//   - GitHub: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
//     header `X-Hub-Signature-256: sha256=<hex>`
//   - Figma: header `X-Figma-Signature: <hex>` (no algorithm prefix)
//   - Stripe / Supabase Auth Hooks: Svix-style with timestamp + version
//     prefix (handled separately if those adapters land)
//
// Reference impl (the canonical-pattern audit S12 finding cites these):
//   - apps/rally-hq/src/routes/api/webhooks/stripe/+server.ts
//   - apps/rally-hq/src/routes/api/webhooks/resend/+server.ts
//
// Load-bearing properties:
//   1. Read RAW body (no JSON.parse before verify) — body-parser-before-
//      verification is the classic mistake.
//   2. Constant-time compare via crypto.timingSafeEqual; naive `===`
//      leaks the first-mismatch position via timing.
//   3. Hex decoding of signature to fixed-width bytes — string compare
//      on hex would also leak.
//   4. Reject when secret is missing — fail-closed, never fail-open.

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyHmacOptions {
  /** Raw request body as it arrived on the wire (UTF-8 string). */
  rawBody: string;
  /** Provider's signature header value (full string including any prefix). */
  signatureHeader: string | null;
  /** Provider's webhook secret. Throws if missing. */
  secret: string | undefined;
  /** Optional prefix to strip from signatureHeader (e.g. "sha256=" for GitHub). */
  prefix?: string;
}

/**
 * Verifies an HMAC-SHA256 signature over `rawBody` using `secret`. Returns
 * `true` only when the signature is well-formed and matches.
 *
 * The function never throws on a malformed signature header — it returns
 * `false` so the caller can convert to an HTTP 401 response. It DOES
 * throw when the secret is missing, because a missing secret is a deploy
 * misconfiguration, not a request error, and silently accepting all
 * requests in that state would be a fail-open security bug.
 */
export function verifyHmacSha256(opts: VerifyHmacOptions): boolean {
  if (!opts.secret) {
    throw new Error(
      'webhook secret is missing; refusing to verify (fail-closed). Set the provider-specific secret env var.',
    );
  }
  if (!opts.signatureHeader) return false;

  let receivedHex = opts.signatureHeader;
  if (opts.prefix) {
    if (!receivedHex.startsWith(opts.prefix)) return false;
    receivedHex = receivedHex.slice(opts.prefix.length);
  }

  // Hex must be even-length and only valid hex chars.
  if (!/^[0-9a-fA-F]+$/.test(receivedHex) || receivedHex.length % 2 !== 0) {
    return false;
  }

  const expectedHex = createHmac('sha256', opts.secret).update(opts.rawBody, 'utf8').digest('hex');
  // Lengths must match before timingSafeEqual; otherwise it throws.
  if (receivedHex.length !== expectedHex.length) return false;

  const received = Buffer.from(receivedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return timingSafeEqual(received, expected);
}
