/**
 * Template for `apps/server/wrangler.jsonc`. Deployment identity (ids, hosts,
 * resource names) comes from the resolved deploy config — the `KEYS` registry
 * in `scripts/deploy-config.ts`. Product knobs that are the same for every
 * deployment stay literal here.
 *
 * Edit this file to change the SHAPE of the config; edit `.env.deploy` to
 * change the VALUES for your own instance. Run `bun run config:gen` to render.
 */
import type { DeployConfig } from "../../scripts/deploy-config";

const routes = (config: DeployConfig): readonly Record<string, string>[] => {
  // No zone means no custom domain: the worker is reachable on *.workers.dev
  // only, and route entries would be rejected at deploy time.
  if (config.zoneId.length === 0) {
    return [];
  }
  const paths = ["/api/*", "/manifest/*", "/register-device/*", "/docs", "/openapi.json"];
  const appRoutes = paths.map((suffix) => ({
    pattern: `${config.appHost}${suffix}`,
    zone_id: config.zoneId,
  }));
  // The vault UI lives on its own origin and calls the API same-origin, so
  // /api/* there routes to this worker too (more specific than the web
  // worker's catch-all).
  const vaultRoutes =
    config.vaultHost.length === 0
      ? []
      : [{ pattern: `${config.vaultHost}/api/*`, zone_id: config.zoneId }];
  return [...appRoutes, ...vaultRoutes];
};

export const serverWranglerConfig = (config: DeployConfig): Record<string, unknown> => ({
  $schema: "./node_modules/wrangler/config-schema.json",
  name: config.serverWorkerName,
  compatibility_flags: ["nodejs_compat"],
  compatibility_date: "2026-07-04",
  main: "src/index.ts",
  // Workers Cache: an HTTP cache in FRONT of the fetch handler — hits return
  // without invoking the Worker (no CPU billed, no D1/R2 touched). Opt-in per
  // response: only GET/HEAD responses with a cacheable Cache-Control are
  // stored; `private`/`no-store`/`Set-Cookie` bypass, and src/index.ts stamps
  // `no-store` on anything that says nothing. Today only full OTA bundles
  // (public, immutable) and /api/config (max-age=60) opt in.
  // `cross_version_cache` keeps entries across deploys: full bundles are
  // content-addressed by hash so a new Worker version never changes their
  // bytes, and flushing them on every release would re-pay a cold R2 read per
  // bundle per colo. Escape hatch: ctx.cache.purge({ purgeEverything: true }).
  cache: { enabled: true, cross_version_cache: true },
  observability: { enabled: true },
  d1_databases: [
    {
      binding: "DB",
      database_name: config.d1DatabaseName,
      database_id: config.d1DatabaseId,
      migrations_dir: "migrations",
    },
  ],
  kv_namespaces: [
    { binding: "SESSION_KV", id: config.kvSessionId },
    { binding: "BUILD_RESERVATIONS", id: config.kvBuildReservationsId },
  ],
  r2_buckets: [
    {
      binding: "ASSETS_BUCKET",
      bucket_name: config.r2AssetsBucket,
      preview_bucket_name: `${config.r2AssetsBucket}-e2e`,
      remote: true,
    },
    {
      binding: "BUILD_BUCKET",
      bucket_name: config.r2BuildsBucket,
      preview_bucket_name: `${config.r2BuildsBucket}-e2e`,
      remote: true,
    },
    {
      // Binding name intentionally generic: this bucket stores Apple, Android,
      // and Google credential artifacts. The binding is the source of truth in
      // code, so the physical bucket may be named anything.
      binding: "CREDENTIAL_ARTIFACTS",
      bucket_name: config.r2CredentialsBucket,
      preview_bucket_name: `${config.r2CredentialsBucket}-e2e`,
      remote: true,
    },
  ],
  // Two datasets, because the two event shapes have nothing in common and
  // Analytics Engine cannot JOIN or UNION across a dataset boundary — mixing
  // them would force every existing `update_events` query to grow a
  // discriminator filter. ANALYTICS = manifest checks (did a device ask, what
  // did it get); DELIVERY_ANALYTICS = bundle downloads (what actually went over
  // the wire, patch or full, how many bytes).
  analytics_engine_datasets: [
    { binding: "ANALYTICS", dataset: config.analyticsDataset },
    { binding: "DELIVERY_ANALYTICS", dataset: config.deliveryAnalyticsDataset },
  ],
  send_email: [{ name: "EMAIL", allowed_sender_addresses: [config.emailSender] }],
  durable_objects: {
    bindings: [
      { name: "PUBLISH_COORDINATOR", class_name: "PublishCoordinator" },
      { name: "CREATE_BRANCH_COORDINATOR", class_name: "CreateBranchCoordinator" },
    ],
  },
  migrations: [
    { tag: "v1", new_sqlite_classes: ["PublishCoordinator", "CreateBranchCoordinator"] },
  ],
  triggers: { crons: ["0 3 * * *"] },
  vars: {
    ACCOUNT_ID: config.accountId,
    // The bindings above name the datasets for WRITES; the SQL API takes the
    // dataset as a table name, so reads need the names as values too. An
    // instance that renames a dataset must not end up writing to one table and
    // querying another.
    ANALYTICS_DATASET: config.analyticsDataset,
    DELIVERY_ANALYTICS_DATASET: config.deliveryAnalyticsDataset,
    ASSETS_BUCKET_NAME: config.r2AssetsBucket,
    BUILD_BUCKET_NAME: config.r2BuildsBucket,
    BUILD_RETENTION_PRODUCTION: "90",
    BUILD_RETENTION_PREVIEW: "30",
    BUILD_RETENTION_DEVELOPMENT: "7",
    UPDATE_RETENTION_DAYS: "90",
    PATCH_RETENTION_DAYS: "30",
    // Opt-in RFC-3229 `226 IM Used` for bsdiff patch responses. Default "false":
    // 200 is the safe default (some non-delta-aware proxy caches mishandle 226;
    // the device accepts both). Set "true" to emit a true 226 for patches.
    EMIT_HTTP_226: "false",
    // Remote killswitch: the CLI may run only if its version is STRICTLY newer
    // than this value. It fetches this from `/api/config` at startup and
    // HARD-BLOCKS (exits non-zero) when its version is <= this — so to force an
    // upgrade after a release, set this to the version you want to retire (that
    // version and everything older are blocked). "0.0.0" blocks nothing.
    // 0.75.0 and older mis-file every macOS signing certificate. They send no
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
    REQUIRE_CLI_VERSION_ABOVE: "0.75.0",
    ENVIRONMENT: "production",
    // Comma-separated allowlist of superadmin emails. A user signing in with a
    // matching email is auto-promoted (global role "admin" + approved) on
    // first login and can approve other users from the dashboard; everyone
    // else starts unapproved.
    SUPERADMIN_EMAILS: config.superadminEmails,
    // Verified `From:` for invitation email — must be listed in send_email
    // above and verified in Cloudflare Email Routing.
    EMAIL_SENDER_ADDRESS: config.emailSender,
    BETTER_AUTH_URL: config.appUrl,
    PUBLIC_API_URL: config.appUrl,
    ASSET_CDN_URL: config.assetCdnUrl,
    GITHUB_CLIENT_ID: config.githubClientId,
    // Non-secret Google OAuth client id. Set the matching GOOGLE_CLIENT_SECRET
    // via `wrangler secret put`. Empty disables Google sign-in. Authorized
    // redirect URI: {app url}/api/auth/callback/google
    GOOGLE_CLIENT_ID: config.googleClientId,
    R2_ACCESS_KEY_ID: config.r2AccessKeyId,
  },
  ...(config.zoneId.length === 0 ? { workers_dev: true } : { routes: routes(config) }),
});
