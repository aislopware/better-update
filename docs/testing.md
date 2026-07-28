# Autonomous self-verification

Every test tier in this repo can run **headlessly, without interactive auth** —
including the end-to-end suites. The historical "don't auto-run e2e" rule was a
proxy for three solvable problems (slowness, output buffering, a remote-R2
dependency), not a fundamental limitation. This document is the protocol an
agent (or CI, or you) follows to verify all user-facing flows end to end on
demand.

## One command

```bash
bun run verify          # full gate: lint → unit → integration → all e2e tiers
bun run verify:e2e      # only the e2e tiers
node scripts/self-verify.mjs --tiers=e2e-cli,e2e-web   # explicit subset
node scripts/self-verify.mjs --list                    # show tier ids
node scripts/self-verify.mjs --include-slow            # also run the Android tier
```

The orchestrator (`scripts/self-verify.mjs`) runs each tier, streams its full
log to `.self-verify/<tier>.log`, and writes a machine-readable
`.self-verify/summary.json`:

```json
{
  "ok": true,
  "totals": { "passed": 7, "failed": 0, "skipped": 0 },
  "results": [
    {
      "id": "e2e-server",
      "status": "passed",
      "durationMs": 103680,
      "log": ".self-verify/e2e-server.log"
    }
  ]
}
```

Exit code is non-zero iff any tier failed. `.self-verify/` is git-ignored.

## The tiers

Wall-clock figures are from one local run (Apple silicon) for rough ordering,
not a benchmark.

| id              | runtime                                           | autonomous | ≈ time      | notes                                               |
| --------------- | ------------------------------------------------- | ---------- | ----------- | --------------------------------------------------- |
| `lint`          | oxlint + tsgolint                                 | ✅ yes     | ~7s         | lint + typecheck, all packages                      |
| `unit`          | node/bun via turbo                                | ✅ yes     | ~15s        | every app + package                                 |
| `integration`   | `@cloudflare/vitest-pool-workers`, local D1/R2    | ✅ yes     | ~2m         | real worker, local bindings                         |
| `e2e-server`    | vitest-pool-workers, **local** D1/R2              | ✅ yes     | ~1m45s      | pure-API OTA flows (~440 tests); no Cloudflare auth |
| `e2e-server-r2` | vitest-pool-workers, **remote** R2 binding        | ✅ yes\*   | ~20s        | the single direct-upload checksum contract          |
| `e2e-cli`       | wrangler `createTestHarness` + real `expo export` | ✅ yes     | several min | publish / rollout / rollback / env / codesign       |
| `e2e-web`       | `createTestHarness` + vite + chromium, all local  | ✅ yes     | several min | API + browser dashboard flows                       |
| `cli-slow`      | real Android Gradle build                         | ❌ no      | minutes     | needs the Android SDK; `--include-slow` only        |

\* `e2e-server-r2` reaches the real `*-e2e` R2 bucket via an **API token** read
from `apps/server/.env.local` (`E2E_CF_ACCOUNT_ID` + `E2E_CLOUDFLARE_API_TOKEN`,
mapped by `scripts/e2e-r2.sh`) — **never an interactive `wrangler login`**. When
those vars are absent the tier is **skipped** (logged as `skipped`, not failed),
so the gate stays green on a machine without the e2e bucket configured.

### Why remote R2 for one file

`apps/server/tests/e2e/direct-upload-flow.test.ts` PUTs bytes to a presigned
`*.r2.cloudflarestorage.com` URL and asserts R2's server-side
`x-amz-checksum-sha256` enforcement (a mismatched body must 400). That checksum
contract is the one thing miniflare cannot simulate, so this file alone runs on
the `e2e-pool-r2` project with `remote: true`. Every other e2e flow seeds local
R2 directly (`seedAssetObject`) and runs fully local on `e2e-pool`. See the
header comment in `apps/server/vitest.config.ts`.

### How the out-of-process tiers boot the worker

`e2e-cli` and `e2e-web` cannot run inside workerd: the CLI under test is a real
subprocess and the browser is a real browser, so both need a listening port.
They boot the server Worker through `startServerE2EStack()`
(`apps/server/tests/helpers/e2e-harness.ts`), built on wrangler's
`createTestHarness` — the supported replacement for the deprecated
`unstable_startWorker`. Three things that API forces:

- **No on-disk storage.** The harness hardcodes `persist: false`, so D1 lives in
  the globalSetup process's memory. Seeding therefore cannot shell out to
  `wrangler d1 execute --persist-to` any more (that used to spawn one `bunx
wrangler` per seed). `startServerE2EStack` exposes a loopback **seed control
  plane** instead; `seedSql()` in both suites POSTs SQL to it and it runs
  in-process against the live binding. `seedSql` is consequently **async** —
  `await` it.
- **No `remote: true`.** Any remote binding makes the harness open a proxy
  session against the real Cloudflare account, and `listen()` hard-fails without
  credentials. The helper feeds wrangler an inline config with the flag stripped,
  so the suites stay hermetic. (`apps/*/wrangler.jsonc` itself is generated —
  never edit it.)
- **No `envFiles` opt-out.** The harness auto-loads `.env` / `.env.local` and
  those values _beat_ config `vars`, so a developer's `BETTER_AUTH_URL` used to
  leak in and make better-auth reject every Origin as `INVALID_ORIGIN`. The
  helper sets `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false` to restore the old
  `envFiles: []` behaviour.

The port is always ephemeral (`port: 0` is hardcoded), so the stack starts, reads
its own URL, then `update()`s the Worker with the URL-derived vars — `update()`
preserves both the port and the D1 contents, which `reset()` would not.

Every request that carries a cookie or a `Sec-Fetch-*` hint needs an `Origin`
header that matches better-auth's `baseURL`; both suites' helpers add it
automatically. For `e2e-cli` that origin is the Worker itself; for `e2e-web` it
is the vite dev server, because that is where its requests come from.

### Two principals in `e2e-cli`

`setupCliE2E` signs up an org **owner** and mints a **project-scoped robot**, and
which one a command runs as is load-bearing. A robot is one project + one project
role by design (GITLAB-RBAC-SPEC §1b), so it can never clear the org-admin
`ORG_RULES` (`webhook:*`, `auditLog:read`, `vaultAccess:*`) nor the v2 binding
gate for an org resource with no project binding (a team-less device). Those are
not test bugs to route around:

- whole file → `cliAuth: "user"` (runs as the owner's session token, exactly what
  `better-update login` writes to `~/.better-update/auth.json`);
- one call → merge `cli.userAuthEnv` into `runCliWithEnv`;
- vault-sealed data → `await cli.bootstrapOrgVault()` in `beforeAll`. It seals a
  device identity for the owner (`identity init` refuses an env-sourced key on
  purpose), then grants the robot both vaults, after which the robot needs no
  extra env — `BETTER_UPDATE_ROBOT` already carries its age key.

Publishes are byte-reproducible, and assets are content-addressed **globally**
(an `assets` row carries no project), so two exports of the unchanged shared
fixture collapse onto one hash across files. A test that needs a fresh upload, or
v1 content distinguishable from v2, calls `cli.stampBundleMarker(<unique>)` first;
the fixture's `bundle-marker.js` is restored in `afterAll`.

## Agent / background protocol

The e2e tiers take minutes (CLI does a real Hermes export per publish). Do **not**
foreground-block and do **not** pipe into `| tail` (it buffers indefinitely).
Instead:

1. Launch in the background, redirecting to a file:
   `bun run verify > /tmp/verify.log 2>&1 &` (or the harness background runner).
2. On completion, read `.self-verify/summary.json` for the structured verdict.
3. For any `failed` tier, read its `.self-verify/<id>.log` (or grep it) — never
   re-stream the whole thing interactively.

This is exactly how the suites are meant to be driven autonomously: a detached
process plus a result file, so wall-clock time never blocks the caller.

## Coverage

`e2e-cli` exercises the full publish→manifest→rollout→rollback lifecycle against
a real Expo export and a live worker, including:

- **code-signing auto-sign** (`update publish --private-key-path` /
  `update rollback --private-key-path`): the manifest/directive the worker serves
  is verified device-style — RSASSA PKCS1-v1_5 + SHA-256 over the exact body
  bytes against the configured certificate.
- **`update revert` router** (`revert-router.test.ts`): both `--type published`
  (republishes the _previous_ group — proven by the served launch-bundle content
  hash reverting to the prior update's) and `--type embedded` (a
  rollBackToEmbedded directive), plus the no-prior-group guard.
- **`update configure`** (`configure.test.ts`): the already-configured guard, and
  the full expo-updates surface written under `--force` — including
  `enableBsdiffPatchSupport` (default on; `--no-enable-bsdiff` flips it off), the
  device-side toggle the whole A-IM negotiation depends on.
- **bsdiff publish flags** (`publish-bsdiff-flags.test.ts`): the
  precompute-at-publish path end-to-end through the CLI + server + local R2 — a
  second publish uploads a real bsdiff patch against the prior update (the
  producer is portable and runs under bun; ~99.98% smaller than the full bundle),
  while `--no-patches` skips the phase and `--patch-base-window 0` diffs the
  embedded baseline only. This is genuine patch _production_, not the hand-seeded
  patch bytes of the integration suite.
- **resource lifecycles via the CLI surface** — `channels-lifecycle`,
  `branches-lifecycle`, `webhooks-lifecycle`, `devices-lifecycle`: each drives the
  full create → list → view → update → … → delete journey in both `--json`
  envelope and human modes, including the guard branches (Conflict on duplicate
  channel/branch names, exit-2 client-side validation, NotFound). These exercise
  the citty argv layer the unit tests can't reach. Note these projects start with
  the auto-seeded default channels/branches (`production`/`staging`/`preview`), so
  the tests operate on fresh names.
- **diagnostics** (`diagnostics.test.ts`): `whoami` / `doctor` / `projects list` /
  `audit-logs list` / `logout`, plus the not-linked guards. (`login` is a browser
  OAuth flow — intentionally out of e2e reach.)
- **fingerprint** (`fingerprint.test.ts`): `fingerprint generate` (real
  `@expo/fingerprint` over the fixture, plain + `--platform`) and `compare`
  (positional-hash vs local; server build-vs-build). Caught two
  committed-but-never-run product bugs — see below.
- **analytics** (`analytics.test.ts`): the read-only analytics reports.

`e2e-web` drives the dashboard in a real browser. `e2e-server` covers manifest
resolution, bundle/patch negotiation, signing-policy 204s, the reaper, scopeKey
isolation, env-var delivery, and the webhooks + fingerprints management endpoints
(`webhooks-flow`, `fingerprints-flow`); `integration` adds the build-artifact
reaper (`build-gc`, per-profile TTL retention).

### Committed-but-never-run bugs this suite caught

e2e is not in CI, so real bugs ride in unexercised until a suite like this runs.
The fingerprint file alone surfaced two:

- **`fingerprint generate --platform` was broken on `@expo/fingerprint` ≥ 0.13.**
  The CLI shelled out to the bare `@expo/fingerprint <root> --platform …`, but
  that form routes to the legacy CLI, which treats the flags as positional
  fingerprint-files-to-diff and errors. Fixed to use the `fingerprint:generate`
  subcommand (byte-identical hash for the no-flag case; correct EAS-parity for the
  per-platform path that feeds the fingerprint-policy runtimeVersion).
- **`fingerprint compare --build-id a --build-id b` silently compared only the
  last id.** citty does not collect a repeated `type:"string"` flag into an
  array — it keeps the last value — so the documented "repeatable" multi-id
  compare never worked. Fixed to accept a single comma-separated flag
  (`--build-id a,b`), matching the `--events` idiom on `webhooks create`.

Genuinely out of autonomous reach (documented, not a gap to silently skip):

- **`cli-slow`** — a real Android Gradle build needs the Android SDK/toolchain.
- On-device verification of a published OTA against a real SDK-56 device
  (use the `agent-device` skill); the e2e suites verify the wire contract, not
  the device runtime.

### Resolved: the `e2e-web` dev-proxy failure

`e2e-web` used to fail headlessly — every request returned `# SERVER_ERROR:
internal error … { remote: true }`, later a `502 … ECONNREFUSED` from the vite
proxy. Root cause: `unstable_startWorker` resolved a URL but never bound the
port, because the API worker's R2 buckets carry `remote: true` and the
remote-binding proxy session was refused. The failure was silent — nothing threw,
so the suite only saw a dead upstream.

The `createTestHarness` migration fixed it: `listen()` surfaces a
remote-proxy failure as a real rejection (and `server.debug()` prints the runtime
timeline), and the web stack boots local-only R2 because none of its flows upload
to a presigned URL. The `e2e-cli` stack asks for `remoteR2: true` instead, since
`update publish` really does PUT to R2 and read the object back through the
binding. See `startServerE2EStack` in `apps/server/tests/helpers/e2e-harness.ts`.
