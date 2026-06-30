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
- [apple](#apple) · [submit](#submit)
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

Auth token: `BETTER_UPDATE_TOKEN` env var, else `~/.better-update/auth.json` (created by `login`).
Project id per project: `expo.extra.betterUpdate.projectId` in `app.json` (Expo) or top-level
`projectId` in `eas.json` (non-Expo) — written by `init`.

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

- `login` writes `~/.better-update/auth.json` (mode `0600`). `--api-key` reads a key generated on the
  dashboard's API Keys page.
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
better-update credentials identity <create|init|register|show> [--label]   # default `show`
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
register/re-register this device's key; `access grant`/`revoke` add/remove vault recipients (org
members or other devices). See `references/credentials.md` for the full model.

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
better-update env set <KEY=VALUE> [--environment <csv>=production] [--visibility <plaintext|sensitive>=plaintext]
better-update env update <key> [--environment <name>=production] [--value <v>] [--visibility <plaintext|sensitive>]
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
the top-level `login`/`logout`/`whoami` (which are for better-update itself).

```bash
better-update apple login [--username <appleId>]    # defaults to last-used Apple ID; 2FA interactive
better-update apple logout                          # clear the cached Apple session (ASC API keys unaffected)
better-update apple whoami                          # show the cached Apple ID + team
```

## submit

```bash
better-update submit --platform <ios|android> [--profile <name>=production] \
  (--latest | --id <buildId> | --path <ipa/aab|file://> | --url <url>) \
  [--what-to-test <text>] [--service-account-key-id <id>] [--no-wait]
```

Submits a build to App Store Connect (iOS, via `xcrun altool`) or Google Play (Android), from the
CLI. Exactly one archive source is required (`--latest`/`--id`/`--path`/`--url`); if several are
passed, precedence is `--path` > `--url` > `--id` > `--latest`. `--what-to-test` is the iOS TestFlight changelog; `--service-account-key-id` overrides the
Android service account; `--no-wait` returns without blocking until a terminal status.

**iOS upload auth resolution.** The upload uses, in order: an app-specific password
(`appleId` in the submit profile + the `EXPO_APPLE_APP_SPECIFIC_PASSWORD` env var) if set, else the
submit profile's `ascApiKeyId`. If neither is configured and the terminal is interactive, `submit`
auto-resolves an ASC API key: it reuses a stored vault key (prompting to pick when several exist), or
— with your confirmation — creates one from your Apple ID login (after warning about any keys the team
already has, since Apple caps keys per team and a key's `.p8` downloads only once). The resolved id is
written back to the submit profile in `eas.json` so future runs reuse it. Non-interactive/CI runs with
nothing configured just queue the submission and print how to add a key.

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

IAM policy documents (default-deny; members/api-keys get permissions only via attached policies).

```bash
better-update policies list
better-update policies create --name <name> --document <json> [--description <text>]
better-update policies update <id> [--name <name>] [--description <text>] [--document <json>]
better-update policies delete <id> [--yes]
```

`--document` is a JSON policy: `{"statements":[{"effect":"allow"|"deny","actions":[…],"resources":[…]}]}`
(shape-validated client-side). `managed:*` presets are read-only — can't be updated or deleted.

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
