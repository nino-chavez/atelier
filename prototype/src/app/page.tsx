// Placeholder home for the prototype web app. Per prototype/README.md the
// route plan is:  / | /strategy | /design | /slices/[id] | /atelier |
// /traceability. Routes light up across M3+. At M2-mid only the agent
// endpoint and OAuth discovery are live; this page exists so Next.js has
// a non-error root and so a deployment smoke can verify the host is up.

export default function Home() {
  return (
    <main>
      <h1>Atelier</h1>
      <p>
        The canonical artifact web app is pre-implementation. The agent
        endpoint at <code>/api/mcp</code> and OAuth discovery at{' '}
        <code>/.well-known/oauth-authorization-server</code> are live as
        of M2-mid.
      </p>
    </main>
  );
}
