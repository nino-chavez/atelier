// Catch-all for unmatched /.well-known/* paths.
//
// MCP clients (Claude Code's SDK most acutely) probe several discovery
// paths during connection setup, expecting either valid OAuth metadata
// or a parseable error response. When the path isn't served by an
// explicit route, Next.js's default behavior is to render its HTML 404
// page — which the SDK then tries to parse as JSON OAuth-error-response
// shape and chokes with:
//
//   SDK auth failed: HTTP 404: Invalid OAuth error response:
//   SyntaxError: JSON Parse error: Unrecognized token '<'.
//   Raw body: <!DOCTYPE html>...
//
// This catch-all returns a parseable JSON 404 instead. Specific routes
// (e.g. /.well-known/oauth-authorization-server/oauth/api/mcp) take
// precedence over this catch-all per Next.js routing rules, so the
// substrate split (PR #14) keeps working: discovery is published only
// at the path-prefixed URL for the OAuth-flow route, and every other
// /.well-known/* path returns this clean 404.

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({ error: 'not_found' }),
    {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
}
