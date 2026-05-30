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

| id              | runtime                                             | autonomous | ≈ time      | notes                                               |
| --------------- | --------------------------------------------------- | ---------- | ----------- | --------------------------------------------------- |
| `lint`          | oxlint + tsgolint                                   | ✅ yes     | ~7s         | lint + typecheck, all packages                      |
| `unit`          | node/bun via turbo                                  | ✅ yes     | ~15s        | every app + package                                 |
| `integration`   | `@cloudflare/vitest-pool-workers`, local D1/R2      | ✅ yes     | ~2m         | real worker, local bindings                         |
| `e2e-server`    | vitest-pool-workers, **local** D1/R2                | ✅ yes     | ~1m45s      | pure-API OTA flows (~440 tests); no Cloudflare auth |
| `e2e-server-r2` | vitest-pool-workers, **remote** R2 binding          | ✅ yes\*   | ~20s        | the single direct-upload checksum contract          |
| `e2e-cli`       | `unstable_startWorker` (local) + real `expo export` | ✅ yes     | several min | publish / rollout / rollback / env / codesign       |
| `e2e-web`       | `unstable_startWorker` + vite + chromium, all local | ⚠️ broken  | several min | API + browser dashboard flows — see below           |
| `cli-slow`      | real Android Gradle build                           | ❌ no      | minutes     | needs the Android SDK; `--include-slow` only        |

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
- **migrate-config / analytics** (`migrate-config.test.ts`, `analytics.test.ts`):
  the local eas.json→config migration and the read-only analytics reports.

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

### Known issue: `e2e-web` dev-proxy

`e2e-web` currently fails headlessly. Every request — including `POST
/api/auth/sign-up/email` — returns `# SERVER_ERROR: internal error … { remote:
true }`. The e2e-api tests hit the apps/web vite dev server (port 6780), whose
workerd runtime proxies `/api` to the API worker via `WEB_API_PROXY_TARGET`; that
outbound proxy fetch fails. It is **not** a remote-R2 credential problem
(exporting `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` from the working E2E
token does not fix it) and **not** an OTA/API product bug (the same sign-up works
in `e2e-cli` against the same worker). It looks like a web-dev-proxy/workerd
regression (vite 8 / miniflare 4 / wrangler bump). Tracked as a separate
web-infra task; the OTA, signing, and dashboard _flows_ themselves are unaffected.
