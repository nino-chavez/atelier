// Next.js 15 minimal config. Cross-package imports from ../scripts/endpoint/
// are exercised by the route handlers; transpilePackages is unnecessary
// because we import .ts source files directly via the path-alias resolved
// at build time.
//
// Per ADR-029: no @vercel/edge, @vercel/kv, or Edge Config helpers. The
// MCP route runs on the default Node.js runtime so the pg driver and the
// in-process AtelierClient work without adapter shims.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow importing TypeScript source from sibling packages (the
  // scripts/endpoint substrate) without a separate compile step. Next 15
  // resolves these via tsconfig paths.
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
