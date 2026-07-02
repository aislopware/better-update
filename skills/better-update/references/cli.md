# CLI reference (complete)

Authoritative reference for the `better-update` CLI, mirroring `apps/cli/src/commands`. Install one of:

```bash
bunx @better-update/cli <command>
bun add -g @better-update/cli && better-update <command>
```

Conventions below: `<x>` = required positional, `[x]` = optional, `--flag` defaults noted inline.
Many booleans are citty-negatable — a `foo` flag with default on is disabled with `--no-foo`.

## Table of contents

- [Configuration & auth](#configuration--auth)
- [Top-level: login · logout · whoami · init · status · doctor · open · autocomplete](#top-level-misc)
- [projects](#projects) · [branches](#branches)
- [update](#update) · [channels](#channels)
- [build](#build) · [builds](#builds)
- [credentials](#credentials) (signing + E2E vault)
- [env](#env) · [environments](#environments)
- [fingerprint](#fingerprint) · [analytics](#analytics) · [audit-logs](#audit-logs)
- [apple](#apple) · [submit](#submit) · [testflight](#testflight) · [app-store](#app-store)
- [devices](#devices) · [groups](#groups) · [policies](#policies) · [webhooks](#webhooks)
- [Exit codes](#exit-codes)

## Top-level command tree

```
better-update
├── login / logout / whoami        Auth + identity
├── init / status / doctor / open  Project link, status, diagnostics, dashboard
├── autocomplete <shell>           Print a shell completion script
├── projects                       list · create · get · rename · archive · unarchive · delete
├── branches                       list · view · create · rename · delete
├── update                         publish · list · view · edit · delete · promote · republish ·
│                                  rollback · roll-back-to-embedded · revert · revert-rollout ·
│                                  rollout (set/complete/revert) · configure · embedded:upload · insights
├── channels                       list · view · create · update · pause · resume · delete ·
│                                  insights · rollout (create/update/complete/revert)
├── build [+ configure]            Local native build; configure scaffolds eas.json profiles
├── builds                         list · get · download · run · delete · install-link ·
│                                  compatibility-matrix · upload · resign
├── credentials                    Signing vault + E2E encryption (see its section)
├── env                            list · get · set · update · delete · history · rollback ·
│                                  import · export · pull · push · exec
├── environments                   list · create · rename · delete (org environment definitions)
├── fingerprint                    generate · compare
├── analytics                      adoption · updates · channels · platforms
├── audit-logs                     list
├── apple                          login · logout · whoami (Apple Developer session)
├── submit                         Submit a build to App Store Connect / Google Play
├── testflight                     group (list/create/delete) — TestFlight beta groups
├── app-store                      version (list/create/set/localize) · submit · status ·
│                                  release · rollout (start/status/pause/resume/complete)
├── devices                        add · list · view · sync · rename · enable · disable · delete
├── groups                         list · create · update · delete · members · policies · attach · detach
├── policies                       list · create · update · delete (IAM policy documents)
└── webhooks                       list · create · view · update · delete
```

## Configuration & auth

Server URL resolution (priority order):

1. `BETTER_UPDATE_URL` env var (API base URL).
2. `BETTER_UPDATE_WEB_URL` env var (web URL — for `login` callback).
3. `~/.better-update/config.json` fields `baseUrl` and `webUrl`.
4. Defaults: `https://updates.jmango360.dev` (API + web).

Auth token: `BETTER_UPDATE_ROBOT` env var — a robot account's bundled credential, used for both API
auth (bearer half) and credential-vault decrypt (identity half) automatically wherever each is
needed — see `credentials robot create`. Falls back to `~/.better-update/auth.json` (created by
`login`).
Project id per project: `expo.extra.betterUpdate.projectId` in `app.json` (Expo) or top-level
`projectId` in `eas.json` (non-Expo) — written by `init`.

Minimum-version killswitch: at startup the CLI reads the server's `/api/config`
`requireCliVersionAbove` (Worker var `REQUIRE_CLI_VERSION_ABOVE`) and hard-blocks
(exits non-zero) unless its version is **strictly newer** than that value —
letting the server retire a release with a critical bug. To force an upgrade,
set the var to the version you want to retire (that version and older are
blocked); `0.0.0` (default) blocks nothing. There is no opt-out. The result is
cached ~15 min in `~/.better-update/min-cli-version.json` and fails open (allows)
when the server is unreachable and nothing is cached, so an outage never bricks a
current CLI.

## Top-level misc

```bash
better-update login [--api-key]          # browser OAuth; --api-key prompts for a manual token paste
better-update logout [--all]             # remove the auth token; --all also clears the cached Apple session
better-update whoami                     # show the authenticated user/actor + active organization
better-update init [--id <id>] [--name <name>] [--slug <slug>]
better-update status                     # linked project info, credential counts, recent build counts
better-update doctor                     # diagnostics (Node>=22, signing tools, server, auth, config); exit 6 on any fail
better-update open [resource]            # open the dashboard (resource: builds|updates|channels|branches|credentials|devices|env-vars|webhooks|settings)
better-update autocomplete <shell>       # shell ∈ bash|zsh|fish
```

- `login` writes `~/.better-update/auth.json` (mode `0600`). `--api-key` pastes a session token
  manually instead of opening the browser. CI doesn't use this at all — it authenticates via the
  `BETTER_UPDATE_ROBOT` env var (see `credentials robot create` below), never `login`.
- `init` links the local project (Expo **or** any build system). With `--id` it links by explicit
  project id (skips slug lookup/creation). For non-Expo projects, `--name`/`--slug` default to
  package.json name / kebab-cased name, and the id is written to `eas.json`, not `app.json`.

## projects

```bash
better-update projects list [--query <q>] [--sort <lastActivityAt|name>] [--archived] [--all] [--limit <n>=50] [--page <n>=1]
better-update projects create --name <name> --slug <slug>
better-update projects get <id>
better-update projects rename <id> --name <new-name>
better-update projects archive <id> [--yes]
better-update projects unarchive <id>
better-update projects delete <id> [--yes]
```

`list`: `--limit` max 100; `--sort` defaults to `lastActivityAt`. By default lists only active
projects; `--archived` lists only archived ones, `--all` lists both. The `Status` column shows
`active`/`archived`.

`archive`: hides the project and makes it **read-only** — publishes, builds, env changes, renames,
and other writes are rejected with 403 until you `unarchive`. OTA updates already on devices keep
serving. Reversible. `archive`/`delete` prompt for confirmation; pass `--yes` to skip (required in
non-interactive/CI). `unarchive` restores the project to active, writable state.

## branches

```bash
better-update branches list
better-update branches view <target>          # target = branch ID OR name (prints id, name, project, update count)
better-update branches create --name <name>
better-update branches rename <id> --name <new-name>
better-update branches delete <id>
```

## update

### update publish

```bash
better-update update publish [flags]
```

| Flag                                                                     | Default      | Notes                                                                      |
| ------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------- |
| `--branch <name>`                                                        | —            | Target branch.                                                             |
| `--channel <name>`                                                       | —            | Route via a channel name (resolves to its branch) instead of `--branch`.   |
| `--platform <ios\|android\|all>`                                         | `all`        | Restrict to one platform.                                                  |
| `--message <text>`                                                       | —            | Free-form description.                                                     |
| `--environment <name>`                                                   | `production` | Env-var environment to inject during export.                               |
| `--auto`                                                                 | off          | Skip prompts (CI mode).                                                    |
| `--clear`                                                                | off          | Drop existing assets before upload.                                        |
| `--rollout-percentage <1-100>`                                           | —            | Initial rollout percentage. Omit for 100%.                                 |
| `--input-dir <path>`                                                     | —            | Use a pre-bundled `expo export` dir (with `--skip-bundler`).               |
| `--skip-bundler`                                                         | off          | Skip running `expo export`; requires `--input-dir`.                        |
| `--emit-metadata`                                                        | off          | Write `eas-update-metadata.json` after publish.                            |
| `--no-bytecode`                                                          | off          | Disable Hermes bytecode, emit raw JS.                                      |
| `--source-maps`                                                          | off          | Emit JS source maps.                                                       |
| `--private-key-path <path>`                                              | —            | RSA PEM to code-sign the rendered manifest (reads cert from app.json).     |
| `--allow-dirty`                                                          | off          | Proceed with uncommitted git changes.                                      |
| `--patch-base-window <n>`                                                | `10`         | Max recent updates to bsdiff against (0 = embedded baseline only).         |
| `--no-patches`                                                           | off          | Skip bsdiff patch generation (the `patches` step is on by default).        |
| `--manifest-body-file` / `--signature-file` / `--certificate-chain-file` | —            | Pre-built signed payload; `*-ios` / `*-android` variants for per-platform. |

Calls `expo export` internally unless `--skip-bundler` — you do NOT need to export first.

### Other update subcommands

```bash
better-update update list [--branch <name>] [--platform <ios|android>] [--limit <n>=20] [--offset <page>]
better-update update view <id>                               # single update: branch, platform, runtime, rollout %, rollback?, message
better-update update edit [groupId] [--branch <name>] [--rollout-percentage <1-100>]   # set rollout % for a whole group (interactive picker if no id)
better-update update delete <groupId>
better-update update promote <updateId> --channel <name> [--manifest-body-file …] [--signature-file …] [--certificate-chain-file …]
better-update update republish (--group <id> | --update <id> | --branch <name> | --channel <name>) \
                               (--to-branch <id> | --to-channel <name>) \
                               [--platform <ios|android>] [--message <text>] [--rollout-percentage <1-100>] [--project-id <id>]
better-update update rollback --branch <name> [--platform <ios|android|all>=all] [--message <text>] \
                              [--environment <name>=production] [--commit-time <ISO>] \
                              [--directive-body-file …] [--signature-file …] [--certificate-chain-file …] [--private-key-path <path>]
better-update update roll-back-to-embedded …                 # EAS-parity alias of `update rollback` (same flags)
better-update update revert [--branch <name>] [--platform <ios|android|all>=all] [--type <published|embedded>] [--message <text>] [--environment <name>=production]
better-update update revert-rollout <groupId>                # revert the in-progress rollout for EVERY update in a group
better-update update rollout set <updateId> <percentage>     # percentage 1–100, positional
better-update update rollout complete <updateId>             # → 100%
better-update update rollout revert <updateId>               # → 0% (single update)
better-update update configure [--runtime-policy <p>] [--check-automatically <v>] [--fallback-timeout <ms>] \
                               [--no-enable-bsdiff] [--disable-anti-bricking-measures] [--use-embedded-update] [--no-enabled] \
                               [--request-header KEY=VALUE …] [--force]   # write expo-updates config into the Expo config
better-update update embedded:upload --platform <ios|android> --bundle <path> --embedded-id <uuid> \
                               [--branch <name>] [--channel <name>] [--runtime-version <v>] [--message <text>] [--environment <name>=production] [--auto]
better-update update insights <groupId> [--period <1d|7d|30d|90d>]   # traffic/adoption per update in a group
```

`--commit-time` must be canonical ISO 8601 with milliseconds and a trailing `Z`
(`2026-05-06T14:00:00.000Z`) — numeric offsets / missing millis are rejected (the device's
`expo-updates` client only parses `YYYY-MM-DDTHH:mm:ss.SSSZ`).

> Three different "revert" verbs: **`update rollout revert <updateId>`** drops one update to 0%;
> **`update revert-rollout <groupId>`** does that for a whole group; **`update revert`** undoes the
> latest _update_ on a branch (republish previous, or rollback-to-embedded).

## channels

```bash
better-update channels list
better-update channels view <target>                         # target = channel ID OR name
better-update channels create --name <name> --branch <branch-name>
better-update channels update <id> --branch <new-branch-name>     # relink (NO `channels point`)
better-update channels pause <id>
better-update channels resume <id>
better-update channels delete <id>
better-update channels insights <name> [--period <1d|7d|30d|90d>]   # adoption/traffic for a channel
```

### channels rollout (branch-level traffic split)

```bash
better-update channels rollout create <channelId> --branch <new-branch> --percentage <1-100> [--runtime-version <rtv>]
better-update channels rollout update <channelId> --percentage <1-100>
better-update channels rollout complete <channelId>
better-update channels rollout revert <channelId>
```

`--runtime-version` constrains the rollout to a single runtime version.

## build

```bash
better-update build [--platform <ios|android>] [flags]
better-update build configure [--force]      # scaffold/top-up eas.json default profiles (--force overwrites)
```

`--platform` is **optional** — auto-detected from `app.json` when omitted.

| Flag                                | Default      | Notes                                                                    |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `--platform <ios\|android>`         | auto         | Auto-detected from app.json when omitted.                                |
| `--profile <name>`                  | `production` | Build profile (matches `eas.json` profile names).                        |
| `--message <text>`                  | —            | Free-form description on the build record.                               |
| `--no-upload`                       | off          | Upload is on by default; `--no-upload` for a dry run.                    |
| `--output <path>`                   | —            | Copy the built artifact to this path.                                    |
| `--raw-output`                      | off          | Raw Gradle/Xcode output instead of the formatted spinner.                |
| `--clear-cache`                     | off          | Clear project-scoped build caches before building.                       |
| `--freeze-credentials`              | off          | Fail fast if credentials are missing instead of prompting (CI).          |
| `--allow-dirty`                     | off          | Proceed even with uncommitted git changes.                               |
| `--auto-submit`, `-s`               | off          | After upload, submit using the eas.json submit profile of the same name. |
| `--auto-submit-with-profile <name>` | —            | After upload, submit using a specific submit profile.                    |
| `--what-to-test <text>`             | —            | iOS-only TestFlight changelog when auto-submitting.                      |

## builds

```bash
better-update builds list [--platform <ios|android>] [--profile <name>] [--runtime-version <v>] \
                          [--distribution <app-store|ad-hoc|development|enterprise|simulator|play-store|direct>] \
                          [--sort <createdAt|platform|distribution|runtimeVersion|appVersion>] [--limit <n>=10]
better-update builds get <id>
better-update builds download <id> [--output <path>]          # download artifact (.ipa/.apk/.aab); default ./<id>.<ext>
better-update builds run [<id>] [--latest] [--platform <ios|android>] [--simulator <name|udid>] \
                         [--device-id <udid>] [--device] [--emulator <serial>] [--package <name>]   # install + launch on a sim/emulator/device
better-update builds delete <id>
better-update builds install-link <id>                        # → artifactUrl, installUrl (iOS itms-services), expires
better-update builds compatibility-matrix                     # runtime-version coverage per channel; flags gaps
better-update builds upload <artifact-path> --platform <ios|android> [--profile <name>=production] [--message <text>]
better-update builds resign --build <id> [--profile-id <id>] [--cert-id <id>]   # re-sign an iOS build with a new profile (iOS only)
```

`builds list --sort` accepts a `-` prefix for descending (e.g. `-createdAt`).

## credentials

Bare `better-update credentials` (or `credentials manager`) launches an interactive
platform→category→action wizard. Otherwise:

### Signing material

```bash
better-update credentials list [--platform <ios|android>]
better-update credentials view <id> --type <type>            # metadata, no secrets
better-update credentials download <id> --type <type> [--output <path>]   # decrypt via vault session → file

better-update credentials upload --platform <ios|android> --type <type> --name <display> --file <path> \
  [--password] [--key-alias] [--key-password] [--key-id] [--issuer-id] [--apple-team-identifier] \
  [--bundle-identifier] [--merchant-identifier] [--pass-type-identifier]
better-update credentials upload-asc-key --p8 <path> [--key-id] [--issuer-id] [--apple-team-identifier] [--name]

better-update credentials delete <id> --platform <ios|android> --type <type>
better-update credentials remove [--platform <ios|android>] [--type <type>] [--yes]   # interactive picker
```

`--type` ∈ `distribution-certificate`, `provisioning-profile`, `push-key`, `push-certificate`,
`apple-pay-certificate`, `pass-type-certificate`, `asc-api-key` (iOS); `keystore`,
`google-service-account-key` (Android). Type-specific upload flags:

| Type                         | Required extras                               |
| ---------------------------- | --------------------------------------------- |
| `distribution-certificate`   | `--password`, `--apple-team-identifier`       |
| `provisioning-profile`       | (none)                                        |
| `push-key`                   | `--key-id`, `--apple-team-identifier`         |
| `asc-api-key`                | `--key-id`, `--issuer-id`                     |
| `push-certificate`           | `--bundle-identifier`                         |
| `apple-pay-certificate`      | `--merchant-identifier`                       |
| `pass-type-certificate`      | `--pass-type-identifier`                      |
| `keystore`                   | `--password`, `--key-alias`, `--key-password` |
| `google-service-account-key` | (none)                                        |

### Generate / configure / sync

```bash
better-update credentials generate keystore [--name] [--alias] [--store-password] [--key-password] [--common-name] [--organization] [--validity-days <n>=10000]
better-update credentials generate distribution-certificate --asc-key-id <id> [--type <distribution|development>=distribution]
better-update credentials generate provisioning-profile --asc-key-id <id> --cert-id <id> --bundle <id> \
  --distribution <APP_STORE|AD_HOC|DEVELOPMENT|ENTERPRISE> [--device-ids id1,id2]
better-update credentials generate push-key [--method <apple-id|upload>] [--key-id] [--apple-team-id] [--p8 <path>] [--asc-key-id] [--name] [--skip-portal-hint]
better-update credentials generate asc-key [--role <ADMIN|APP_MANAGER>=ADMIN] [--name] [--nickname]   # create an ASC API key via Apple ID login (no manual .p8)
better-update credentials generate merchant-id --identifier <merchant.*> [--name] [--bundle-identifier]
better-update credentials generate gsa-key [--file <path>] [--name] [--purpose <fcm|play>] [--skip-portal-hint]

better-update credentials regenerate-profile [--bundle] [--distribution <ad-hoc|app-store|development|enterprise>=ad-hoc] [--all]
better-update credentials configure [--platform <ios|android>] [--bundle] [--android-package] \
  [--distribution <ad-hoc|app-store|development|enterprise>=ad-hoc] [--rebind] [--bind-push-key <id>] [--bind-asc-key <id>] [--bind-fcm-gsa <id>]

better-update credentials sync push [--platform <ios|android|all>=all]                       # local credentials.json → server
better-update credentials sync pull [--platform <ios|android|all>=all] [--keys-dir <dir>=credentials] [--skip-gitignore]

better-update credentials revoke distribution-certificate --id <id> [--asc-key-id <id>] [--keep-local]
better-update credentials revoke push-key [--id <local-id>] [--keep-local]
```

For `revoke distribution-certificate`, `id` is a **named flag** (`--id`), not a positional;
`--asc-key-id` is optional (prompts when omitted and multiple keys exist).

### E2E encryption vault (identity / access / device / lock)

The credential vault is end-to-end encrypted (age + per-user keypairs); the server only stores
ciphertext. These manage who can decrypt and the local cached-key session.

```bash
better-update credentials identity <create|init|register|show> [--label]   # default `show`; device identity only
better-update credentials robot <create|list|rotate|revoke|policies|attach|detach> …   # default `list`; org-owned CI identity
#   robot create [--name] [--no-grant] — mint a robot (bearer + vault identity), grant it, print BETTER_UPDATE_ROBOT once
#   robot rotate <id> [--identity <AGE-SECRET-KEY-1…>] — re-mint the bearer only (needs robotAccount:update; boundary-checked); pass --identity to get a full bundle back
#   robot revoke <id> [--yes] — bearer stops authenticating, policy attachments dropped; excludes + rotates the vault if it held access
#   robot policies <id> · robot attach <id> --policy-id <policy> · robot detach <id> --policy-id <policy> — IAM grants (default-deny)
better-update credentials passphrase [change]                              # change this device's passphrase; re-seals identity + enrolled account key; default `change`
better-update credentials device <list|link> [<device>] [--yes]            # default `list`; link self-links a new device
better-update credentials access <list|grant|rotate|revoke|recover|recovery> …   # default `list`
#   access grant <recipient> [--yes] · access revoke <recipient> [--yes] · access rotate [--yes]
#   access recover [--key <AGE-SECRET-KEY-1…>] · access recovery rotate [--yes]
better-update credentials unlock [--duration <e.g. 15m|2h|1h30m>]          # cache the vault key in the OS keychain (default 15m, max 24h)
better-update credentials lock                                             # clear the cached vault key
better-update credentials status                                          # is the vault unlocked? remaining TTL
```

`identity init` bootstraps the org vault + offline recovery key; `identity create`/`register`
register/re-register this device's own key; `robot create` mints an org-owned CI identity (bearer
secret for API auth + vault identity in one, printed as a single `BETTER_UPDATE_ROBOT` credential);
`access grant`/`revoke` add/remove vault recipients (org members, other devices, or robots). See
`references/credentials.md` for the full model.

### Browser env-vault: account keys (account / env-vault)

Env-var values live in a separate env vault (EV) editable from the web (`updates-vault.jmango360.dev`),
leaving signing credentials CLI-only. Orgs are **born forked** at `identity init` — there is no
"migrate" step. The account key + the env-access grant each have a browser path (see
`references/credentials.md`); the CLI commands below are the CLI equivalents.

```bash
better-update credentials account <create|link|reseal|show>   # default `show`; per-USER account key, interactive (no flags)
#   create — enroll your account key (CLI seals it under this device's identity passphrase + self-links it to the EV)
#   link   — (re)grant your existing account key env access after an env-vault rotate
#   reseal — re-seal the escrow under a new passphrase (repair after a passphrase change on another device)

better-update credentials env-vault <rotate|status>          # default `status`; per-ORG (owner/admin)
better-update credentials env-vault rotate                    # re-key EV to current recipients (clears a pending flag after a member removal)
```

To edit env values from the browser you need an account key, a passkey, and an admin grant of env
access — all three have a browser path (**Set up vault access** to self-enroll; an admin clicks
**Grant env access** on the Vault access page). Web errors: _"No account key is enrolled…"_ → **Set up
vault access** (or `account create`); _"…can't open this org's env vault yet"_ → ask an admin to
**Grant env access** (or `account link` after a rotate). Note: **CLIs that predate the env-vault split
cannot bootstrap a new org** — upgrade first. Full model + troubleshooting in
`references/credentials.md`.

## env

Project env vars stored server-side (E2E-encrypted), injected into `expo export` at publish time.
Visibility is one of **`plaintext`** or **`sensitive`** — there is no "secret" tier.

```bash
better-update env list [--environments <csv>] [--scope <all|project|global>] [--search <substr>]
better-update env get <key> [--environment <name>=production] [--include-sensitive]   # positional is the KEY; sensitive masked as ****** unless --include-sensitive
better-update env set <KEY=VALUE> [--environment <csv>=production] [--visibility <plaintext|sensitive>=plaintext] [--label <text>] [--description <text>]
better-update env update <key> [--environment <name>=production] [--value <v>] [--visibility <plaintext|sensitive>] [--label <text>] [--description <text>]   # --label/--description = non-secret docs, shared per key, no vault; pass "" to clear
better-update env delete <key> [--environment <name>]          # NO --environment ⇒ deletes the key in EVERY environment
better-update env history <key> [--environment <name>=production]
better-update env rollback <key> --to <revision> [--environment <name>=production]
better-update env import <file> [--environment <csv>=production] [--visibility <plaintext|sensitive>=plaintext]
better-update env push [file=.env.local] [--environment <csv>=production]    # auto-classify EXPO_PUBLIC_* as plaintext, others sensitive
better-update env export [--environment <name>=production]                   # prints KEY='value' per line (all values)
better-update env pull [--environment <name>=production] [--path <file>=.env.local] [--stdout] [--force]
better-update env exec <environment> -- <command…>                          # run a command with project env vars injected
```

> `env pull` **writes a dotenv file by default** (`.env.local`, `KEY="value"`), prompting before
> overwrite unless `--force`. To source into a shell, use `--stdout`:
> `eval "$(better-update env pull --environment staging --stdout)"`.
> `--environment` on `set`/`import`/`push` accepts a comma-separated list.

## environments

Manages the **organization's** environment definitions (distinct from `env`, which manages a
project's variables). Built-in environments (development/preview/production) can't be deleted.

```bash
better-update environments list
better-update environments create <name>                # lowercase letters, digits, hyphens
better-update environments rename <name> --to <new-name>
better-update environments delete <name>
```

## fingerprint

```bash
better-update fingerprint generate [--platform <ios|android>]   # combined hash, or per-platform with --platform
better-update fingerprint compare [hash] [--build-id <id[,id]>] [--update-id <id[,id]>] [--platform <ios|android>]
```

`compare`: the positional `hash` is optional. Resolution — two ids (combined `--build-id` +
`--update-id` ≤ 2) compares both server-side; one id compares that vs the local project; a bare
`hash` compares it vs local. Exit `0` match, `1` mismatch, `2` resolution/usage error.

## analytics

```bash
better-update analytics adoption [--period <1d|7d|30d|90d>]
better-update analytics updates --update-id <id> [--period <1d|7d|30d|90d>]
better-update analytics channels --channel <name> [--period <1d|7d|30d|90d>]
better-update analytics platforms [--period <1d|7d|30d|90d>]
```

`--period` defaults to a server-defined window when omitted.

## audit-logs

```bash
better-update audit-logs list [--resource-type <type>] [--from <ISO>] [--to <ISO>] [--limit <n>=100]
```

## apple

Manages the Apple Developer **session** (cookie-based, used to issue iOS credentials). Distinct from
the top-level `login`/`logout`/`whoami` (which are for better-update itself). The `builds` and `users`
subgroups are **headless / CI-safe** (stored ASC API key, not the cookie session).

```bash
better-update apple login [--username <appleId>]    # defaults to last-used Apple ID; 2FA interactive
better-update apple logout                          # clear the cached Apple session (ASC API keys unaffected)
better-update apple whoami                          # show the cached Apple ID + team

# ASC pre-release builds (CI-safe; shares the ASC resolution below)
better-update apple builds list [--limit 50]                                   # uploaded builds, newest first
better-update apple builds get    (--build <id> | --build-version <n>)         # one build's attributes
better-update apple builds status (--build <id> | --build-version <n>)         # processing + TestFlight beta state
better-update apple builds compliance (--build <id> | --build-version <n>) \   # answer export compliance
  [--no-uses-encryption]                                                       # default: exempt (clears MISSING_EXPORT_COMPLIANCE)

# Team / seat administration (needs an ADMIN-role ASC API key)
better-update apple users list
better-update apple users invite --email <e> --first-name <f> --last-name <l> \
  --roles DEVELOPER,APP_MANAGER [--visible-apps <appId,appId>] [--provisioning-allowed true|false]

# Cookie-only (Apple ID login + 2FA; NOT CI-safe)
better-update apple asc-key list                            # active ASC API keys as seen on Apple (not the local vault)
better-update apple sandbox list                            # IAP sandbox testers
better-update apple sandbox create --email <e> --password <p> --first-name <f> --last-name <l> \
  [--secret-question <q>] [--secret-answer <a>] [--birth-date YYYY-MM-DD]   # or BETTER_UPDATE_SANDBOX_PASSWORD
better-update apple sandbox delete --id <testerId>
```

- **`apple builds compliance`** is the near-P0 fix for a build stuck in `MISSING_EXPORT_COMPLIANCE`: the bare
  command (or `--no-uses-encryption`) declares the app uses only exempt encryption; `--uses-encryption` declares
  it uses non-exempt encryption. It sets `usesNonExemptEncryption` on the build via `Build.updateAsync`.
- **`apple users invite`** takes comma-separated `--roles` (validated against ASC roles: `ADMIN`, `DEVELOPER`,
  `APP_MANAGER`, `MARKETING`, `FINANCE`, `SALES`, `CUSTOMER_SUPPORT`, `ACCESS_TO_REPORTS`, `READ_ONLY`, …).
  Omitting `--visible-apps` makes all apps visible; supplying App ids scopes the user to them. Apple emails the
  invite. Both `apple users` commands require an Admin-role key (Apple returns 403 otherwise).
- **`apple asc-key list`** and **`apple sandbox …`** are **cookie-only** (Apple's Iris API, no JWT equivalent):
  they log in via `apple login` and fail with a clear error under `--non-interactive` / CI. `asc-key list` shows
  what's on Apple (distinct from the local `credentials list` vault); create with `credentials generate asc-key`,
  revoke with `credentials revoke asc-key`. The sandbox password is read from `--password` or
  `BETTER_UPDATE_SANDBOX_PASSWORD` and is never echoed.

## submit

```bash
better-update submit --platform <ios|android> [--profile <name>=production] \
  (--latest | --id <buildId> | --path <ipa/aab|file://> | --url <url>) \
  [--what-to-test <text>] [--service-account-key-id <id>]
```

Submits a build to App Store Connect (iOS, via `xcrun altool`) or Google Play (Android), from the
CLI. Exactly one archive source is required (`--latest`/`--id`/`--path`/`--url`); if several are
passed, precedence is `--path` > `--url` > `--id` > `--latest`. `--what-to-test` is the iOS TestFlight changelog; `--service-account-key-id` overrides the
Android service account.

The whole upload runs locally, so a submission record is written to the server **only after the
upload succeeds** — it is a success-only history, not a live status you can poll or cancel. If the
upload fails (or is skipped because no auth is configured), no record is created; the failure is
printed to the terminal.

**iOS upload auth resolution.** The upload uses, in order: an app-specific password
(`appleId` in the submit profile + the `EXPO_APPLE_APP_SPECIFIC_PASSWORD` env var) if set, else the
submit profile's `ascApiKeyId`. If neither is configured and the terminal is interactive, `submit`
auto-resolves an ASC API key: it reuses a stored vault key (prompting to pick when several exist), or
— with your confirmation — creates one from your Apple ID login (after warning about any keys the team
already has, since Apple caps keys per team and a key's `.p8` downloads only once). The resolved id is
written back to the submit profile in `eas.json` so future runs reuse it. Non-interactive/CI runs with
nothing configured skip the upload (no record is written) and print how to add a key.

**What to Test validation.** `--what-to-test` is validated **before** the (slow) upload: it must be non-empty and
≤ 4000 UTF-8 bytes, so an avoidable metadata error never costs a full `altool` run. Apple also enforces an
undocumented minimum length (rejecting terse text like `Fix` as "too short") with no published threshold to
pre-check; if it trips post-upload, the error is surfaced clearly and you can fix it without re-uploading via
`testflight build whats-new --latest`.

**Idempotent upload + metadata status.** `submit` reads the `.ipa`'s `CFBundleVersion` and, before uploading,
checks App Store Connect for a build with that number. If it's already there (a prior run uploaded it), `submit`
**skips `altool` and goes straight to TestFlight config** — so re-running after a metadata failure just re-applies
the config instead of dead-ending on the "already been used" duplicate-build error (which is itself now treated as
"already uploaded, continue"). Because the binary and its TestFlight config are independent steps, `submit` records
the server submission even when config fails, marking it **metadata-incomplete** and then surfacing the error; the
dashboard shows the uploaded-but-pending build (green "Complete" vs amber "Metadata pending"). The record is keyed
on the build number, so the re-run that completes config **updates the same row** rather than adding a duplicate.

**TestFlight config + app auto-create.** When `--what-to-test` or submit-profile `groups` are set,
`submit` configures the build on TestFlight after upload (sets "What to Test", assigns beta groups).
This needs the App Store Connect app to exist: `submit` resolves it by the profile's `ascAppId`, else
looks it up by bundle id (headless, via the ASC key), and — if it still doesn't exist and the terminal
is interactive — offers to create it from your Apple ID (`App.createAsync`: name from the submit
profile's `appName` if set, else a _required_ prompt pre-filled with the best default (app.json
`expo.name` for Expo projects, else the better-update project name) — the prompt re-asks on a blank
value, since Apple rejects an empty name; SKU = bundle id, locale en-US; `companyName` from the profile or the signed-in team name,
which Apple requires for the first app on a brand-new organization account). The resolved `ascAppId` is
written back to `eas.json`. The bundle id must already be registered in your Apple Developer account (a
build or `credentials` run does this). Non-interactive runs with no resolvable app skip config with guidance.

## testflight

Manage the TestFlight beta lifecycle directly on App Store Connect — **headless and CI-safe**: every command
authenticates with a stored ASC API key (`.p8`, signed into a JWT), never a cookie session.

```bash
# Beta groups
better-update testflight group list                                        # list beta groups for the app
better-update testflight group create --name "QA" [--no-internal] \         # create a group (internal by default)
  [--public-link] [--public-link-limit <1-10000>]
better-update testflight group delete (--id <id> | --name <name>)          # delete a group
better-update testflight group add-build (--build <id> | --build-version <n>) \   # assign a build to a group
  (--group <name> | --group-id <id>)

# Testers
better-update testflight tester list [--group <name> | --group-id <id>]    # all testers, or one group's
better-update testflight tester add --email <e> [--first-name <f>] [--last-name <l>] \
  (--group <name> | --group-id <id>) [--invite]                            # add one tester (+ optional invite email)
better-update testflight tester import --from <file|json> \                # bulk-import [{email,firstName,lastName}]
  (--group <name> | --group-id <id>)
better-update testflight tester remove --email <e> \
  ((--group <name> | --group-id <id>) | --delete)                          # remove from a group, or --delete entirely

# External beta review (a build moves through Apple's beta app review)
better-update testflight review submit  (--build <id> | --build-version <n>)   # submit a build for beta review
better-update testflight review status  (--build <id> | --build-version <n>)
better-update testflight review withdraw (--build <id> | --build-version <n>)
better-update testflight review set-detail [--contact-email <e>] [--contact-first-name <f>] \
  [--contact-last-name <l>] [--contact-phone <p>] [--demo-account-name <n>] \
  [--demo-account-password <pw>] [--demo-required true|false] [--notes <text>]   # app-level review contact + demo

# Build "What to Test"
better-update testflight build whats-new (--build <id> | --build-version <n> | --latest) \
  [--locale en-US] (--whats-new <text> | --text-file <path>)
```

`testflight group create` is the unblocker for `submit ios`, which hard-fails (`TESTFLIGHT_GROUP_NOT_FOUND`)
when the submit profile names a group that does not exist yet. Internal groups (`--internal`, the default)
admit only App Store Connect users; `--no-internal` makes an external group (public testers, needs beta review).

- **`tester import`** is partial-success aware: Apple returns a per-tester result (`ASSIGNED` / `FAILED` /
  `NOT_QUALIFIED_FOR_INTERNAL_GROUP`), surfaced row-by-row instead of failing the whole batch. `firstName` and
  `lastName` are required for every row (Apple's bulk endpoint requires them).
- **`tester remove`** removes a tester from a single group by default; `--delete` removes the tester account
  entirely (from every group + the app).
- **`review set-detail`** demo password: pass `--demo-account-password`, or set `BETTER_UPDATE_DEMO_ACCOUNT_PASSWORD`
  to keep it out of shell history. It is never echoed.
- A **build** is selected by `--build <ascBuildId>` or `--build-version <CFBundleVersion>` (the build number); the
  latter resolves the uploaded build for the app.
- **`build whats-new`** additionally accepts `--latest` (newest uploaded build, precedence `--build` > `--build-version`
  > `--latest`) so you can fix "What to Test" on the last upload without looking up its build number — e.g. after a
  > `submit` where the text was rejected as too short. It edits the build's `betaBuildLocalizations` in place (no
  > re-upload). "What to Test" text is validated client-side before the call: it must be non-empty and ≤ 4000 UTF-8
  > bytes. Apple additionally enforces an **undocumented** minimum (a terse string like `Fix` is rejected as "too
  > short"); there is no published threshold to pre-check, so that rejection is surfaced with a clearer message.

### Shared App Store Connect resolution (testflight + app-store)

Every `testflight`/`app-store` command resolves three things, in this precedence:

- **ASC API key** — `--asc-api-key-id` flag › submit profile `ios.ascApiKeyId` › your single stored key
  (errors asking you to pick when several are stored). The `.p8` is decrypted locally; the server stays
  zero-knowledge.
- **App** — `--app-id` flag › profile `ios.ascAppId` › `App.findAsync` by bundle id (`--bundle-identifier`
  flag › profile `ios.bundleIdentifier`).
- **Profile** — `--profile` (default `production`) selects which `eas.json` submit profile to read the
  above from. A missing submit profile is tolerated when the flags supply everything.

Common flags on every leaf: `--profile`, `--asc-api-key-id`, `--app-id`, `--bundle-identifier`, and
(where a version is involved) `--platform` (`ios` default, `mac`, `tv`, `vision`).

## app-store

Drive the App Store **release pipeline** on App Store Connect — headless / CI-safe (ASC API key, same as
`testflight`).

```bash
# Editable "App Store" version
better-update app-store version list
better-update app-store version create --version <x.y.z> [--platform ios]
better-update app-store version set [--build <ascBuildId> | --build-version <CFBundleVersion>] \
  [--version <x.y.z>] [--release-type AFTER_APPROVAL|MANUAL|SCHEDULED] [--earliest-release-date <iso8601>]
better-update app-store version localize --locale en-US \
  [--whats-new <text>] [--description <text>] [--keywords <csv>] \
  [--promotional-text <text>] [--marketing-url <url>] [--support-url <url>]

# Review pipeline
better-update app-store status        # editable / in-review / pending-release / live slots + review submission
better-update app-store submit        # submit the editable version for App Review (idempotent)
better-update app-store cancel        # cancel the in-progress review submission
better-update app-store release        # release a version that is "Pending Developer Release"
better-update app-store reject        # developer-reject the in-review version, pulling it back from review
better-update app-store review-detail set [--contact-email <e>] [--contact-first-name <f>] \
  [--contact-last-name <l>] [--contact-phone <p>] [--demo-account-name <n>] \
  [--demo-account-password <pw>] [--demo-required true|false] [--notes <text>]

# Phased (staged) release
better-update app-store rollout start | status | pause | resume | complete

# Store listing metadata (App Info) + categories
better-update app-store info show
better-update app-store info localize --locale en-US [--name <n>] [--subtitle <s>] \
  [--privacy-policy-url <url>] [--privacy-choices-url <url>] [--privacy-policy-text <text>]
better-update app-store info set-categories [--primary <ID>] [--secondary <ID>] \
  [--primary-subcategory-1 <ID>] [--primary-subcategory-2 <ID>] \
  [--secondary-subcategory-1 <ID>] [--secondary-subcategory-2 <ID>]
better-update app-store categories list [--platform IOS|MAC_OS|UNIVERSAL|SERVICES]

# Age rating (authored from a JSON document)
better-update app-store age-rating get
better-update app-store age-rating set --from <file|json>

# App Privacy nutrition label (declarative)
better-update app-store privacy get
better-update app-store privacy set --from <file|json>    # array of { category, protection?, purpose? }
better-update app-store privacy publish                    # make the label public
better-update app-store privacy clear                      # delete every declared usage

# Account inventory + commercial
better-update app-store apps list                          # every app the ASC key can see (account-scoped)
better-update app-store pricing show                       # current price schedule (base territory + manual prices)
better-update app-store availability show                  # territories the app is available in (~175)
better-update app-store territories list                   # every territory id + currency (account-scoped reference)
better-update app-store availability set (--territories USA,GBR | --add USA --remove GBR)   # set availability
better-update app-store config pull [--out app-store.json]                    # editable version's per-locale copy → JSON
better-update app-store config push --from app-store.json                     # apply per-locale copy from JSON

# Register a new app record (cookie-only: Apple ID login, App Manager role)
better-update app-store apps create --name "<App Name>" --bundle-identifier com.acme.app \
  [--sku <sku>] [--primary-locale en-US] [--company-name "<Seller>"]
```

- **`version create`** uses `App.ensureVersionAsync` — idempotent (creates the editable version or renames
  the current one), so re-running with the same version is a no-op.
- **`version set`** mutates the editable version: `--build`/`--build-version` attaches a build (the latter
  resolves an uploaded build by its CFBundleVersion), `--release-type`/`--earliest-release-date` control
  when an approved version ships.
- **`submit`** is idempotent: if a review submission is already in progress it is reported, not duplicated
  (Apple allows one in-flight submission per app). Requires an editable version with a build attached.
  **`cancel`** undoes it; **`reject`** developer-rejects the in-review version (gated on Apple's `canReject`).
- **`release`** only works on a version in "Pending Developer Release" (approved + set to manual release).
- **`rollout`** targets the version awaiting release › live › editable, in that order. `start` enables a
  7-day phased release; `complete` releases to 100% immediately.
- **`info`** is the store-listing metadata (store name/subtitle/privacy URL/categories) on `AppInfo` — distinct
  from `version localize`, which is the per-version copy (release notes/description/keywords). Category ids come
  from `app-store categories list`.
- **`age-rating set`** and **`privacy set`** are authored from a JSON document (`--from <file>` or inline JSON),
  not a flag matrix. `privacy set` replaces all declarations, then `privacy publish` makes the label public.
  `review-detail set` sources the demo password from `--demo-account-password` or
  `BETTER_UPDATE_DEMO_ACCOUNT_PASSWORD` (never echoed).
- **`apps list`** is account-scoped (no app resolution — only `--profile`/`--asc-api-key-id`); `pricing show`
  and `availability show` are app-scoped and read-only. `pricing show` surfaces the base territory plus each
  manual price's territory + price-point id (the price amount lives on the price point); it prints "no price
  schedule" when the app was never priced. Setting price is out of scope (use ASC web).
- **`apps create`** registers a new app record (`App.createAsync`) — **cookie-only** (Apple ID login, App
  Manager role); the bundle id must already be registered. `--company-name` defaults to your Apple team name.
  Apple's rejection codes (insufficient role / bundle id not registered / name taken) surface as hints.
- **`availability set`** updates the app's territories via `App.updateAsync({ territories })` (Token/CI-safe):
  `--territories` REPLACES the whole set; `--add`/`--remove` read-modify-write the current set (mutually
  exclusive with `--territories`). It refuses to set zero territories (which would delist the app). Ids come from
  `app-store territories list`.
- **`config pull/push`** is the `eas metadata` parity aggregator over the editable version's **per-locale copy**
  only (release notes / description / keywords / promo text / marketing+support URLs). `pull` writes a JSON doc
  (stdout or `--out <file>`); `push --from <file|json>` applies it, skipping locales with no copy. Pricing,
  age-rating, privacy, and screenshots stay in their own commands (not in this document).

## reviews

Read and respond to App Store **customer reviews** — headless / CI-safe (stored ASC API key).

```bash
better-update reviews list [--rating 1-5] [--territory USA] [--limit 50]   # newest first; shows reply state
better-update reviews reply --review <reviewId> (--body <text> | --text-file <path>)
```

- **`reviews list`** is app-scoped (shares the ASC resolution above); `--rating` filters by star count,
  `--territory` by App Store country code.
- **`reviews reply`** posts a public developer response (`CustomerReviewResponse.createAsync`). It starts in
  `PENDING_PUBLISH` and becomes `PUBLISHED` after Apple moderation; there is no update API, so editing a reply
  means delete + recreate. Only `--profile`/`--asc-api-key-id` are needed (the review id is global).

## app-review (Apple App Review / Resolution Center)

Communicate with **Apple App Review** about a submission — read rejection threads, see the guideline codes,
reply. **Cookie-only** (Apple's Iris API has no JWT equivalent): logs in via `apple login` (2FA) and fails
with a clear error under `--non-interactive` / CI. App-scoped (shares the ASC app resolution; no ASC key
needed). Threads anchor on the app's in-progress review submission (which includes the rejected
`UNRESOLVED_ISSUES` state — exactly when App Review chat is live).

```bash
better-update app-review list                                          # threads on the open submission
better-update app-review view --thread <threadId>                      # full transcript (HTML → plain text)
better-update app-review rejections --thread <threadId>               # guideline section / code / description
better-update app-review reply --thread <threadId> (--body <text> | --text-file <path>)
```

- Typical loop after a rejected `app-store submit`: `app-review list` → `app-review rejections --thread <id>`
  (guideline codes like `2.5.4`) → `app-review reply --thread <id> --body "…"`.
- Replies are **text only** (Apple's Iris has no attachment-upload model) and write to your live submission.
  `view` renders the HTML `messageBody` as plain text for humans; the JSON payload carries the raw HTML.

## metadata (store media)

Manage App Store **screenshots and preview videos** — headless / CI-safe (stored ASC API key). All media
lives on the **editable** App Store version (the one in "Prepare for Submission"), so create/attach a version
first (`app-store version create`). Shares the ASC resolution above (`--profile` / `--app-id` / `--platform`).

```bash
better-update metadata media list [--locale en-US]            # screenshot + preview sets and their counts
better-update metadata media sync --dir <root> [--prune] [--dry-run]   # declaratively push a directory tree
better-update metadata screenshots upload --locale en-US --device APP_IPHONE_67 \
  (--dir <folder of .png/.jpg> | --file <image>) [--replace]
better-update metadata screenshots clear --locale en-US [--device iphone-67]
better-update metadata previews upload --locale en-US --device IPHONE_67 --file demo.mp4 \
  [--frame-time 00:00:05:01]
```

- **`--device`** accepts the exact App Store Connect class (`APP_IPHONE_67`, screenshots; `IPHONE_67`,
  previews) or a friendly alias without the `APP_` prefix (`iphone-67`, `ipad-pro-3gen-129`, `apple-vision-pro`,
  `desktop`). The same names are the directory names `media sync` expects.
- **`media sync`** walks `<root>/<locale>/<device>/*.png` and makes each remote device set match the local
  files (delete the set's screenshots, re-upload in **numeric-aware** name order, so `2.png` precedes
  `10.png`). `--dry-run` prints the plan without mutating anything; `--prune` additionally empties remote device
  sets that a **locally-present** locale does not declare (a locale absent from the tree is never touched). Two
  directories that resolve to the same device (e.g. `iphone-67` + `APP_IPHONE_67`) are rejected. Apple uploads
  are native AssetAPI (reserve → PUT → commit → poll) — no altool shell-out — and each upload waits for processing.
- **`screenshots upload`** appends to the device set; pass `--replace` to clear it first. Missing locales /
  device sets are created on demand. **`screenshots clear`** deletes a locale's screenshots (one device with
  `--device`, or all of them); the sets themselves persist (Apple has no set-delete).
- **`previews upload`** waits for Apple's transcode (minutes); `--frame-time` is the poster frame in
  `HH:MM:SS:FF` (4-segment, e.g. `00:00:05:01`).

## credentials — App Store Connect inventory + identifiers

Beyond the signing **vault** (see `references/credentials.md`), the `credentials` group exposes
App Store Connect inventory + capability/identifier management. The reads and the Token-based creates are
headless on a stored ASC API key (`--profile` / `--asc-api-key-id`, no app resolution); App Clip creation and
ASC-key revoke are **cookie-only** (Apple ID login).

```bash
better-update credentials certificate list                 # signing certificates (type, serial, expiry, status)
better-update credentials bundle-id list                   # registered App IDs (identifier, name, platform, seed)
better-update credentials bundle-id create --identifier com.acme.app [--name "<Display>"]   # register an App ID (CI-safe)
better-update credentials bundle-id create --identifier com.acme.app.Clip --app-clip \      # App Clip (cookie-only)
  --parent com.acme.app
better-update credentials profile list                     # provisioning profiles (type, state, uuid, expiry)
better-update credentials capability list    (--bundle-id <ascId> | --identifier <com.acme.app>)
better-update credentials capability enable  (--bundle-id <ascId> | --identifier <com.acme.app>) \
  --capability PUSH_NOTIFICATIONS                           # turn a capability ON (validated against CapabilityType)
better-update credentials revoke asc-key [--id <localKeyId>] [--keep-local]   # revoke on Apple + reconcile vault (cookie)
```

- **`bundle-id create`** registers a new App ID (`BundleId.createAsync`, Token/CI-safe). With `--app-clip` it
  creates an App Clip identifier (`{parent}.Clip`) under `--parent` — that path is **cookie-only** (Apple ID login).
- **`revoke asc-key`** revokes the App Store Connect API key on Apple (`ApiKey.revokeAsync`, irreversible) and
  deletes the local vault row (`--keep-local` keeps it). Cookie-only; prompts for which key if `--id` is omitted.

- **`capability enable`** validates `--capability` against Apple's `CapabilityType` and turns it `ON`. Capabilities
  with per-type option variants (Data Protection, iCloud, Sign In with Apple, Push) are enabled with their default
  option. Pass the App ID by its ASC id (`--bundle-id`) or its bundle identifier (`--identifier`).

## devices

Apple device registration (UDIDs) for ad-hoc / development provisioning.

```bash
better-update devices add [--udid <udid>] [--name <name>] [--device-class <IPHONE|IPAD|MAC|UNKNOWN>=IPHONE] \
  [--apple-team-id <uuid>] [--invite] [--expires-in <ttl>=24h] [--no-qr]   # --udid direct, or --invite for a self-service URL
better-update devices list [--device-class <…>] [--apple-team-id <uuid>] [--query <q>] [--enabled <true|false>] [--page <n>=1] [--limit <n>=20]
better-update devices view <id>
better-update devices sync [--apple-team-id <uuid>] [--asc-api-key-id <id>] [--no-push] [--no-pull]   # sync with App Store Connect
better-update devices rename <id> [--name <new-name>]
better-update devices enable <id>
better-update devices disable <id>
better-update devices delete <id> [--yes]
```

`--apple-team-id` is the internal team UUID (not the Apple Team Identifier). `devices sync` requires
`--apple-team-id` or `--asc-api-key-id`.

## groups

Member groups for IAM. Policies attached to a group are inherited by its members.

```bash
better-update groups list
better-update groups create --name <name> [--description <text>]
better-update groups update <id> [--name <name>] [--description <text>]
better-update groups delete <id> [--yes]
better-update groups members list <id>
better-update groups members add <id> --member-id <memberId>
better-update groups members remove <id> --member-id <memberId>
better-update groups policies <id>                       # list policies attached to the group
better-update groups attach <id> --policy-id <policyId>  # accepts a real id or a managed preset (e.g. managed:admin)
better-update groups detach <id> --policy-id <policyId>
```

## policies

IAM policy documents (default-deny; members/robot accounts get permissions only via attached policies).

```bash
better-update policies list
better-update policies create --name <name> --document <json> [--description <text>]
better-update policies update <id> [--name <name>] [--description <text>] [--document <json>]
better-update policies delete <id> [--yes]
```

`--document` is a JSON policy: `{"statements":[{"effect":"allow"|"deny","actions":[…],"resources":[…]}]}`
(shape-validated client-side). `managed:admin` is the ONLY managed (read-only) policy — all
fine-grained access is granted via custom policies. Resource selectors on the OTA axis carry the
environment segment: `project/{id}/env/{env}/channel/{id}/…` — writes into a PROTECTED environment
additionally require `environment:update` on `project/{id}/env/{env}`. Apple credentials are scoped
by Apple team: `appleCredential:*` on `appleTeam/{APPLE_TEAM_ID}` grants full CRUD + download for
every credential type of that team (`appleCredential:read` = per-team viewer; team-less ASC keys
live under `appleTeam/none`; see `references/access-control.md`).

## webhooks

```bash
better-update webhooks list
better-update webhooks create --name <name> --url <https-url> --events <csv> [--project-id <id>]
better-update webhooks view <id>
better-update webhooks update <id> [--name <name>] [--url <url>] [--events <csv>] [--enable] [--disable]
better-update webhooks delete <id> [--yes]
```

Allowed `--events`: `update.published`, `build.completed`. The signing secret is returned **once** at
creation. `update` uses two separate boolean flags `--enable` / `--disable` to set the enabled state.

## Exit codes

Use these in CI to branch on failure type.

| Code | Meaning                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success.                                                                                                                                                                                                         |
| `1`  | General failure (e.g. `fingerprint compare` mismatch; also resource-not-found / 404).                                                                                                                            |
| `2`  | Validation error (bad flag, missing required arg, `fingerprint` resolution error).                                                                                                                               |
| `3`  | Auth required or expired.                                                                                                                                                                                        |
| `4`  | Project not linked (run `init`); also Apple Developer auth / interactive-prohibited in the Apple-portal commands (`apple login`, `credentials generate push-key`/`asc-key`/`merchant-id`, `credentials revoke`). |
| `5`  | Missing signing credentials (`build`, `credentials regenerate-profile`) or a missing/invalid `credentials.json` (`credentials sync`).                                                                            |
| `6`  | Tooling/build failure: `doctor` check failed, plus local build / keychain / provisioning / native-run / credential-generation failures and filesystem errors.                                                    |
| `7`  | Publish/upload pipeline failure (artifact reserve/upload/complete, presigned-URL expiry, env export, bsdiff/patch generation, `update publish`).                                                                 |
