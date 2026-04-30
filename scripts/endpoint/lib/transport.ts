// Streamable HTTP MCP transport adapter (per ARCH 7.9 + ADR-013).
//
// This module is the wire-level transport over the in-process dispatcher.
// dispatch.ts is the substrate; transport.ts is the adapter on top.
//
// Wire responsibilities:
//   - Accept POST requests with JSON-RPC 2.0 envelope
//   - Extract `Authorization: Bearer <jwt>` header
//   - Map `initialize` / `tools/list` / `tools/call` methods to the
//     dispatcher's TOOL_NAMES surface
//   - Map DispatchResult <-> MCP response envelope, including
//     AtelierErrorCode -> JSON-RPC error code class
//
// What is intentionally NOT here at M2-mid (per SESSION.md scope):
//   - OAuth dynamic-client-registration (RFC 7591)
//   - Rate limiting (ARCH 7.7)
//   - Transcript capture (ADR-024 / ARCH 7.8.1)
//   - Server-initiated SSE for progress streaming. The Streamable HTTP
//     spec permits a JSON-only path for handlers whose responses fit in
//     one envelope; all 12 tools at v1 do, so JSON suffices. The SSE
//     upgrade hook is reserved here (a separate `ContentType: text/event-stream`
//     client-Accept can be added later without changing the wire shape).

import type { DispatchDeps } from './dispatch.ts';
import { dispatch, TOOL_NAMES, type ToolName } from './dispatch.ts';

// ---------------------------------------------------------------------------
// JSON-RPC + MCP envelope shapes
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string | number | null;
  result: T;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

// JSON-RPC standard error codes. MCP layers tool-call errors INSIDE
// `result.isError = true` per the MCP spec; transport-level errors
// (parse, invalid request, method not found, internal) use these.
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

// ---------------------------------------------------------------------------
// Tool descriptor surface (for tools/list)
// ---------------------------------------------------------------------------

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; additionalProperties?: boolean };
}

// Minimal-but-spec-valid tool descriptors for tools/list. The real
// JSON-Schema generation from handlers.ts request types lands when the
// MCP catalog is published as a contract (M2-mid+). For now, descriptors
// advertise the 12-tool surface with passthrough schemas; tool-call
// validation happens inside handlers.ts / write.ts.
const TOOL_DESCRIPTORS: Record<ToolName, Omit<ToolDescriptor, 'name'>> = {
  register: {
    description: 'Register a session for this composer. Per ARCH 6.1.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  heartbeat: {
    description: 'Refresh session liveness. Per ARCH 6.1.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  deregister: {
    description: 'Release session resources. Per ARCH 6.1.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  get_context: {
    description: 'Pull session + territory + recent decisions context. Per ARCH 6.7.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  find_similar: {
    description: 'Semantic search over prior decisions and contributions. Per ARCH 6.4.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  claim: {
    description: 'Claim or atomically create-and-claim a contribution. Per ARCH 6.2.1 / ADR-022.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  update: {
    description: 'Update contribution state, content_ref, or plan-review payload. Per ARCH 6.2.2.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  release: {
    description: 'Release a contribution back to open. Per ARCH 6.2.4.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  log_decision: {
    description: 'Log a decision as a new ADR file with datastore mirror. Per ARCH 6.3.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  acquire_lock: {
    description: 'Acquire a fencing-token-protected lock on artifact_scope. Per ARCH 7.4.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  release_lock: {
    description: 'Release a held lock. Per ARCH 7.4.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
  propose_contract_change: {
    description: 'Propose a contract change for territory review. Per ARCH 6.6 / ADR-040.',
    inputSchema: { type: 'object', additionalProperties: true },
  },
};

// ---------------------------------------------------------------------------
// AtelierErrorCode -> MCP / JSON-RPC mapping
// ---------------------------------------------------------------------------
//
// Tool-call errors come back as MCP-shaped `result.isError = true` payloads
// per the MCP spec, NOT as JSON-RPC errors. JSON-RPC errors are reserved
// for transport-level failures (parse, invalid envelope, unknown method).

function dispatcherErrorToToolResult(error: { code: string; message: string; details?: Record<string, unknown> }) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ code: error.code, message: error.message, details: error.details ?? null }),
      },
    ],
    isError: true,
  };
}

function dispatcherSuccessToToolResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data),
      },
    ],
    isError: false,
    structuredContent: data,
  };
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

export interface TransportOptions {
  deps: DispatchDeps;
  /** MCP protocol version negotiated on initialize. Defaults to 2025-06-18. */
  protocolVersion?: string;
  /** Server name surfaced in initialize.serverInfo. */
  serverName?: string;
  /** Server version surfaced in initialize.serverInfo. */
  serverVersion?: string;
}

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_SERVER_NAME = 'atelier-mcp';
const DEFAULT_SERVER_VERSION = '0.1.0-m2';

/**
 * Streamable HTTP MCP request handler. Web-standard Request -> Response
 * shape so it works under both Vercel Functions (Node + Edge) and any
 * Node.js HTTP server (smoke tests use http.createServer).
 *
 * Per ARCH 7.9: the endpoint validates the JWT bearer on every request
 * via the configured BearerVerifier. The wire layer extracts the token
 * and hands it to dispatch(); auth failures surface as MCP tool-call
 * errors with code=FORBIDDEN.
 */
export async function handleMcpRequest(
  request: Request,
  options: TransportOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonRpcResponse(
      jsonRpcError(null, JSONRPC_INVALID_REQUEST, 'POST required for MCP transport'),
      { status: 405, headers: { Allow: 'POST' } },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonRpcResponse(
      jsonRpcError(null, JSONRPC_INVALID_REQUEST, 'Content-Type must be application/json'),
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return jsonRpcResponse(
      jsonRpcError(null, JSONRPC_PARSE_ERROR, `JSON parse failed: ${(err as Error).message}`),
      { status: 400 },
    );
  }

  if (!isJsonRpcRequest(body)) {
    return jsonRpcResponse(
      jsonRpcError(
        (body as { id?: string | number | null })?.id ?? null,
        JSONRPC_INVALID_REQUEST,
        'envelope must be { jsonrpc: "2.0", id, method, params? }',
      ),
      { status: 400 },
    );
  }

  const id = body.id ?? null;

  // Bearer extraction. Auth failures during the dispatch path return
  // FORBIDDEN tool-call errors; the wire only enforces presence + scheme.
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch ? bearerMatch[1]!.trim() : '';

  // For initialize / tools/list we still gate on bearer (per ARCH 7.9
  // every MCP HTTP request carries Authorization: Bearer). The
  // dispatcher's authenticate() also runs on tools/call.
  if (!bearer) {
    return jsonRpcResponse(jsonRpcSuccess(id, dispatcherErrorToToolResult({
      code: 'FORBIDDEN',
      message: 'missing Authorization: Bearer header',
    })), {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="atelier"' },
    });
  }

  switch (body.method) {
    case 'initialize':
      return jsonRpcResponse(jsonRpcSuccess(id, {
        protocolVersion: options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: options.serverName ?? DEFAULT_SERVER_NAME,
          version: options.serverVersion ?? DEFAULT_SERVER_VERSION,
        },
      }));

    case 'tools/list':
      return jsonRpcResponse(jsonRpcSuccess(id, {
        tools: TOOL_NAMES.map((name) => ({ name, ...TOOL_DESCRIPTORS[name] })),
      }));

    case 'tools/call': {
      const params = body.params ?? {};
      const toolName = (params as { name?: unknown }).name;
      const toolArgs = (params as { arguments?: unknown }).arguments ?? {};
      if (typeof toolName !== 'string' || toolName.length === 0) {
        return jsonRpcResponse(jsonRpcError(id, JSONRPC_INVALID_PARAMS, 'params.name must be a non-empty string'));
      }
      const result = await dispatch({ tool: toolName, bearer, body: toolArgs }, options.deps);
      if (result.ok) {
        return jsonRpcResponse(jsonRpcSuccess(id, dispatcherSuccessToToolResult(result.data)));
      }
      // Return the dispatcher error as a tool-call error per MCP spec.
      // The HTTP status stays 200 because the JSON-RPC envelope is
      // well-formed; the error is in-band.
      return jsonRpcResponse(jsonRpcSuccess(id, dispatcherErrorToToolResult(result.error)));
    }

    case 'notifications/initialized':
      // No-op handshake notification per MCP spec; respond with empty
      // success result so JSON-RPC envelope round-trip still validates.
      return jsonRpcResponse(jsonRpcSuccess(id, {}));

    default:
      return jsonRpcResponse(jsonRpcError(id, JSONRPC_METHOD_NOT_FOUND, `method "${body.method}" not implemented`));
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC response builders
// ---------------------------------------------------------------------------

function jsonRpcSuccess<T>(id: string | number | null, result: T): JsonRpcSuccess<T> {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function jsonRpcResponse(
  envelope: JsonRpcSuccess<unknown> | JsonRpcError,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(envelope), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.jsonrpc === '2.0' && typeof v.method === 'string' && (v.id === null || ['string', 'number'].includes(typeof v.id));
}

// Re-export for convenience to consumers (Next.js route, smoke).
export { JSONRPC_PARSE_ERROR, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, JSONRPC_INVALID_PARAMS, JSONRPC_INTERNAL_ERROR };
