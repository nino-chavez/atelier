# Sign-in for /atelier (magic-link + 6-digit code)

**Audience:** an operator running an Atelier deployment (local-bootstrap or Vercel + Supabase Cloud per ADR-046) who needs to understand how human-direct-via-browser sign-in works, configure email delivery, and troubleshoot the most common failures.

**Trace:** D7 (M3-late wire-up close-out). Companion code: `prototype/src/app/sign-in/`, `prototype/src/app/sign-out/`, `prototype/src/lib/atelier/adapters/supabase-ssr.ts`.

---

## What the user sees

1. Visit `/atelier` (or any lens, e.g. `/atelier/analyst`) without a session.
2. Land on the unauthorized state -- "Sign in to view the dashboard" -- with a "Sign in" button.
3. Click "Sign in" -- arrive at `/sign-in?redirect=<original-path>`.
4. Enter email, click "Send sign-in link".
5. The form advances to the code-entry view with a generic confirmation. Behind the scenes, the form calls `signInWithOtp` with `shouldCreateUser:false`; Supabase Auth dispatches mail iff the address resolves to an existing auth user. The form swallows the error and advances regardless so it is not a user-enumeration oracle.
6. If the email resolves to an invited account, receive an email containing **both** a clickable link AND a 6-digit code. Use whichever path your environment allows:
   - **Link path:** click the link in the email -- the browser hits `/auth/confirm?token_hash=<hash>&type=magiclink&next=/atelier`, the server calls `auth.verifyOtp({ type, token_hash })`, seats the session cookie, and redirects to `next`.
   - **Code path:** type the 6 digits into the form -- the browser calls `verifyOtp({ email, token, type: 'email' })`, the cookie is set, the page navigates to the original path.
7. The lens renders. The header shows the email + a "Sign out" link.

If a user is signed in but no Atelier composer row is mapped to their identity, the lens shows "Your account is not invited yet -- ask your admin to invite you via `atelier invite`". This path is unreachable through the normal flow (Supabase Auth would not have minted mail), but exists as a defense-in-depth state for sessions established outside the form (e.g. an admin manually creating an auth user without an `atelier invite`).

---

## Why both paths?

Magic-link-only is brittle in two common environments:

1. **Corporate email gateways** (Microsoft Defender, Proofpoint URL Defense, Mimecast, etc.) pre-fetch URLs in incoming mail to scan for malware. Supabase magic-link tokens are single-use; the gateway burns the token before the human ever clicks. The 6-digit code bypasses this entirely -- it is not a URL, the gateway does not consume it.
2. **Mobile-email -> desktop-browser.** People read mail on their phone, but the browser session they want to authenticate is on a laptop. Forwarding the link is awkward; reading the 6 digits and typing them is fast.

Same security posture either way (both are single-use, time-limited, derived from the same Supabase Auth flow); the code path is purely a UX uplift for environments where link-following is unreliable.

---

## OTP-relay structural protection

The dedicated `/sign-in/check` server gate has been removed (BRD-OPEN-QUESTIONS section 31, "Refactor sign-in to token-hash flow per rally-hq pattern"). The same OTP-relay surface is now closed structurally by two defenses:

1. **`shouldCreateUser:false` on `signInWithOtp`.** Supabase Auth refuses to mint mail for non-existent users, so the form cannot be used as a free magic-link relay against arbitrary recipients.
2. **Token-hash verify on `/auth/confirm`.** The route only succeeds for tokens Supabase issued; an attacker cannot forge a session by guessing.

The form swallows the `signInWithOtp` error and advances the UI to the code-entry view regardless of outcome, so the response shape does not reveal whether an email is on the auth-users list (no enumeration oracle).

Supabase Auth's own per-IP and per-email rate limits cap brute-force attempts. If you need stricter limits, configure them in the Supabase Dashboard -> Authentication -> Rate Limits panel; the substrate does not layer its own limiter at the app level any more.

---

## Configuring email delivery

### Local-bootstrap

Supabase ships **Mailpit** (image `public.ecr.aws/supabase/mailpit`) with `supabase start`; emails are intercepted and never delivered to the real address. Open the inbox at:

```
http://127.0.0.1:54324
```

Every sign-in attempt for a known auth user surfaces the OTP email here. The 6-digit code is in the email body. Useful for development; useless for actual humans.

### Production (Supabase Cloud)

Supabase's free-tier Auth includes a default email sender (`noreply@mail.app.supabase.io` style) with **strict rate limits** -- 4 emails/hour per IP for free-tier projects. This is fine for evaluation deployments but will rate-limit a real team.

For a production deploy (per ADR-046), configure SMTP through the Supabase Cloud dashboard:

1. Open `https://supabase.com/dashboard/project/<project-ref>/auth/providers`.
2. Scroll to "SMTP Settings".
3. Enable Custom SMTP and fill in your provider details (Resend, SendGrid, Postmark, Amazon SES, Mailgun all work).
4. Set `Sender email` and `Sender name` (e.g. `noreply@your-team.com` / `Atelier`).
5. Save. The next sign-in email goes through your provider.

Supabase rotates the email template through your provider; the magic-link token + 6-digit code are still generated server-side and embedded in the template body.

### Custom email template (REQUIRED for the magic-link path)

Atelier's `/auth/confirm` route uses Supabase's token-hash verify flow, which requires the email template to emit a `?token_hash=` URL pointing at our app rather than Supabase's default verifier. Paste the following into Supabase Dashboard -> Authentication -> Email Templates -> Magic Link:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/atelier
```

The 6-digit code path works without this change (Supabase's default template includes `{{ .Token }}` already), but the link path will land on Supabase's PKCE verify URL and fail unless this template is in place.

For local-bootstrap, edit `[auth.email.template.magic_link]` in `supabase/config.toml`. For Supabase Cloud, edit the template in the Auth dashboard.

---

## Allowed redirect URLs

The token-hash flow does not depend on the Supabase redirect-URL allowlist for the human-sign-in path -- the email template controls the URL via `{{ .SiteURL }}/auth/confirm?...`, which already routes through your app. You only need to keep `Site URL` set to your deploy URL (e.g. `https://atelier-three-coral.vercel.app` or `http://127.0.0.1:3030` for local).

If you also use OAuth Connectors (`/oauth/api/mcp` for claude.ai / ChatGPT MCP integrations), keep their redirect URLs allowlisted -- those flows still depend on the allowlist. The human-sign-in path is decoupled.

If a sign-in attempt redirects to `/sign-in?error=expired` even though the OTP code itself worked, the most common cause is that the email template has not been updated to the token-hash shape (the link still points at Supabase's PKCE verify endpoint, which redirects to the now-deleted `/sign-in/callback`). Verify the template body matches the snippet above.

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

The lens reads the OIDC bearer through the same JWKS verifier; only the sign-in UI is Supabase-specific. If you switch to BYO OIDC, you replace `/sign-in` and `/auth/confirm` with your IdP's hosted login -- typically a redirect to the IdP, then a callback that drops the bearer into your cookie store.

See ADR-028 for the BYO-via-`.atelier/config.yaml` shape; the IdP swap involves writing a sibling adapter to `prototype/src/lib/atelier/adapters/supabase-ssr.ts` (per ADR-029, the IdP-specific code lives in named adapter files only).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Form advances to code-entry but no email arrives (and the email is supposed to be invited) | Auth user not provisioned (`atelier invite` did not complete the Supabase side) OR SMTP misconfigured | Verify the user exists in Supabase Auth + the `composers` row carries the matching `identity_subject`; check Supabase SMTP config |
| Form advances to code-entry but no email arrives (no invite issued) | Expected behavior -- `shouldCreateUser:false` blocks unknown emails | Have an admin run `atelier invite <email>` first |
| Form returns "Too many sign-in attempts from this network" | Supabase Auth's per-IP / per-email rate limit tripped | Wait a few minutes; for production, configure custom limits in the Auth dashboard |
| `Send sign-in link` succeeds but no email arrives (local) | Mailpit container not running | `supabase status` to confirm; otherwise `supabase stop && supabase start` |
| Email arrives, link returns `/sign-in?error=expired` | Email template not yet updated to token-hash shape OR the link was already used / expired | Paste the rally-hq email-template body into Supabase Dashboard (see "Custom email template" above); use a fresh code path if expired |
| Email arrives, link 404s on `/sign-in/callback` | Email template still emits the legacy `?code=` URL pointing at the deleted callback route | Update the email template to the `?token_hash=` shape (see above) |
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
