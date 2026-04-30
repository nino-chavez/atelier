// 12-tool dispatcher per ADR-013 + ADR-040.
//
// Maps a tool name + JSON request body to the corresponding handler.
// Each call:
//   1. Authenticates via bearer token (per ARCH 7.9).
//   2. Resolves the AuthContext (composer + project).
//   3. Looks up the tool by name; returns INVALID_TOOL if not in the
//      v1 surface.
//   4. Calls the handler with the AuthContext + parsed request.
//   5. Returns the handler's response or maps AtelierError -> wire shape.
//
// This is the substrate that the actual Streamable HTTP MCP transport
// wraps. Transport is a thin adapter that:
//   - Receives MCP tool/call messages
//   - Extracts Authorization: Bearer header
//   - Delegates to dispatch()
//   - Maps result -> MCP response envelope.

import { AtelierClient, AtelierError } from '../../sync/lib/write.ts';
import type { AuthContext, BearerVerifier } from './auth.ts';
import { authenticate } from './auth.ts';
import type { AdrCommitter } from './committer.ts';
import * as handlers from './handlers.ts';

export const TOOL_NAMES = [
  'register',
  'heartbeat',
  'deregister',
  'get_context',
  'find_similar',
  'claim',
  'update',
  'release',
  'log_decision',
  'acquire_lock',
  'release_lock',
  'propose_contract_change',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

// Compile-time assertion that the surface is exactly 12 tools per ADR-013 + ADR-040.
const _twelveCheck: 12 = TOOL_NAMES.length as typeof TOOL_NAMES.length;
void _twelveCheck;

export interface DispatchRequest {
  tool: string;
  bearer: string;
  body: unknown;
}

export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export interface DispatchDeps {
  client: AtelierClient;
  verifier: BearerVerifier;
  /**
   * Per-project git committer (ARCH 7.8 / ADR-023). Required for
   * log_decision; if omitted, log_decision returns INTERNAL with a
   * `decisionCommit`-named marker. Constructed from env via
   * `gitCommitterFromEnv()` in production.
   */
  decisionCommit?: AdrCommitter;
}

export async function dispatch(req: DispatchRequest, deps: DispatchDeps): Promise<DispatchResult> {
  if (!TOOL_NAME_SET.has(req.tool)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TOOL',
        message: `tool "${req.tool}" is not in the v1 surface`,
        details: { tools: TOOL_NAMES },
      },
    };
  }

  let auth: AuthContext;
  try {
    // Pool used by authenticate is internal to AtelierClient; expose via
    // the typed escape hatch on the client (constructed below).
    auth = await authenticate(req.bearer, deps.verifier, (deps.client as unknown as { pool: import('pg').Pool }).pool);
  } catch (err) {
    return mapError(err);
  }

  try {
    const data = await invokeHandler(req.tool as ToolName, deps, auth, req.body);
    return { ok: true, data };
  } catch (err) {
    return mapError(err);
  }
}

async function invokeHandler(
  tool: ToolName,
  deps: DispatchDeps,
  auth: AuthContext,
  body: unknown,
): Promise<unknown> {
  const b = body as Record<string, unknown>;
  switch (tool) {
    case 'register':
      return handlers.register(deps.client, auth, b as unknown as handlers.RegisterRequest);
    case 'heartbeat':
      return handlers.heartbeat(deps.client, auth, b as unknown as handlers.HeartbeatRequest);
    case 'deregister':
      return handlers.deregister(deps.client, auth, b as unknown as handlers.DeregisterRequest);
    case 'get_context':
      return handlers.getContext(deps.client, auth, b as unknown as handlers.GetContextRequest);
    case 'find_similar':
      return handlers.findSimilar(deps.client, auth, b as unknown as handlers.FindSimilarRequest);
    case 'claim':
      return handlers.claim(deps.client, auth, b as unknown as handlers.ClaimRequest);
    case 'update':
      return handlers.update(deps.client, auth, b as unknown as handlers.UpdateRequest);
    case 'release':
      return handlers.release(deps.client, auth, b as unknown as handlers.ReleaseRequest);
    case 'log_decision':
      if (!deps.decisionCommit) {
        throw new AtelierError(
          'INTERNAL',
          'log_decision requires a decisionCommit callback configured on the dispatcher',
        );
      }
      return handlers.logDecision(
        deps.client,
        auth,
        b as unknown as handlers.LogDecisionRequest,
        deps.decisionCommit,
      );
    case 'acquire_lock':
      return handlers.acquireLock(deps.client, auth, b as unknown as handlers.AcquireLockRequest);
    case 'release_lock':
      return handlers.releaseLock(deps.client, auth, b as unknown as handlers.ReleaseLockRequest);
    case 'propose_contract_change':
      return handlers.proposeContractChange(deps.client, auth, b as unknown as handlers.ProposeContractChangeRequest);
  }
}

function mapError(err: unknown): DispatchResult {
  if (err instanceof AtelierError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  }
  return {
    ok: false,
    error: { code: 'INTERNAL', message: (err as Error).message ?? 'unknown error' },
  };
}
