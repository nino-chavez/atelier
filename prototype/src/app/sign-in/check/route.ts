// /sign-in/check -- C1 OTP-relay gate (BRD-OPEN-QUESTIONS section 31).
//
// The browser POSTs { email } here BEFORE calling auth.signInWithOtp on
// Supabase. We return:
//   - 200 if a composer with this email exists in the datastore (i.e.
//     an admin has invited them via `atelier invite`)
//   - 404 otherwise
//   - 429 when the per-IP token bucket is exhausted
//   - 400 on malformed input (no email field)
//
// The browser advances the UI to the code-entry view in BOTH the 200
// and the 404 cases (the form's confirmation copy says "if registered,
// we sent a link"); only the 200 path actually invokes signInWithOtp.
// This closes the open-OTP-relay attacker surface (HIGH severity in
// the X1 audit) without creating a user-enumeration oracle: 200 vs
// 404 is differentiated server-side but invisible to the browser UI.
//
// Rate-limit: in-memory token bucket, 10/min per IP. Reset on process
// restart is acceptable for v1 -- the bucket is the second line of
// defense, not the only one (the gate itself drops uninvited emails
// regardless of rate). Swap point for Vercel KV / Redis is the
// ipBuckets Map below; replace with a Redis-backed limiter when
// Atelier is deployed behind a load balancer (multiple Vercel function
// instances each with their own in-memory bucket would let an attacker
// fan-out to bypass the limit).

import { NextResponse, type NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { getLensDeps } from '../../../lib/atelier/deps.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

// SWAP POINT (BRD-OQ section 31): replace this in-memory map with a
// Redis-backed limiter (Vercel KV / Upstash Redis) before deploying
// behind multiple function instances. Single-instance Vercel projects
// (or local dev) are fine on the in-memory path; multi-region or
// auto-scaled deploys need shared state to enforce the limit globally.
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = resolveClientIp(request);
  if (!consumeBucket(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const email = extractEmail(body);
  if (!email) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const deps = getLensDeps();
  const pool = (deps.client as unknown as { pool: Pool }).pool;
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM composers
        WHERE lower(email) = lower($1)
          AND status = 'active'
     ) AS exists`,
    [email],
  );
  const invited = result.rows[0]?.exists ?? false;
  if (!invited) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

function extractEmail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as Record<string, unknown>).email;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function resolveClientIp(request: NextRequest): string {
  // Vercel + most reverse proxies set x-forwarded-for; the leftmost
  // entry is the originating client. Local dev (Next dev server) does
  // not set the header, so we fall back to a stable string -- the
  // limiter still functions per-process during development.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'local';
}

function consumeBucket(ip: string): boolean {
  const now = Date.now();
  const existing = ipBuckets.get(ip);
  if (!existing || existing.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return false;
  }
  existing.count += 1;
  return true;
}
