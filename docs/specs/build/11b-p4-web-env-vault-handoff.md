# P4 — Web env-vault: implementation status & go-live handoff

Companion to `11-two-vault-split-and-web-env-crud.md`. Records exactly what P4 code
is built + verified, what remains (browser/device/DNS-gated), and the steps only an
operator can do before enabling web env CRUD in prod.

## Status at a glance

| Layer                                                                           | State                                                                |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| P4.1 server passkey plugin (flag-gated) + auth-client `passkeyClient()`         | **DONE, green**                                                      |
| P4.2 migration `0072_passkey_webauthn.sql` (`passkey` + `passkey_step_up`)      | **DONE, green**                                                      |
| P4.3 WebAuthn step-up gate (repo + gate + `POST /api/web-vault/step-up`)        | **DONE, green**                                                      |
| P4.4 shared browser-safe env-value crypto (`credentials-crypto/env-value.ts`)   | **DONE, green**                                                      |
| P4.5 reveal endpoint (`GET /api/env-vars/:id/value`) + api-client CRUD bindings | **DONE, green**                                                      |
| P4.6a browser unlock lib + unlock/escrow/step-up bindings                       | **DONE, green (typecheck only)**                                     |
| P4.6b passkey step-up CEREMONY wiring (browser)                                 | **DONE, green (typecheck+unit; needs on-device)**                    |
| P4.6c coss UI (unlock dialog, reveal/create/edit/delete)                        | **DONE, green (typecheck+unit; needs on-device)**                    |
| P4.6d vault-origin routing (`/api/*` + web) + `trustedOrigins`                  | **DONE in config (applies on deploy)**                               |
| P4.6d CSP on the vault origin                                                   | **Report-Only LIVE; flip to enforce at go-live after browser check** |
| P4.7 go-live                                                                    | **this doc**                                                         |

Verified: `bun run lint` (15/15 packages, lint+typecheck) green; web unit/component
160/160; server unit 535/535; `credentials-crypto` 33 (incl. 6 `env-value`). THREE
adversarial-review rounds (the third, 19 agents, reviewed the P4.6b–d UI + ceremony +
config and confirmed 10 findings — all fixed below). What remains is genuinely
unverifiable without a real browser + passkey authenticator + the go-live DNS/CSP
steps; those are called out explicitly.

## Prod-safety invariant (verified)

With `WEBAUTHN_RP_ID` unset — the prod default today — the passkey plugin is **not**
registered: no `/api/auth/passkey/*` routes, the auth surface is byte-identical to
before P4. Migration 0072 is purely additive (two new empty tables, no drops). The
step-up gate fires only for `transport: "cookie"` callers; the CLI (bearer/api-key)
is exempt by construction, and no browser caller mutates env vars today. So **all of
P4.1–P4.6a is already deployable with zero behaviour change** until the flag is set.

## What's built (files)

Server:

- `apps/server/src/auth.ts` — `passkey()` plugin spread in only when `WEBAUTHN_RP_ID` set; `PASSKEY_PLUGIN_SCHEMA` snake_case map; `WEBAUTHN_RP_ID|RP_NAME|ORIGINS` env.
- `apps/server/migrations/0072_passkey_webauthn.sql` — `passkey`, `passkey_step_up`.
- `apps/server/src/repositories/passkey-step-up.ts` — upsert/read step-up by session id.
- `apps/server/src/application/assert-web-env-step-up.ts` (+ test) — the gate (cookie-only, 10-min TTL, fail-closed).
- `apps/server/src/handlers/web-vault.ts` — `POST /api/web-vault/step-up`: verifies the assertion via `verifyPasskeyAuthentication`, **asserts the verified user == session user**, records step-up.
- `apps/server/src/handlers/env-vars.ts` — gate wired into create/update/delete/rollback/bulkImport + `getValue` reveal (returns `vaultKind` derived from cutover state).
- `apps/server/src/handlers/account-keys.ts` — `getMe` + `reseal` step-up-gated for cookie.
- `apps/server/src/repositories/env-vars.ts` — `findCurrentValue` (reveal envelope).
- `apps/server/src/auth/middleware.ts` + `models.ts` + `packages/api/src/auth/context.ts` — `sessionId` surfaced into `AuthContext`.

Contract / crypto / client:

- `packages/api/src/groups/web-vault.ts` + `domain/web-vault.ts` — step-up endpoint.
- `packages/api/src/groups/env-vars.ts` — `getValue` endpoint.
- `packages/credentials-crypto/src/env-value.ts` (+ test) — `sealEnvValue`/`openEnvValue` (byte-compatible with the CLI's `envVarValue` envelope).
- `packages/auth-client/src/index.ts` — `passkeyClient()`.
- `packages/api-client/src/react/env-vars.ts` — `createEnvVar`/`updateEnvVar`/`deleteEnvVar`/`getEnvVarValue`.
- `packages/api-client/src/react/web-vault.ts` — `stepUpPasskey`/`getAccountKeyEscrow`/`getEnvVaultAccountWrap`.
- `apps/web/src/lib/env-vault/{crypto,cache,unlock}.ts` — browser unlock: `escrowToEnvelope`, `unlockEnvVault(orgId, passphrase)`, sessionStorage cache (never localStorage), `sealEnvValue`/`openEnvValue` re-export.

P4.6b–d (built 2026-06-29):

- `apps/web/src/lib/env-vault/host.ts` — `isVaultHost()` host-gate (`updates-vault.jmango360.dev` + any `*.localhost` for dev).
- `apps/web/src/lib/env-vault/step-up.ts` — `runPasskeyStepUp()`: GET better-auth `generate-authenticate-options` (credentialed) → `@simplewebauthn/browser` `startAuthentication` → POST `{ response: assertion }` to `/api/web-vault/step-up`.
- `apps/web/src/lib/env-vault/reveal.ts` — `revealEnvValue()`: `openEnvValue` with `credentialId = envelope.id` + swap-detection (compares sealed `key`/`environment` to the row), returns a typed result (no throw).
- `apps/web/src/lib/env-vault/use-env-vault.ts` — `useEnvVault(orgId)` controller (`enabled`/`unlocked`/`onUnlocked`/`lock`); render-time state-adjust (no `useEffect`, which is lint-restricted).
- `apps/web/src/routes/_authed/_app/environment-variables/-env-vault-unlock-dialog.tsx` — unlock dialog (passkey verify + passphrase + "Add a passkey" enroll).
- `…/-env-var-{reveal,edit,create,delete}-dialog.tsx` + `-env-var-row-actions.tsx` — reveal/edit/create/delete; create/edit seal with `sealEnvValue({ vaultKind:"env", vaultVersion: vault.envVaultVersion, … })`.
- `…/-env-var-row.tsx` + `-env-vars-view.tsx` — actions column + toolbar (Unlock / Add variable / **Re-verify** / Lock), host-gated; `invalidateEnvVars` predicate invalidates the global list + every project list.
- `apps/web/package.json` — added `@simplewebauthn/browser` direct dep.
- `apps/server/src/auth.ts` — flag-gated `trustedOrigins` (the vault origin) **and** flag-gated `crossSubDomainCookies` (see the P1 fix below); corrected the stale `vault.updates`/`vault.<host>` comments.
- `apps/server/wrangler.jsonc` + `apps/web/wrangler.jsonc` — durable routes: `updates-vault.jmango360.dev/api/*` → server, `updates-vault.jmango360.dev/*` → web (the API-added web route would be wiped on the next `wrangler deploy`, so it now lives in config).

## Adversarial-review fixes (all applied)

- **P1** `web-vault.ts`: `verifyPasskeyAuthentication` is a _usernameless_ sign-in (looks up the passkey globally by credential id) — it proved "some passkey signed", not "this user's". A stolen cookie could be stepped-up with the attacker's own passkey. FIX: capture the result and require `result.user.id === ctx.userId`.
- **P2** reveal: `vaultKind` was advertised but never populated → a browser defaulting to `"credentials"` would fail to decrypt post-cutover values. FIX: `revealCurrentValue` derives `vaultKind` from `isEnvVaultForked(orgVault)` and returns it (self-describing).
- **P3** `reseal` not step-up-gated (cookie clobber/DoS) → gated.
- **P3 (open)** session sprawl: each step-up's `verifyPasskeyAuthentication` mints a throwaway `SESSION_KV` row. Resource-only, no breach; revisit if the plugin exposes a no-session verify.
- **P3 (contract)** swap-detection: `openEnvValue` returns the sealed `{key,environment}` but does not compare — the web reveal caller MUST compare them against the clicked row and fail on mismatch (the CLI does this in `assertMetadataConsistent`). **Now implemented** in `lib/env-vault/reveal.ts` (`revealEnvValue`).

## Third adversarial review (2026-06-29) — confirmed findings & fixes

19-agent find→verify pass over the P4.6b–d UI, ceremony, and config. 10 confirmed
(5 dismissed as by-design/sound). Status:

- **[P1] Vault origin can't obtain a session cookie** (triple-confirmed, the real
  blocker). better-auth cookies are host-only (no `crossSubDomainCookies`), and prod
  login is OAuth-only whose callback lands host-only on `updates.jmango360.dev`. The
  vault origin (a sibling) therefore never receives the session → `_authed` redirect
  loop → the whole feature is dead-on-arrival when enabled. **FIXED:** added
  `advanced.crossSubDomainCookies` gated on a new `WEBAUTHN_COOKIE_DOMAIN` env
  (unset = host-only, byte-identical prod default). See "Session on the vault origin"
  below for the A-vs-B decision + rollout caveat.
- **[P3] Stale `vault.updates` / `vault.<host>` comments** in `auth.ts` (real host is
  the sibling `updates-vault.jmango360.dev`; rpID must be the parent `jmango360.dev`).
  **FIXED** (comments corrected).
- **[P2/P3] Client "unlocked" state outlives the 10-min server step-up**; reveal
  showed a misleading "try again" with no recovery. **FIXED:** reveal now surfaces the
  server message (`getApiError`, so a 403 reads "Verify your passkey and retry"), and
  the unlocked toolbar has a **Re-verify** button that re-runs the step-up alone (no
  passphrase re-entry — the cached vault key is still valid).
- **[P3] `invalidateEnvVars` left other projects' lists stale** after a global-var
  mutation (global vars merge into every project view). **FIXED:** predicate now
  invalidates the global list + every project env-var list for the org.

Documented, NOT changed in code (intentional — see reasoning):

- **[P2/P3] Step-up mints a throwaway 7-day session in `SESSION_KV` per verification.**
  `verifyPasskeyAuthentication` is a full usernameless sign-in (it `createSession`s);
  the handler discards the Set-Cookie so the client cookie is unchanged, but the
  orphan session persists (auto-expires at 7d; clutters the user's active-sessions
  list). Bounded, no token leak (never returned to client). Proper fix = verify the
  assertion directly with `@simplewebauthn/server` (no sign-in) or revoke
  `result.session.token` post-verify — deferred: it's a server refactor best done with
  on-device testing. Track as P3.
- **[P2] Raw vault key in sessionStorage + CSP deferred** = an XSS-on-vault-origin
  window could exfiltrate the org's env-vault key. **Mitigation is operational:**
  enforce the CSP (Report-Only → enforce) BEFORE the vault UI is reachable, not after
  (see go-live). Optional hardening: drop the cached key when the 10-min step-up TTL
  lapses (store an expiry alongside it).
- **[P3] WebAuthn config has no fail-fast validation** (wrong rpID fails only in the
  browser ceremony, not at boot). Optional: assert `WEBAUTHN_RP_ID` is a registrable
  suffix of every `WEBAUTHN_ORIGINS` entry. Low value given the comment fix.

## Session on the vault origin — the A-vs-B decision (OPERATOR/OWNER call)

The vault origin needs an authenticated session to function. Two ways:

- **A (implemented, default): shared cookie via `WEBAUTHN_COOKIE_DOMAIN=.jmango360.dev`.**
  One login on the dashboard carries to the vault origin. Simple, matches the
  already-provisioned sibling layout. **Tradeoff:** the session cookie is then sent to
  ALL first-party `*.jmango360.dev` origins (openproject, gitlab, …) — it widens
  _cookie_ scope but NOT the raw-key isolation (the env-vault key stays in the vault
  origin's sessionStorage, never shared). **Rollout caveat:** enabling it flips every
  user's cookie from host-only to `Domain=.jmango360.dev`; the old host-only cookie and
  the new domain cookie can briefly coexist → **plan a one-time forced re-login** at
  cutover. The cookie prefix is `__Secure-` (not `__Host-`), so a Domain is allowed;
  SameSite=Lax is fine (same registrable site → cookie sent on the vault origin's
  same-origin `/api/*`).
- **B (alternative, stricter, NOT built): per-origin session.** Keep cookies
  host-only; bootstrap a vault-origin session via a `oneTimeToken` handoff from the
  dashboard (or a vault-host OAuth callback). Preserves full cookie isolation (nothing
  shared with other subdomains) but needs new code + its own OAuth redirect URI.

Default is **A** (lower complexity, the core key-isolation goal is preserved). Switch
to **B** if cookie isolation across `*.jmango360.dev` is a hard requirement.

## Provisioned (prod, JMango360 account, 2026-06-29)

Already set up on the live Cloudflare account — INERT until the P4 server code deploys:

- **Vault origin** `updates-vault.jmango360.dev` (a sibling of `updates.jmango360.dev`, not a sub-subdomain — operator preference). DNS = proxied AAAA `100::` (mirrors `updates.jmango360.dev`); TLS auto-provisioned + valid. The worker routes now live in **config** (`apps/web/wrangler.jsonc` web catch-all + `apps/server/wrangler.jsonc` `/api/*`), so they survive `wrangler deploy` — the earlier dashboard-added web route would have been reconciled away on the next deploy. The origin 404s until the web worker deploys.
- **Server secrets** on `better-update-server` (Workers secrets API, no code redeploy): `WEBAUTHN_RP_ID=jmango360.dev` (registrable suffix covering BOTH `updates.jmango360.dev` and `updates-vault.jmango360.dev` — required because they're siblings), `WEBAUTHN_RP_NAME=Better Update` (cosmetic, re-tunable), `WEBAUTHN_ORIGINS=https://updates-vault.jmango360.dev,https://updates.jmango360.dev`.
- **`WEBAUTHN_COOKIE_DOMAIN=.jmango360.dev` — SET (pre-staged 2026-06-29, option A chosen).** Inert with the currently-deployed (pre-P4) server build, and the P4 code that reads it is still uncommitted, so it cannot activate accidentally. It takes effect on the **first P4 server deploy**, which therefore IS the go-live: that deploy switches every user's session cookie from host-only to `Domain=.jmango360.dev` → **a one-time forced re-login**. Announce it. (To back out of A before go-live: delete this secret → cookies stay host-only and the vault origin stays unreachable.)
- These secrets persist across `wrangler deploy` (secrets ≠ vars). They do nothing until the P4 server build is deployed.

## Go-live checklist (operator)

1. ~~DNS + worker routes for the vault origin~~ — **DONE** (DNS live; routes now in `wrangler.jsonc`, apply on deploy).
2. ~~Set `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGINS` secrets~~ — **DONE** (server worker).
3. ~~Build the vault UI (P4.6b ceremony + P4.6c screens), host-gated to `updates-vault.jmango360.dev`~~ — **DONE** (needs on-device verification, step 7).
4. ~~Decide A vs B + set `WEBAUTHN_COOKIE_DOMAIN`~~ — **DONE: A chosen, `WEBAUTHN_COOKIE_DOMAIN=.jmango360.dev` pre-staged on `better-update-server`.** Still **announce/plan the one-time re-login** — it fires on the first P4 server deploy (step 6).
5. **CSP** — **Report-Only is LIVE** (CF response-header Transform Rule, zone `e36dbf0b…`, ruleset `6dd10c461d9942a8baadc37b276cafa9`, rule `ed89d369cbc34d01b7545c1963248c11`): `default-src 'self'; base-uri 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'` on `http.host eq "updates-vault.jmango360.dev"`. **At go-live:** load the real vault UI on a browser, check the console for CSP violations (likely needs adjusting — TanStack Start injects an **inline hydration `<script>`**, so `script-src 'self'` will probably need a nonce or hash; `connect-src 'self'` assumes same-origin `/api`), tune the directives, then **rename the header `Content-Security-Policy-Report-Only` → `Content-Security-Policy` (enforce) BEFORE/with the first vault-UI deploy.**
6. Cut a release: applies migration **0072** to prod D1 + deploys server (activates the passkey plugin, step-up gate, `trustedOrigins`, and — if `WEBAUTHN_COOKIE_DOMAIN` is set — the shared cookie) + web (serves the vault origin).
7. **Real-device test on `updates-vault.jmango360.dev`**: confirm a session is present (the A/B fix works) → enroll a passkey → unlock → reveal/create/edit/delete end-to-end on a real authenticator. Verify: wrong passphrase fails; a non-recipient gets a clear error; after ~10 min the **Re-verify** button restores access; reveal of a swapped/mismatched value is rejected.
8. Per-org cutover (CLI `credentials env-vault migrate`) + each member `credentials account create` — only then does the org's env vault become browser-reachable. Sequence cutover AFTER the web UI is live (account keys are inert without it).
9. CLI version floor (P5): warn/refuse old CLIs on cutover orgs (they lose env read).

## Notes / assumptions

- Step-up exemption keys on `transport: "cookie"`. Safe only while the web app uses the httpOnly session cookie and never sends a raw `Authorization: Bearer <session>`. Do not refactor the web client to bearer.
- The host gate (`lib/env-vault/host.ts`) also enables on any `*.localhost` for local dev; it can never enable on `updates.jmango360.dev` (the main origin stays read-only). The passkey plugin is still off in dev (no `WEBAUTHN_RP_ID`), so the ceremony only fully exercises against a deployed server.
- `apps/web/src/lib/env-vault/*` is now consumed by the env-vars view, so knip no longer reports it unused.
