// Placeholder home for the prototype web app. Per prototype/README.md the
// route plan is:  / | /strategy | /design | /slices/[id] | /atelier |
// /traceability. /atelier lights up at M3 (this commit); the other routes
// remain pre-implementation. Agent endpoint + OAuth discovery have been
// live since M2-mid.

import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif', lineHeight: 1.5 }}>
      <h1>Atelier</h1>
      <p>
        Coordination dashboard:{' '}
        <Link href="/atelier">/atelier</Link> — five role-aware lenses
        (analyst / dev / pm / designer / stakeholder).
      </p>
      <p>
        Agent endpoint: <code>/api/mcp</code> · OAuth discovery:{' '}
        <code>/.well-known/oauth-authorization-server</code>.
      </p>
    </main>
  );
}
