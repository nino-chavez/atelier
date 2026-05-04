# Sign-in for /atelier (magic-link + 6-digit code)

**Audience:** an operator running an Atelier deployment (local-bootstrap or Vercel + Supabase Cloud per ADR-046) who needs to understand how human-direct-via-browser sign-in works, configure email delivery, and troubleshoot the most common failures.

**Trace:** D7 (M3-late wire-up close-out). Companion code: `prototype/src/app/sign-in/`, `prototype/src/app/sign-out/`, `prototype/src/lib/atelier/adapters/supabase-ssr.ts`.

---

## What the user sees

1. Visit `/atelier` (or any lens, e.g. `/atelier/analyst`) without a session.
2. Land on the unauthorized state -- "Sign in to view the dashboard" -- with a "Sign in" button.
3. Click "Sign in" -- arrive at `/sign-in?redirect=<original-path>`.
4. Enter email, click "Send sign-in link".
5. The form advances to the code-entry view with a generic confirmation. Behind the scenes, Atelier silently checks whether an admin has invited that email (the C1 OTP-relay gate, per BRD-OPEN-QUESTIONS section 31). If invited: an email goes out. If not invited: nothing goes out -- the UI advances anyway so the form is not a user-enumeration oracle.
6. If the email is invited, receive an email containing **both** a clickable link AND a 6-digit code. Use whichever path your environment allows:
   - **Link path:** click the link in the email -- the browser hits `/sign-in/callback?code=...`, the server exchanges the PKCE code for a session cookie, and bounces to the original path.
   - **Code path:** type the 6 digits into the form -- the browser calls `verifyOtp`, the cookie is set, the page navigates to the original path.
7. The lens renders. The header shows the email + a "Sign out" link.

If the user is invited but the cookie is set without an Atelier composer row mapped to their identity, the lens shows "Your account is not invited yet -- ask your admin to invite you via `atelier invite`". This path is unreachable through the normal flow (the C1 gate would have blocked at step 5), but exists as a defense-in-depth state for sessions established outside the form (e.g. an admin manually creating an auth user without an `atelier invite`).

---

## Why both paths?

Magic-link-only is brittle in two common environments:

1. **Corporate email gateways** (Microsoft Defender, Proofpoint URL Defense, Mimecast, etc.) pre-fetch URLs in incoming mail to scan for malware. Supabase magic-link tokens are single-use; the gateway burns the token before the human ever clicks. The 6-digit code bypasses this entirely -- it is not a URL, the gateway does not consume it.
2. **Mobile-email -> desktop-browser.** People read mail on their phone, but the browser session they want to authenticate is on a laptop. Forwarding the link is awkward; reading the 6 digits and typing them is fast.

Same security posture either way (both are single-use, time-limited, derived from the same Supabase Auth flow); the code path is purely a UX uplift for environments where link-following is unreliable.

---

## C1 OTP-relay gate

`prototype/src/app/sign-in/check/route.ts` runs as a server-side filter between the form and Supabase Auth's `signInWithOtp`. Without it, anyone could use Atelier's deployed `/sign-in` form as a free OTP relay against any email address (Supabase would happily mint magic-link emails for arbitrary recipients). With it, only emails that have a corresponding `composers` row receive a magic-link email; uninvited submissions are silently dropped.

The gate also enforces an in-memory rate limit (10 requests per minute, per IP) to keep an attacker from fanning out invitation lookups against a list of emails. Single-instance Vercel projects (or local dev) are fine on the in-memory path; **multi-region or auto-scaled deploys need shared state to enforce the limit globally** -- swap `ipBuckets` in the route handler for a Redis-backed limiter (Vercel KV / Upstash Redis) before scaling out.

The gate is invisible to the user: 200 (invited) and 404 (not invited) both progress the UI to the code-entry view with the same generic confirmation copy. Only Mailpit / your SMTP provider sees the difference.

---

## Configuring email delivery

### Local-bootstrap

Supabase ships **Mailpit** (image `public.ecr.aws/supabase/mailpit`) with `supabase start`; emails are intercepted and never delivered to the real address. Open the inbox at:

```
http://127.0.0.1:54324
```

Every sign-in attempt during local development surfaces the OTP email here (assuming the C1 gate let it through). The 6-digit code is in the email body. Useful for development; useless for actual humans.

### Production (Supabase Cloud)

Supabase's free-tier Auth includes a default email sender (`noreply@mail.app.supabase.io` style) with **strict rate limits** -- 4 emails/hour per IP for free-tier projects. This is fine for evaluation deployments but will rate-limit a real team.

For a production deploy (per ADR-046), configure SMTP through the Supabase Cloud dashboard:

1. Open `https://supabase.com/dashboard/project/<project-ref>/auth/providers`.
2. Scroll to "SMTP Settings".
3. Enable Custom SMTP and fill in your provider details (Resend, SendGrid, Postmark, Amazon SES, Mailgun all work).
4. Set `Sender email` and `Sender name` (e.g. `noreply@your-team.com` / `Atelier`).
5. Save. The next sign-in email goes through your provider.

Supabase rotates the email template through your provider; the magic-link token + 6-digit code are still generated server-side and embedded in the template body.

### Custom email template (optional)

Supabase's default `Magic Link` template embeds both `{{ .ConfirmationURL }}` and `{{ .Token }}` (the OTP code). Most teams do not need to customize it. If you want a branded version, edit the template in the Auth dashboard or, for local-bootstrap, set `[auth.email.template.magic_link]` in `supabase/config.toml`.

---

## Allowed redirect URLs

Supabase Auth only redirects to URLs in its allowlist. Local-bootstrap is configured in `supabase/config.toml`:

```toml
[auth]
site_url = "http://127.0.0.1:3030"
additional_redirect_urls = [
  "http://127.0.0.1:3030/**",
  "http://localhost:3030/**",
]
```

For a Vercel + Supabase Cloud deploy, add your deployed origin via the dashboard:

```
https://supabase.com/dashboard/project/<project-ref>/auth/url-configuration
```

Add: `https://<your-domain>/**` (or the exact `/sign-in/callback` path -- glob is friendlier).

If a sign-in attempt redirects to `/sign-in?error=expired` even though the OTP code itself worked, the most common cause is that the magic-link URL's redirect target is not in the allowlist; Supabase silently strips the `?code=` query and the callback handler has no exchange to perform.

---

## When to use BYO OIDC instead

Atelier defaults to Supabase Auth (per ADR-027 + ADR-028) because it is the lightest path to "running Atelier with a real identity provider in 5 minutes". But Supabase Auth is **not the only valid choice**.

Switch to your own OIDC provider (Auth0, Keycloak, Okta, Microsoft Entra ID, Google Workspace, GitLab, custom) when:

- Your org already has SSO and "yet another login" is unacceptable
- You need on-prem identity (Supabase Auth is hosted)
- You need OAuth flows beyond email-OTP (SAML, hardware-key MFA, etc.)
- You need fine-grained directory provisioning that Supabase Auth's user pool does not model

The substrate is OIDC-shape-portable. Set in `.atelier/config.yaml`:

```yaml
identity:
  provider: oidc
  issuer: https://your-issuer.example.com
  audience: atelier
```

The lens reads the OIDC bearer through the same JWKS verifier; only the sign-in UI is Supabase-specific. If you switch to BYO OIDC, you replace `/sign-in` and `/sign-in/callback` with your IdP's hosted login -- typically a redirect to the IdP, then a callback that drops the bearer into your cookie store.

See ADR-028 for the BYO-via-`.atelier/config.yaml` shape; the IdP swap involves writing a sibling adapter to `prototype/src/lib/atelier/adapters/supabase-ssr.ts` (per ADR-029, the IdP-specific code lives in named adapter files only).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Form advances to code-entry but no email arrives (and the email is supposed to be invited) | C1 gate returned 404 (composer row missing) OR SMTP misconfigured | Verify `composers.email` row exists; check Supabase SMTP config |
| Form advances to code-entry but no email arrives (no invite issued) | Expected behavior -- C1 gate dropped the request | Have an admin run `atelier invite <email>` first |
| Form returns "Too many sign-in attempts from this network" | Per-IP rate limit (10/min) tripped | Wait a minute; if persistent, swap in shared-state limiter (see C1 gate section) |
| `Send sign-in link` succeeds but no email arrives (local) | Mailpit container not running | `supabase status` to confirm; otherwise `supabase stop && supabase start` |
| Email arrives, link returns `/sign-in?error=expired` | Email gateway pre-fetched the link OR the code was already used | Use the 6-digit code path instead |
| Email arrives, link returns `/sign-in?error=exchange_failed` | Redirect URL not in Supabase allowlist OR PKCE verifier missing (private/incognito tab cleared localStorage between request and click) | Add the origin to allowlist; for incognito, use the code path |
| `verifyOtp` returns "Invalid login credentials" or "Token has expired" | Code typo or 1-hour OTP expiry passed | Click "Use a different email" and retry |
| Sign-in succeeds, lens shows "Your account is not invited yet" | Supabase Auth user has no Atelier composer row (auth user provisioned outside `atelier invite`) | Have an admin run `atelier invite <email>` (D4) |
| Lens shows "Bearer rejected" instead of sign-in CTA | `ATELIER_OIDC_ISSUER` / `ATELIER_JWT_AUDIENCE` mismatch or stale cookie from a previous IdP | Click "Sign out and start over" in the diagnostic block |

---

## Sequencing

D7 ships the **recurring access path** (sign-in for already-invited users). D4 -- `atelier invite` -- ships the **first-time access path** (creates the Atelier composer row and emails the user the same magic link/code). D7 + D4 are a coupled pair: D4 plants accounts, D7 lets them in.

Until D4 lands, seed composers via:

```bash
npx tsx scripts/bootstrap/seed-composer.ts \
  --project-id <uuid> \
  --email user@example.com \
  --identity-subject <supabase-user-id> \
  --discipline analyst
```

The `identity_subject` must equal the Supabase Auth user's `id` (UUID), not their email. Run `supabase` admin queries against `auth.users` to look it up, or use `supabase auth admin --help`.
