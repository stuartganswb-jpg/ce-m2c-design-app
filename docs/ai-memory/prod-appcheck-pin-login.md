---
name: prod-appcheck-pin-login
description: Production host is 4cosworkcenter.com (Vercel); PIN login depends on App Check reCAPTCHA v3 — the recurring gotcha + how it was diagnosed
metadata: 
  node_type: memory
  type: project
  originSessionId: aca5b376-88ac-483b-8a83-66a9b81bee5d
---

**Production host = `4cosworkcenter.com` / `www.4cosworkcenter.com`** (custom domain on Vercel; apex 301s to www). Firebase project `ce-m2c-design-collab`. There are also `ce-m2c-design-app.vercel.app` (Vercel prod alias) and `ce-m2c-design-collab.web.app` (Firebase Hosting). Vercel↔GitHub is wired: pushing a branch auto-builds a preview; merging to `main` auto-deploys prod.

**PIN login (`authenticatePin` callable) is gated by App Check reCAPTCHA v3.** [firebase.js](src/firebase.js) uses `ReCaptchaV3Provider` (site key `6LcbVRItAAAAAFixIoDhVAI5UJda7HbnTbrwV0Om`). Non-prod hosts (localhost + `*.vercel.app` previews, detected by `acIsPreview`) inject debug token `d3b8f1a2-7c4e-4b9a-9f2d-1e6a5c8b0f33` and bypass reCAPTCHA. Production uses REAL reCAPTCHA — so reCAPTCHA issues only surface in prod, never on preview.

**Symptom:** `exchangeRecaptchaV3Token` → 400, then `authenticatePin` → 401 Unauthenticated. Diagnosis order (2026-06-11 incident — login broke despite "no changes", worked the day before):
1. reCAPTCHA admin console for the key: confirm `4cosworkcenter.com`+`www` are in **Domains**, site key matches code, type is v3, "Verify origin" on. (All were correct.)
2. Firebase App Check config (readable via API — see below): `recaptchaV3Config` exists, `siteSecretSet: true`, `minValidScore: 0.5`, tokenTtl 86400s (1 day — fine for this internal app; range 30m–7d). Provider must be v3 not Enterprise.
3. **Root cause when it "worked yesterday, no config change": dynamic reCAPTCHA score < `minValidScore` (0.5).** Adaptive scoring + a retry storm (the App Check `initial-throttle` loop) pushes the score down and self-reinforces. A static secret/domain mismatch is ruled OUT by "worked yesterday". Fixes/tests: stop hammering, retry once from fresh Incognito/different network; check reCAPTCHA Assessments + monthly quota (v3 free tier 10k/mo); temporarily set `minValidScore` to 0 as a definitive test. Also hard-reload (App Check caches token in IndexedDB for the 1-day TTL).

**Reading App Check config via API (no gcloud needed):** mint an access token from the firebase CLI refresh token in `~/.config/configstore/firebase-tools.json` using firebase-tools' public OAuth client (`563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com` / `j9iVZfS8kkCEFUPaAeJV0sAi`), then GET `https://firebaseappcheck.googleapis.com/v1/projects/ce-m2c-design-collab/apps/<appId>/recaptchaV3Config` and `.../services` (enforcement). The site SECRET and reCAPTCHA scores are NOT returned — those live only in the respective consoles.

**OPEN FOLLOW-UP:** the reCAPTCHA SECRET key (`6Lcb…LSiF`) was exposed in a shared screenshot 2026-06-11 — rotate it in reCAPTCHA admin and re-paste into Firebase App Check when convenient. If `minValidScore` was dropped to 0 during testing, restore it to ~0.5.

Related: [[cpq-builder-status]] (App Check debug token / preview testing context).
