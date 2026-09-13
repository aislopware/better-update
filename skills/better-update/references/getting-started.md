# Getting started: install, auth, config, link

## Requirements

- An Expo project that already uses [`expo-updates`](https://docs.expo.dev/versions/latest/sdk/updates/).
- macOS (Apple Silicon) or Linux (x64 / arm64, glibc or musl). The CLI is a standalone binary —
  no Node or Bun needed to run it. Expo builds still need the host Node that Expo itself requires.
- A better-update account on the instance your CLI targets (its URL is baked into the CLI at
  build time; override per machine with `BETTER_UPDATE_URL`).

## Install

The CLI is a standalone binary (macOS arm64, Linux x64/arm64, glibc or musl), installed with one
script — no Node or Bun needed at run time, which also makes it the CI install:

```bash
curl -fsSL https://raw.githubusercontent.com/aislopware/better-update/main/install.sh | sh
```

`@better-update/cli` on npm is deprecated: it stopped at 0.79 and receives no new versions. Remove
an npm/bun/pnpm/yarn install (global or a `package.json` dev dependency) and use the script; the
CLI's upgrade notice prints the uninstall + install one-liner for such a copy.

The install script downloads from the project's GitHub Releases into `~/.local/bin` (or `$XDG_BIN_HOME`; add it
to `PATH` if the script says so). Knobs, all via environment:

| Variable                    | Effect                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| `BETTER_UPDATE_VERSION`     | pin a version (`0.80.0`) instead of the latest — use this in CI   |
| `BETTER_UPDATE_INSTALL_DIR` | install somewhere else (e.g. `/usr/local/bin`)                    |
| `BETTER_UPDATE_REPO`        | download from another GitHub repo (a fork shipping its own build) |

Upgrading is rerunning the script; the CLI prints a notice with the command when a newer release
exists (opt out with `BETTER_UPDATE_DISABLE_UPDATE_NOTIFIER=1`).

Verify with `better-update --help` — you should see the top-level command list (`login`, `init`,
`update`, `channels`, …).

A handy pattern for a project is a package.json script:

```json
{
  "scripts": {
    "release:staging": "better-update update publish --branch staging --message \"$MSG\""
  }
}
```

## Point at a server (skip if using the default cloud)

The CLI resolves its server URL in priority order:

| Source                                     | Field        | Notes                                  |
| ------------------------------------------ | ------------ | -------------------------------------- |
| `BETTER_UPDATE_URL` env var                | API base URL | highest priority; per-shell override   |
| `BETTER_UPDATE_WEB_URL` env var            | Web URL      | used for the `login` browser callback  |
| `~/.better-update/config.json` → `baseUrl` | API base URL | persistent per-user                    |
| `~/.better-update/config.json` → `webUrl`  | Web URL      | persistent per-user                    |
| built-in defaults                          | —            | baked in at CLI build time (API + web) |

Persistent config (`~/.better-update/config.json`):

```json
{ "baseUrl": "https://updates.example.com", "webUrl": "https://console.example.com" }
```

One-off (e.g. CI where the URL is a secret):

```bash
BETTER_UPDATE_URL=https://updates.example.com better-update status
```

## Log in

```bash
better-update login
```

Opens `<webUrl>/auth/cli-login` in the default browser, starts a local listener on a random port,
and waits for the callback. The token is saved to `~/.better-update/auth.json` (mode `0600`; the
directory is `0700`).

Headless / remote machine:

```bash
better-update login --api-key      # then paste a session token manually
```

Or skip the file entirely with a robot account (mint one from inside the linked project with
`credentials robot create` — robots are project-scoped: one robot = one project + one role, both
fixed at creation via `--project <projectId>` / `--role <maintainer|developer|reporter>`, defaulting
to the linked project + `developer`; see `references/credentials.md`), which takes priority over
the file:

```bash
BETTER_UPDATE_ROBOT=… better-update update list
```

`better-update logout` deletes `~/.better-update/auth.json`; add `--all` to also clear the cached
Apple Developer session. `better-update whoami` prints the authenticated user/actor and active org.

## Link a project

From the project root:

```bash
better-update init [--id <id>] [--name <name>] [--slug <slug>]
```

`init` links an **Expo or any other** project. With no flags it reads `app.json`, looks up an
existing project by `expo.slug` (creates one if none, using `expo.name`/`expo.slug` for display), and
writes the project id back into the Expo config. `--id` links by an explicit project id (skips the
slug lookup/creation). For **non-Expo** projects, `--name`/`--slug` default to the package.json name
/ kebab-cased name, and the id is written to `eas.json`'s top-level `projectId` instead of `app.json`.

For an Expo project the written config looks like:

```jsonc
{
  "expo": {
    "name": "My App",
    "slug": "my-app",
    "extra": { "betterUpdate": { "projectId": "01J…ULID…" } },
  },
}
```

Every other command reads the project id from there. In a monorepo, run `init` from each app
directory — each `app.json` carries its own `projectId`.

## Wire `expo-updates` (first-time only)

Point the manifest URL at your project, then rebuild the binary **once**; after that updates flow
OTA with no rebuild:

```json
{
  "expo": {
    "updates": {
      "url": "https://<your-instance>/manifest/<projectId>",
      "enabled": true,
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 0
    },
    "runtimeVersion": { "policy": "appVersion" }
  }
}
```

The channel a device reads is set at **build time** (build profile / `--release-channel`), not in
`app.json`. Create the channel once (`better-update channels create --name production --branch main`)
and from then on `update publish --branch main` reaches every device on `production`.

## Files the CLI reads/writes

- `~/.better-update/config.json` — `baseUrl` + `webUrl` overrides
- `~/.better-update/auth.json` — saved login token (mode `0600`)
- `./app.json` — `expo.extra.betterUpdate.projectId`

## First update, end to end

```bash
better-update login
better-update init
better-update branches create --name main          # publish target must exist first
better-update update publish --branch main --message "Hello from better-update"
better-update channels create --name production --branch main
```

Then build once with `channel = production` in the build profile. Devices on `production` pull the
new manifest on next launch.

## Diagnostics & dashboard

```bash
better-update status                 # linked project, credential counts, recent builds
better-update doctor                 # check Node>=22, signing tools, server reachability, auth, config (exit 6 on any fail)
better-update open [resource]        # open the dashboard; resource ∈ builds|updates|channels|branches|credentials|devices|env-vars|webhooks|settings
better-update autocomplete <shell>   # print a bash|zsh|fish completion script
```

Run `doctor` first when a command misbehaves — it pinpoints a missing tool, an expired token, or an
unlinked project before you dig further.
