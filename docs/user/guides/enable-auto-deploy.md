# Enable Vercel git auto-deploy

**Status:** v1 reference flow per ADR-046 (deploy strategy). Manual `vercel deploy --prod` remains the always-available path; this guide enables `git push origin main` → fresh production deploy + per-PR preview URLs as the default cadence.

**Audience:** the operator who owns the Vercel project for the team's Atelier deployment (typically the same person who ran `docs/user/tutorials/first-deploy.md` to land the initial deploy).

**Time to complete:** 2-5 minutes (one Vercel UI toggle + a verification push).

---

## Why enable auto-deploy

The empirical M6-entry deploy (per ADR-046) used manual `vercel deploy --prod` because the substrate was still iterating substrate-fix-class regressions under operator supervision. Once the substrate stabilizes (post-M6 / start of M7), the manual cadence becomes the bottleneck — every PR merge needs a separate operator action before the live deploy reflects it.

Git auto-deploy collapses that step. Vercel's git integration (free; included with every Vercel project linked to a GitHub remote) does two things:

1. **Push-to-main → fresh production deploy.** Every commit on `main` triggers a build; on success, the deploy is promoted to the production URL.
2. **Per-PR preview deploys.** Every PR opened against `main` gets its own preview URL (`<project>-<branch-hash>.vercel.app`). Reviewers can exercise the substrate against the PR's code before merge.

For the M7 hardening cycle, the per-PR preview URL is load-bearing: every PR's substrate changes can be validated against a real cloud deploy before merge, catching the substrate-vs-real-client divergence class earlier than smoke-only validation does.

---

## Pre-requisites

- The Vercel project is linked to your GitHub repo (Project Settings → Git → "Connected Git Repository" shows the repo path). If not, link it via the Vercel dashboard's "Connect Git" flow before continuing.
- You have **Owner** or **Member** role on the Vercel project (Project Settings access required).
- Branch protection on `main` (if enabled in GitHub Settings → Branches) does not block Vercel's deploy bot. Vercel deploys on the post-merge state, not as a PR check.

---

## Step 1: Verify auto-deploy isn't already on

Vercel projects created via the standard flow have auto-deploy enabled by default. Check before changing anything:

1. Open the Vercel dashboard → your project.
2. **Settings → Git.**
3. Look for the **Production Branch** section.

The "Production Branch" field should show `main`. If it does AND the toggle next to it labeled "Automatically deploy this branch on push" (or similar — Vercel UI labels evolve) is **on**, you're already done. Skip to Step 4.

If the toggle is off, OR if there's no production branch configured, continue to Step 2.

---

## Step 2: Enable production branch auto-deploy

In Project Settings → Git → Production Branch:

1. Set the production branch to `main` (or your team's chosen production branch — `main` is the convention for the Atelier reference impl).
2. Enable the auto-deploy toggle.
3. Save.

The change applies immediately. The next push to `main` will trigger a deploy.

---

## Step 3: Confirm preview deploys are enabled

Per-PR preview deploys are a separate toggle from production auto-deploy. In the same Settings → Git panel:

1. Find **Deployment Type** (or "Preview Deployments" in some Vercel UI versions).
2. Confirm it's set to **All** (deploys for both production branch + every other branch's PR opens).

Alternative shapes:
- **Production-only** → no preview URLs per PR; only main-branch pushes deploy. Useful when adopters want strict gating but loses the per-PR validation surface for M7-style hardening.
- **None** → all auto-deploys disabled; manual `vercel deploy --prod` is the only path. Reverts to the M6-entry default.

For the M7 reference deployment cadence, **All** is the recommended setting.

---

## Step 4: Verify auto-deploy fires

Push a tiny commit to `main` (e.g., a docs fix) and watch:

```bash
git commit --allow-empty -m "chore: verify Vercel auto-deploy"
git push origin main
```

Within ~5-15 seconds:

1. The Vercel dashboard's **Deployments** tab shows a new deployment in `Building` state.
2. The build completes in 60-120 seconds (per the empirical M6-deploy timing in ADR-046).
3. The new deployment promotes to the production URL automatically (no manual "Promote to Production" click needed).

If the deployment doesn't appear within 30 seconds, check:
- GitHub side: GitHub repo Settings → Webhooks → Vercel webhook should show recent successful deliveries
- Vercel side: Project Settings → Git → "Connected Git Repository" should show your repo path
- Build logs (Vercel Deployments → click the failed run): look for `next build` errors

---

## Step 5: Verify per-PR preview deploys fire

Open a PR against `main` (any small change works). Within ~10-20 seconds of PR open:

1. The PR shows a Vercel comment with the preview URL (e.g., `https://atelier-three-coral-pr-42-<hash>.vercel.app`).
2. Clicking the URL shows the substrate at the PR's commit.
3. Subsequent commits to the PR branch trigger fresh preview deploys; the comment URL updates in place.

If no Vercel comment appears, check:
- GitHub side: PR repo Settings → Integrations & services → Vercel app should show as connected
- Vercel side: Project Settings → Git → "Deployment Type" should be `All` (not `Production-only`)

---

## Operational notes

**Branch protection interaction.** If `main` is protected (GitHub Settings → Branches → Protection rules), Vercel still deploys on PR open + merge. Preview deploys don't gate on branch protection — they fire on PR-open events directly. The production deploy on merge fires after main moves; Vercel reads the post-merge state.

**Build cache.** Vercel reuses the previous build's `.next` cache by default, dropping subsequent build times to 30-60 seconds. Verify the cache is enabled at Project Settings → Build & Development → "Use latest Build Cache" (default on).

**Concurrent builds.** Free tier supports 1 concurrent build; Pro supports 12. If two PR opens hit Vercel within seconds, the second queues. For M7 hardening cadence (one team, low PR rate), Free is fine; for adopters with high PR concurrency, upgrade.

**Rollback.** Auto-deploy doesn't change rollback semantics. To roll back a bad production deploy:

1. Vercel dashboard → Deployments
2. Find the previous green deploy
3. Click the `...` menu → "Promote to Production"

This atomically swaps the production URL to point at the older build. Rollback is sub-second; no GitHub interaction required.

**Disable auto-deploy temporarily.** If a substrate regression lands and you need to halt production while you investigate, flip the toggle from Step 2 off. Manual `vercel deploy --prod` remains available; auto-deploy stops firing on push. Re-enable when the regression is fixed and a known-good commit is on `main`.

---

## What this changes for adopters

After enabling:

- **Adopters** clone the Atelier template, follow `first-deploy.md` to land the initial deploy, then enable auto-deploy via this guide. Subsequent maintenance is `git push` only; no operator-driven deploy step.
- **The build team** (you, while developing Atelier itself) gets per-PR preview URLs for free. Each substrate-touching PR can be exercised against a real cloud deploy before merge.
- **CI/CD wiring evolution** (per ADR-046's "operational debt accepted" section) — manual `vercel deploy --prod` is no longer the default. The `vercel.json` config + GitHub remote + Vercel project linkage form the canonical CI/CD pipeline. No additional GitHub Actions workflow needed for deploy (Vercel handles it).

---

## Cross-references

- ADR-046 — deploy strategy (Vercel + Supabase Cloud + rootDirectory=prototype + URL split inheritance); this guide enables the auto-deploy operational debt item documented there
- `docs/user/tutorials/first-deploy.md` — the initial deploy runbook this guide builds on
- ADR-027 — reference implementation stack (Vercel as the hosting choice)
- ADR-029 — GCP-portability constraint (auto-deploy is Vercel-specific operational tooling; equivalent on Cloud Run is Cloud Build triggers, documented separately when an adopter migrates)
- BRD-OPEN-QUESTIONS §28 (resolved 2026-05-02 via ADR-046; this guide closes the "operational debt: manual vercel deploy --prod is operator-driven by default" item)
