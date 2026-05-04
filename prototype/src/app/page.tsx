// Public landing for the prototype. The substrate is self-hosted dev
// infrastructure -- composers sign in, then work happens through /atelier
// (the lenses) or directly via the /api/mcp tool surface from an agent
// client. This page is a thin entry point, not a marketing site.

import Link from 'next/link';

const styles = {
  shell: {
    background: '#0e1014',
    color: '#e6e9ef',
    font: '14px/1.5 ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
    minHeight: '100vh',
    display: 'grid' as const,
    placeItems: 'center' as const,
    padding: 24,
  },
  card: {
    maxWidth: 560,
    width: '100%',
    background: '#161a22',
    border: '1px solid #2a303c',
    borderRadius: 6,
    padding: '28px 32px',
  },
  eyebrow: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12,
    color: '#8a93a6',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    marginBottom: 8,
  },
  title: {
    font: '600 24px/1.2 ui-sans-serif, system-ui, sans-serif',
    margin: '0 0 12px',
  },
  lede: {
    color: '#c9d1e0',
    margin: '0 0 24px',
  },
  cta: {
    display: 'inline-block',
    background: '#7aa6ff',
    color: '#0e1014',
    border: '1px solid #7aa6ff',
    borderRadius: 4,
    padding: '10px 18px',
    font: '600 13px/1 ui-sans-serif, system-ui, sans-serif',
    textDecoration: 'none',
    width: 'fit-content' as const,
  },
  meta: {
    borderTop: '1px solid #2a303c',
    marginTop: 24,
    paddingTop: 16,
    fontSize: 13,
    color: '#8a93a6',
  },
  metaRow: {
    margin: '0 0 6px',
  },
  code: {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    background: '#0e1014',
    border: '1px solid #2a303c',
    padding: '1px 5px',
    borderRadius: 3,
    color: '#c9d1e0',
  },
};

export default function Home() {
  return (
    <main style={styles.shell}>
      <div style={styles.card}>
        <div style={styles.eyebrow}>atelier // self-hosted</div>
        <h1 style={styles.title}>Atelier</h1>
        <p style={styles.lede}>
          A coordination substrate for mixed human + agent teams. Composers
          across IDE, browser, and terminal claim work, log decisions, and
          hold locks against one canonical artifact -- so the team stays
          coherent even when half the contributors are agents.
        </p>
        <Link href="/sign-in" style={styles.cta} data-testid="signin-cta">
          Sign in
        </Link>
        <div style={styles.meta}>
          <p style={styles.metaRow}>
            Coordination dashboard:{' '}
            <Link href="/atelier" style={{ color: '#c9d1e0' }}>
              /atelier
            </Link>{' '}
            (post sign-in) -- five role-aware lenses (analyst / dev / pm /
            designer / stakeholder).
          </p>
          <p style={styles.metaRow}>
            Agent endpoint: <code style={styles.code}>/api/mcp</code> -- OAuth
            discovery: <code style={styles.code}>/.well-known/oauth-authorization-server</code>.
          </p>
        </div>
      </div>
    </main>
  );
}
