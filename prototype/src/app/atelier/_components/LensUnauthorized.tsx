// Auth-error states for the lens page.
//
// The lens path can fail at three points: no bearer at all, bearer
// validation rejected, or bearer-resolves-to-no-composer. Each renders a
// distinct affordance:
//
//   no_bearer       -> sign-in CTA with the originating route threaded
//                      through ?redirect=, so post-sign-in lands the user
//                      back where they started.
//   no_composer     -> "ask your admin to invite you" -- magic-link auth
//                      succeeded (Supabase Auth user exists) but no
//                      Atelier composer row maps to that identity_subject;
//                      composer rows are created by `atelier invite`.
//   invalid_bearer  -> diagnostic "what to check" block for operators;
//                      this is a configuration error path, not a
//                      sign-in path.

import Link from 'next/link';
import styles from './LensUnauthorized.module.css';

export type LensUnauthorizedReason = 'no_bearer' | 'invalid_bearer' | 'no_composer';

// `lensId` is a display label here (rendered into the eyebrow); the
// /atelier/observability surface reuses this component with id="observability"
// so the type is widened from `LensId` to plain string.
export default function LensUnauthorized({
  lensId,
  reason,
  message,
}: {
  lensId: string;
  reason: LensUnauthorizedReason;
  message: string;
}) {
  const title = TITLES[reason];
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>/atelier/{lensId} -- unauthorized</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.message}>{message}</p>
        {reason === 'no_bearer' && <SignInCTA lensId={lensId} />}
        {reason === 'no_composer' && <NoComposerHelp />}
        {reason === 'invalid_bearer' && <InvalidBearerHelp />}
      </div>
    </main>
  );
}

const TITLES: Record<LensUnauthorizedReason, string> = {
  no_bearer: 'Sign in to view the dashboard',
  invalid_bearer: 'Bearer rejected',
  no_composer: 'Your account is not invited yet',
};

function SignInCTA({ lensId }: { lensId: string }) {
  // The originating route is a same-origin path; Next's Link encodes
  // the query string for us.
  const returnTo = `/atelier/${lensId}`;
  return (
    <div className={styles.cta}>
      <Link
        href={{ pathname: '/sign-in', query: { redirect: returnTo } }}
        className={styles.primary}
        data-testid="signin-cta"
      >
        Sign in
      </Link>
      <p className={styles.ctaHint}>
        Atelier sends a sign-in link AND a 6-digit code; use whichever
        path your environment allows.
      </p>
    </div>
  );
}

function NoComposerHelp() {
  return (
    <div className={styles.help}>
      <p>
        Sign-in succeeded, but no Atelier composer is mapped to this
        identity. Composer rows are created by an admin via{' '}
        <code>atelier invite &lt;email&gt;</code>; contact whoever runs
        this Atelier instance and ask to be invited.
      </p>
      <p className={styles.helpFooter}>
        <Link href="/sign-out" className={styles.signOut}>
          Sign out
        </Link>
      </p>
    </div>
  );
}

function InvalidBearerHelp() {
  return (
    <div className={styles.help}>
      <strong>What to check:</strong>
      <pre className={styles.codeblock}>
        {[
          'Verify NEXT_PUBLIC_SUPABASE_URL points at your Supabase project (the JWKS issuer derives from it).',
          'Dev path: confirm ATELIER_DEV_BEARER format is "stub:<sub>".',
        ].join('\n')}
      </pre>
      <p className={styles.helpFooter}>
        <Link href="/sign-out" className={styles.signOut}>
          Sign out and start over
        </Link>
      </p>
    </div>
  );
}
