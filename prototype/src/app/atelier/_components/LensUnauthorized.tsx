// Auth-error states for the lens page.
//
// The lens path can fail at three points: no bearer at all, bearer
// validation rejected, or bearer-resolves-to-no-composer. Each renders a
// distinct message so the operator (or a developer running the smoke
// test) can debug which step failed.

import styles from './LensUnauthorized.module.css';

// `lensId` is a display label here (rendered into the eyebrow); the
// /atelier/observability surface reuses this component with id="observability"
// so the type is widened from `LensId` to plain string.
export default function LensUnauthorized({
  lensId,
  reason,
  message,
}: {
  lensId: string;
  reason: 'no_bearer' | 'invalid_bearer' | 'no_composer';
  message: string;
}) {
  const title = TITLES[reason];
  const help = HELP[reason];
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>/atelier/{lensId} · unauthorized</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.message}>{message}</p>
        <div className={styles.help}>
          <strong>What to do:</strong>
          <pre className={styles.codeblock}>{help}</pre>
        </div>
      </div>
    </main>
  );
}

const TITLES: Record<'no_bearer' | 'invalid_bearer' | 'no_composer', string> = {
  no_bearer: 'Sign in to view the dashboard',
  invalid_bearer: 'Bearer rejected',
  no_composer: 'No composer for this identity',
};

const HELP: Record<'no_bearer' | 'invalid_bearer' | 'no_composer', string> = {
  no_bearer:
    'Production: sign in via Supabase Auth (M3-late wire-up).\nDevelopment: set ATELIER_DEV_BEARER=stub:<sub> and seed a composer with identity_subject=<sub>.',
  invalid_bearer:
    'Verify ATELIER_OIDC_ISSUER + ATELIER_JWT_AUDIENCE match your identity provider.\nDev path: confirm ATELIER_DEV_BEARER format is "stub:<sub>".',
  no_composer:
    'A composer row with identity_subject=<sub> and status=active must exist for the project.\nseed via INSERT INTO composers (...).',
};
