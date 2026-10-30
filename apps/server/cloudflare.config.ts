/**
 * The server Worker's configuration, read by `cf` (dev/build/deploy, types),
 * the Cloudflare Vite plugin, `@cloudflare/vitest-plugin` and the e2e test
 * harness. Deployment identity (ids, hosts, resource names) is resolved at
 * load time by `@better-update/deploy-config` from `BU_*` environment
 * variables (CI/CD), else the untracked `.env.deploy`; product knobs that are
 * the same for every deployment stay literal here.
 */
import { loadDeployConfig } from "@better-update/deploy-config";
import { bindings, defineConfig, exports, triggers } from "cf/config";

import type { DeployConfig } from "@better-update/deploy-config";

// The `cf-worker` attribute hands the config the Worker module's TYPE (its
// exports and Durable Object classes) without running it, so the generated
// types can type `exports` from "cloudflare:workers".
// eslint-disable-next-line import/no-namespace -- `cf-worker` imports are module namespaces by definition
import * as entrypoint from "./src/index" with { type: "cf-worker" };

// /feeds/* are the public desktop update feeds installed apps poll.
const APP_PATHS = [
  "/api/*",
  "/manifest/*",
  "/feeds/*",
  "/register-device/*",
  "/docs",
  "/openapi.json",
] as const;

const routes = (config: DeployConfig) => {
  // No zone means no custom domain: the worker is reachable on *.workers.dev
  // only, and route entries would be rejected at deploy time.
  if (config.zoneId.length === 0) {
    return [];
  }
  const appRoutes = APP_PATHS.map((suffix) =>
    triggers.fetch({ pattern: `${config.appHost}${suffix}`, zone: config.zoneId }),
  );
  // The vault UI lives on its own origin and calls the API same-origin, so
  // /api/* there routes to this worker too (more specific than the web
  // worker's catch-all).
  const vaultRoutes =
    config.vaultHost.length === 0
      ? []
      : [triggers.fetch({ pattern: `${config.vaultHost}/api/*`, zone: config.zoneId })];
  return [...appRoutes, ...vaultRoutes];
};

export default defineConfig(({ mode }) => {
  const config = loadDeployConfig();
  // Only a production build talks to the real buckets. Development and tests
  // use the `*-e2e` buckets (what `preview_bucket_name` selected under
  // Wrangler): `remote: true` below only takes effect where remote bindings
  // are enabled, i.e. the R2 e2e suite, which must never touch production data.
  const bucket = (name: string): string => (mode === "production" ? name : `${name}-e2e`);
  // `vite dev` takes local values from `.env` / `.env.local` (or the process
  // env), but the Cloudflare Vite plugin loads only names declared as secrets.
  // So in development every value a developer supplies is declared as one: the
  // secrets, and the deploy values local dev replaces (its own origin, OAuth
  // apps, R2 key). Deploys declare none — they keep whatever `wrangler secret
  // put` set on the Worker, and an instance that never enables a feature never
  // has to set its secret. Tests pass their own values.
  const dev = mode === "development";
  const local = (deployValue: string) => (dev ? bindings.secret() : bindings.text(deployValue));
  const localOnly = () => (dev ? bindings.secret() : undefined);

  return {
    accountId: config.accountId,
    worker: {
      name: config.serverWorkerName,
      // The newest date the bundled workerd supports. Node.js compatibility has
      // been on by default since 2026-08-04, so it needs no flag.
      compatibilityDate: "2026-10-23",
      entrypoint,
      // Workers Cache: an HTTP cache in FRONT of the fetch handler — hits return
      // without invoking the Worker (no CPU billed, no D1/R2 touched). Opt-in per
      // response: only GET/HEAD responses with a cacheable Cache-Control are
      // stored; `private`/`no-store`/`Set-Cookie` bypass, and src/index.ts stamps
      // `no-store` on anything that says nothing. Today only full OTA bundles
      // (public, immutable) and /api/config (max-age=60) opt in.
      // `crossVersionCache` keeps entries across deploys: full bundles are
      // content-addressed by hash so a new Worker version never changes their
      // bytes, and flushing them on every release would re-pay a cold R2 read per
      // bundle per colo. Escape hatch: ctx.cache.purge({ purgeEverything: true }).
      cache: { enabled: true, crossVersionCache: true },
      observability: { enabled: true, issues: { enabled: true } },
      // Same default Wrangler applied: workers.dev only when there are no routes.
      workersDev: config.zoneId.length === 0,
      triggers: [...routes(config), triggers.scheduled({ schedule: "0 3 * * *" })],
      // Both coordinators were created with `new_sqlite_classes` (Wrangler
      // migration tag v1); this map replaces that migration history. The
      // Worker reaches them through `exports` from "cloudflare:workers"
      // (loopback bindings), so they need no `env` binding.
      exports: {
        PublishCoordinator: exports.durableObject({ storage: "sqlite" }),
        CreateBranchCoordinator: exports.durableObject({ storage: "sqlite" }),
      },
      env: {
        // D1 migrations live in ./migrations — `cf d1 migrations apply` takes
        // the directory as a flag (see scripts/d1-migrate.ts).
        DB: bindings.d1({ name: config.d1DatabaseName, id: config.d1DatabaseId }),
        SESSION_KV: bindings.kv({ id: config.kvSessionId }),
        BUILD_RESERVATIONS: bindings.kv({ id: config.kvBuildReservationsId }),
        ASSETS_BUCKET: bindings.r2({ name: bucket(config.r2AssetsBucket), dev: { remote: true } }),
        BUILD_BUCKET: bindings.r2({ name: bucket(config.r2BuildsBucket), dev: { remote: true } }),
        // Binding name intentionally generic: this bucket stores Apple, Android,
        // and Google credential artifacts. The binding is the source of truth in
        // code, so the physical bucket may be named anything.
        CREDENTIAL_ARTIFACTS: bindings.r2({
          name: bucket(config.r2CredentialsBucket),
          dev: { remote: true },
        }),
        // One dataset per event shape, because the shapes have nothing in common
        // and Analytics Engine cannot JOIN or UNION across a dataset boundary —
        // mixing them would force every existing `update_events` query to grow a
        // discriminator filter. ANALYTICS = manifest checks (did a device ask,
        // what did it get); DELIVERY_ANALYTICS = bundle downloads (what actually
        // went over the wire, patch or full, how many bytes); DESKTOP_ANALYTICS =
        // desktop feed checks and downloads (Sparkle, WinSparkle,
        // electron-updater, Tauri).
        ANALYTICS: bindings.analyticsEngineDataset({ name: config.analyticsDataset }),
        DELIVERY_ANALYTICS: bindings.analyticsEngineDataset({
          name: config.deliveryAnalyticsDataset,
        }),
        DESKTOP_ANALYTICS: bindings.analyticsEngineDataset({
          name: config.desktopAnalyticsDataset,
        }),
        EMAIL: bindings.sendEmail({ allowedSenderAddresses: [config.emailSender] }),
        ACCOUNT_ID: bindings.text(config.accountId),
        // The bindings above name the datasets for WRITES; the SQL API takes the
        // dataset as a table name, so reads need the names as values too. An
        // instance that renames a dataset must not end up writing to one table
        // and querying another.
        ANALYTICS_DATASET: bindings.text(config.analyticsDataset),
        DELIVERY_ANALYTICS_DATASET: bindings.text(config.deliveryAnalyticsDataset),
        DESKTOP_ANALYTICS_DATASET: bindings.text(config.desktopAnalyticsDataset),
        // The S3 API (presigned URLs) addresses buckets by name, so these follow
        // the bindings above: a local server must never presign into production.
        ASSETS_BUCKET_NAME: bindings.text(bucket(config.r2AssetsBucket)),
        BUILD_BUCKET_NAME: bindings.text(bucket(config.r2BuildsBucket)),
        BUILD_RETENTION_PRODUCTION: bindings.text("90"),
        BUILD_RETENTION_PREVIEW: bindings.text("30"),
        BUILD_RETENTION_DEVELOPMENT: bindings.text("7"),
        UPDATE_RETENTION_DAYS: bindings.text("90"),
        PATCH_RETENTION_DAYS: bindings.text("30"),
        // Opt-in RFC-3229 `226 IM Used` for bsdiff patch responses. Default
        // "false": 200 is the safe default (some non-delta-aware proxy caches
        // mishandle 226; the device accepts both). Set "true" to emit a true 226.
        EMIT_HTTP_226: bindings.text("false"),
        // Remote killswitch: the CLI may run only if its version is STRICTLY newer
        // than this value. It fetches this from `/api/config` at startup and
        // HARD-BLOCKS (exits non-zero) when its version is <= this — so to force an
        // upgrade after a release, set this to the version you want to retire (that
        // version and everything older are blocked). "0.0.0" blocks nothing.
        // 0.80.2 and older cannot decode the macOS Developer ID builds this server
        // now stores (platform `macos`, distribution `developer-id`, `dmg` / `zip`
        // / `pkg` / `tar.gz` artifacts, `DEVELOPER_ID` provisioning profiles): any
        // build or profile list containing one fails to decode in them.
        // 0.77.3 and older upload an Android App Bundle build bare: no universal
        // APK beside it, so the dashboard's Install link, `builds run` and QA have
        // nothing a device can install — an `.aab` is Play-only. The APK must be
        // built by the CLI (same Gradle run, same upload key); the server cannot
        // derive it because the keystore is sealed in the zero-knowledge vault.
        // (0.75.0 and older mis-file every macOS signing certificate. They send no
        // certificate kind at all and never read the `UID` subject attribute that
        // identifies a Developer ID certificate (node-forge has no name for that
        // OID, so the lookup silently found nothing), so a Developer ID or Mac App
        // Store `.p12` is stored as an iOS distribution certificate: `macos sign`
        // cannot find it again, and it can be bound to an iOS bundle configuration
        // where the build only fails at codesign. The server cannot repair this
        // afterwards — only the CLI ever sees the certificate bytes.
        //
        // (0.72.0 and older cache the unlocked vault key in the OS keychain under the
        // device's age public key alone. That key is USER-scoped and shared by every
        // org the user belongs to, while each org has its own vault key — so for up
        // to the 15-minute TTL a command run against org B can be handed org A's
        // key. Reads fail with a misleading "rotated or revoked"; WRITES are worse,
        // because the server compares only the vault version NUMBER and cannot see
        // plaintext, so a credential sealed with the wrong org's key at a matching
        // version is accepted and is undecryptable by anyone, forever. Only affects
        // multi-org humans (CI robots are never cached), which is why it survived
        // this long — and why it has to be a hard block rather than a warning.
        //
        // 0.71.7 and older never read the Android upload keystore's signing
        // certificate beyond its SHA-1/SHA-256: no expiry and no MD5, which the
        // server cannot recover because only the CLI ever sees keystore bytes.
        // Uploads from those versions are now rejected outright by the required
        // `validUntil`. 0.71.6 and older additionally name the publish destination
        // by Expo `slug` alone and can publish into a SIBLING project in the same
        // org, reported as success. 0.71.4 and older never baked
        // `expo-channel-name` or a runtimeVersion into non-Expo builds, so their
        // updates published green and reached nobody. All covered by this bound.)
        REQUIRE_CLI_VERSION_ABOVE: bindings.text("0.80.2"),
        ENVIRONMENT: bindings.text("production"),
        // Comma-separated allowlist of superadmin emails. A user signing in with
        // a matching email is auto-promoted (global role "admin" + approved) on
        // first login and can approve other users from the dashboard; everyone
        // else starts unapproved.
        SUPERADMIN_EMAILS: bindings.text(config.superadminEmails),
        // Verified `From:` for invitation email — must be allowed by EMAIL above
        // and verified in Cloudflare Email Routing.
        EMAIL_SENDER_ADDRESS: bindings.text(config.emailSender),
        BETTER_AUTH_URL: local(config.appUrl),
        PUBLIC_API_URL: local(config.appUrl),
        ASSET_CDN_URL: local(config.assetCdnUrl),
        GITHUB_CLIENT_ID: local(config.githubClientId),
        // Non-secret Google OAuth client id. Set the matching GOOGLE_CLIENT_SECRET
        // as a Worker secret. Empty disables Google sign-in. Authorized redirect
        // URI: {app url}/api/auth/callback/google
        GOOGLE_CLIENT_ID: local(config.googleClientId),
        R2_ACCESS_KEY_ID: local(config.r2AccessKeyId),
        // Secrets (typed in src/env.d.ts) and local-only switches.
        BETTER_AUTH_SECRET: localOnly(),
        R2_SECRET_ACCESS_KEY: localOnly(),
        INSTALL_TOKEN_SECRET: localOnly(),
        APT_SIGNING_SECRET: localOnly(),
        GITHUB_CLIENT_SECRET: localOnly(),
        GOOGLE_CLIENT_SECRET: localOnly(),
        CLOUDFLARE_API_TOKEN: localOnly(),
        TEST_MODE: localOnly(),
        WEBAUTHN_RP_ID: localOnly(),
        WEBAUTHN_RP_NAME: localOnly(),
        WEBAUTHN_ORIGINS: localOnly(),
        WEBAUTHN_COOKIE_DOMAIN: localOnly(),
      },
    },
  };
});
